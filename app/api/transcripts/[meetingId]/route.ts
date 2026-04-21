/**
 * GET /api/transcripts/[meetingId]
 *
 * 从 Kloud Java Server 拉取会议字幕（transcript），并可选缓存到本地 DB。
 * Java Server 端点: GET /meeting_caption/list_with_voice
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const KLOUD_API = process.env.NEXT_PUBLIC_REMOTE_API || 'https://meet.kloud.cn';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  try {
    const { meetingId } = await params;
    const localMeetingId = parseInt(meetingId);
    if (isNaN(localMeetingId)) {
      return NextResponse.json({ error: 'Invalid meetingId' }, { status: 400 });
    }

    // 1. 查本地 Meeting → 获取 kloudMeetingId
    const meeting = await prisma.meeting.findUnique({
      where: { id: localMeetingId },
      select: { id: true, kloudMeetingId: true, actualStartedAt: true },
    });

    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    // 2. 如果本地已有 transcript 缓存，直接返回
    const localCount = await prisma.meetingTranscript.count({
      where: { meetingId: localMeetingId },
    });
    if (localCount > 0) {
      const localTranscripts = await prisma.meetingTranscript.findMany({
        where: { meetingId: localMeetingId },
        orderBy: { captionTime: 'asc' },
      });
      return NextResponse.json({ captions: localTranscripts, source: 'local' });
    }

    // 3. 无本地缓存 → 尝试从 Kloud Java Server 拉取
    const kloudId = (meeting as any).kloudMeetingId;
    if (!kloudId) {
      // 没有关联的 kloudMeetingId，返回空
      return NextResponse.json({ captions: [], source: 'none', message: 'No kloudMeetingId linked' });
    }

    // 获取调用方 token（如有）
    const authHeader = req.headers.get('authorization') || '';

    const javaRes = await fetch(
      `${KLOUD_API}/meeting_caption/list_with_voice?meetingId=${kloudId}&meetingSessionId=0&editionType=1`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
      }
    );

    if (!javaRes.ok) {
      return NextResponse.json({ captions: [], source: 'java-error', status: javaRes.status });
    }

    const javaData = await javaRes.json();
    const rawCaptions: any[] = javaData?.data?.captions || [];

    if (!rawCaptions.length) {
      return NextResponse.json({ captions: [], source: 'java-empty' });
    }

    // 4. 缓存到本地 DB
    const startTime = meeting.actualStartedAt ? new Date(meeting.actualStartedAt).getTime() : null;
    const toInsert = rawCaptions.map((c: any) => {
      const captionMs = new Date(c.captionTime).getTime();
      return {
        meetingId: localMeetingId,
        speakerName: c.userName || c.speakerName || 'Unknown',
        speakerMemberId: null,
        content: c.captionContent || c.content || '',
        captionTime: new Date(c.captionTime),
        offsetSeconds: startTime ? Math.floor((captionMs - startTime) / 1000) : null,
        sourceId: String(c.id || c.captionId || ''),
      };
    });

    await prisma.meetingTranscript.createMany({ data: toInsert, skipDuplicates: true });

    const saved = await prisma.meetingTranscript.findMany({
      where: { meetingId: localMeetingId },
      orderBy: { captionTime: 'asc' },
    });

    return NextResponse.json({ captions: saved, source: 'java' });
  } catch (err) {
    console.error('[transcripts GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
