/**
 * POST /api/meeting-summary/[meetingId]/generate
 *
 * 从字幕自动生成会议摘要章节：
 *   1. 读取该会议所有 MeetingTranscript（按时间排序）
 *   2. 构建 prompt，调用 OpenAI（或 DeepSeek 备用）分析
 *   3. AI 自主决定章节数量（基于内容语义）
 *   4. 写入 MeetingSummaryItem，返回结果
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// ── Auth helper ──────────────────────────────────────────────
async function getSession(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  return prisma.session.findUnique({
    where: { token },
    select: { id: true, expiresAt: true, teamMemberId: true },
  });
}

// ── Format seconds to HH:mm:ss ──────────────────────────────
function secsToHMS(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Call AI (OpenAI first, DeepSeek fallback) ────────────────
interface AIChapter {
  title: string;
  content: string;
  startSec: number;
  endSec: number;
  speaker: string;
}

async function callAI(prompt: string): Promise<AIChapter[]> {
  const systemPrompt = `You are a professional meeting analyst. Analyze the transcript and split it into logical chapters based on topic changes — NOT fixed time intervals. 
Return a JSON object with a "chapters" key containing an array. Each chapter has:
- title: concise chapter title (with relevant emoji prefix, in the same language as the transcript)
- content: paragraph summary of what was discussed (2-5 sentences, in the same language as the transcript)  
- startSec: start time in seconds (integer)
- endSec: end time in seconds (integer)
- speaker: the main speaker in this chapter (pick the one with most lines)

Rules:
- Decide chapter count based on content — typically 3-8 chapters for a normal meeting
- Each chapter should cover a cohesive topic/discussion
- Return ONLY a valid JSON object like {"chapters": [...]}`;

  // Try DeepSeek first (default)
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deepseekKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 4000,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const data = await res.json();
        const raw = data.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(raw);
        const chapters: AIChapter[] = Array.isArray(parsed)
          ? parsed
          : (parsed.chapters || parsed.result || Object.values(parsed)[0] || []);
        if (chapters.length > 0) return chapters;
      } else {
        console.warn('[generate] DeepSeek error:', await res.text());
      }
    } catch (e) {
      console.warn('[generate] DeepSeek failed, trying OpenAI:', e);
    }
  }

  // Fallback: OpenAI
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error('No AI API key configured');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);
  const chapters: AIChapter[] = Array.isArray(parsed)
    ? parsed
    : (parsed.chapters || parsed.result || Object.values(parsed)[0] || []);

  return chapters;
}

// ── Main handler ─────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  try {
    const session = await getSession(req);
    if (!session || session.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { meetingId } = await params;
    const localMeetingId = parseInt(meetingId);
    if (isNaN(localMeetingId)) {
      return NextResponse.json({ error: 'Invalid meetingId' }, { status: 400 });
    }

    const meeting = await prisma.meeting.findUnique({
      where: { id: localMeetingId },
      select: { id: true, title: true, roomName: true, actualStartedAt: true },
    });
    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const transcripts = await prisma.meetingTranscript.findMany({
      where: { meetingId: localMeetingId },
      orderBy: { captionTime: 'asc' },
    });

    if (transcripts.length === 0) {
      return NextResponse.json({ error: '暂无字幕数据，无法生成摘要' }, { status: 422 });
    }

    // Build prompt
    const meetingName = meeting.title || meeting.roomName || `Meeting #${localMeetingId}`;
    const lines = transcripts
      .map((t) => `[${secsToHMS(t.offsetSeconds ?? 0)}] ${t.speakerName}: ${t.content}`)
      .join('\n');

    const totalSec = transcripts.reduce((max, t) => {
      const s = t.offsetSeconds ?? 0;
      return s > max ? s : max;
    }, 0);

    const prompt = `Meeting: ${meetingName}\nDuration: ~${Math.round(totalSec / 60)} min\nTranscript:\n\n${lines}\n\nPlease analyze and generate chapters.`;

    // Call AI
    let chapters: AIChapter[];
    try {
      chapters = await callAI(prompt);
    } catch (e: any) {
      console.error('[generate] AI call failed:', e);
      return NextResponse.json({ error: `AI 调用失败: ${e.message}` }, { status: 502 });
    }

    if (!chapters || chapters.length === 0) {
      return NextResponse.json({ error: 'AI 未返回有效章节数据' }, { status: 502 });
    }

    // Normalize
    chapters = chapters
      .filter((c) => c.title && c.content)
      .map((c) => ({
        ...c,
        startSec: typeof c.startSec === 'number' ? c.startSec : 0,
        endSec: typeof c.endSec === 'number' ? c.endSec : totalSec,
        speaker: c.speaker || '',
        title: c.title.trim(),
        content: c.content.trim(),
      }))
      .sort((a, b) => a.startSec - b.startSec);

    // Save to DB
    await prisma.meetingSummaryItem.deleteMany({ where: { meetingId: localMeetingId } });
    await prisma.meetingSummaryItem.createMany({
      data: chapters.map((c, idx) => ({
        meetingId: localMeetingId,
        title: c.title,
        content: c.content,
        timeOffset: secsToHMS(c.startSec),
        sortOrder: idx,
      })),
    });

    const saved = await prisma.meetingSummaryItem.findMany({
      where: { meetingId: localMeetingId },
      orderBy: { sortOrder: 'asc' },
    });

    return NextResponse.json({
      success: true,
      items: saved,
      chapters: chapters.map((c, idx) => ({
        id: saved[idx]?.id ?? -(idx + 1),
        startSec: c.startSec,
        endSec: c.endSec,
        speaker: c.speaker,
        title: c.title,
        timeRange: `${secsToHMS(c.startSec)}-${secsToHMS(c.endSec)}`,
      })),
    });
  } catch (err) {
    console.error('[meeting-summary generate]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
