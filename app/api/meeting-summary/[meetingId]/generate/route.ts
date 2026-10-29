/**
 * POST /api/meeting-summary/[meetingId]/generate
 *
 * 从字幕生成结构化会议摘要：
 *   1. 读取该会议所有 MeetingTranscript（按时间排序）
 *   2. 调用 DeepSeek（OpenAI 备用）按 lib/meetingSummary 的规则起草：主题、概览、分节要点、待办；
 *      长会议分段起草（每段一次调用），最后一次调用写主题 / 概览并合并重复的待办
 *   3. normalizeSummary 把每个时间对到真实字幕，对不上的要点 / 待办丢掉
 *   4. 每节写一行 MeetingSummaryItem（章节卡片也用它），主题 / 概览 / 待办写 MeetingSummary
 */
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { checkAiSummaryQuota } from '@/lib/billing/limits';
import { meterAiSummary, meterSafely } from '@/lib/billing/usage';
import {
  aiFailureReason,
  draftSummary,
  normalizeSummary,
  sectionContent,
  type SummaryDraft,
} from '@/lib/meetingSummary';
import { isInternalMember } from '@/lib/internalStaff.server';
import { requireMeetingAccess } from '@/lib/meetingAccessGuards';

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

// ── Call AI (DeepSeek first, OpenAI fallback); returns the parsed JSON object ──
async function chat(
  url: string,
  key: string,
  model: string,
  system: string,
  prompt: string,
  maxTokens: number,
): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`${model} error: ${await res.text()}`), { status: res.status });
  }
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{}');
}

/** One call: DeepSeek, or OpenAI when DeepSeek is missing or fails (for this call only). */
async function callAI(system: string, prompt: string, maxTokens: number): Promise<SummaryDraft> {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  let fallbackReason = 'no-key';
  if (deepseekKey) {
    try {
      const raw = await chat(
        'https://api.deepseek.com/v1/chat/completions',
        deepseekKey,
        'deepseek-chat',
        system,
        prompt,
        maxTokens,
      );
      return { raw, model: 'deepseek-chat', fallbackReason: null };
    } catch (e) {
      fallbackReason = aiFailureReason(e);
      console.warn(`[generate] DeepSeek failed (${fallbackReason}), trying OpenAI:`, e);
    }
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error('No AI API key configured');
  const raw = await chat('https://api.openai.com/v1/chat/completions', openaiKey, 'gpt-4o-mini', system, prompt, maxTokens);
  return { raw, model: 'gpt-4o-mini', fallbackReason };
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

    // Only the host or members who attended may spend AI quota / overwrite the summary.
    const access = await requireMeetingAccess(req, localMeetingId);
    if (access instanceof NextResponse) return access;
    if (access.memberId == null) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
      return NextResponse.json({ error: 'No transcript yet, so a summary cannot be generated.' }, { status: 422 });
    }

    // Billing (no-op when disabled): Free includes a few AI summaries per month.
    const quotaError = await checkAiSummaryQuota(session.teamMemberId);
    if (quotaError) return quotaError;

    const meetingName = meeting.title || meeting.roomName || `Meeting #${localMeetingId}`;

    // Long meetings are drafted in parts (lib/meetingSummary draftSummary)
    let ai: SummaryDraft;
    try {
      ai = await draftSummary(meetingName, transcripts, callAI);
    } catch (e: any) {
      console.error('[generate] AI call failed:', e);
      return NextResponse.json({ error: 'The AI service failed. Please try again.' }, { status: 502 });
    }

    // Every point and to-do must land on a real transcript line; the rest is dropped
    const summary = normalizeSummary(ai.raw, transcripts);
    if (!summary) {
      return NextResponse.json({ error: 'The AI service returned no usable summary. Please try again.' }, { status: 502 });
    }

    const saved = await prisma.$transaction(async (tx) => {
      await tx.meetingSummaryItem.deleteMany({ where: { meetingId: localMeetingId } });
      await tx.meetingSummaryItem.createMany({
        data: summary.sections.map((section, idx) => ({
          meetingId: localMeetingId,
          title: section.title,
          content: sectionContent(section),
          timeOffset: secsToHMS(section.startSec),
          speaker: section.speaker,
          points: section.points as unknown as Prisma.InputJsonValue,
          sortOrder: idx,
        })),
      });
      const fields = {
        topic: summary.topic || null,
        overview: summary.overview || null,
        speakers: summary.speakers as unknown as Prisma.InputJsonValue,
        todos: summary.todos as unknown as Prisma.InputJsonValue,
        model: ai.model,
        fallbackReason: ai.fallbackReason,
      };
      const head = await tx.meetingSummary.upsert({
        where: { meetingId: localMeetingId },
        create: { meetingId: localMeetingId, ...fields },
        update: fields,
        select: { topic: true, overview: true, speakers: true, todos: true, updatedAt: true },
      });
      const items = await tx.meetingSummaryItem.findMany({
        where: { meetingId: localMeetingId },
        orderBy: { sortOrder: 'asc' },
      });
      return { items, head };
    });

    await meterSafely(`ai:${localMeetingId}`, () => meterAiSummary(session.teamMemberId, localMeetingId));

    // Which model wrote it is an internal note: only staff on INTERNAL_STAFF_EMAILS get it
    const { updatedAt, ...head } = saved.head;
    const generation = (await isInternalMember(session.teamMemberId))
      ? { model: ai.model, fallbackReason: ai.fallbackReason, at: updatedAt }
      : undefined;
    return NextResponse.json({ success: true, items: saved.items, summary: { ...head, generation } });
  } catch (err) {
    console.error('[meeting-summary generate]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
