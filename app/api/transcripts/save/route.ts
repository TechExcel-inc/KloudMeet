/**
 * POST /api/transcripts/save
 *
 * 接收一条最终字幕（tp=0）并写入本地 MeetingTranscript 表。
 * 由发言者本地的浏览器在 useCaptions.ts 收到 FinalTranscript 时调用。
 * 鉴权：X-LiveKit-Token（本场房间票）或已登录且参加过本场会议。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireMeetingAccess } from '@/lib/meetingAccess';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { meetingId, speakerName, content, offsetSeconds } = body as {
      meetingId: number;
      speakerName: string;
      content: string;
      offsetSeconds?: number;
    };

    if (!meetingId || !content?.trim()) {
      return NextResponse.json({ error: 'meetingId and content are required' }, { status: 400 });
    }

    const access = await requireMeetingAccess(req, Number(meetingId));
    if (access instanceof NextResponse) return access;

    const record = await prisma.meetingTranscript.create({
      data: {
        meetingId: access.meeting.id,
        speakerName: speakerName || 'Unknown',
        content: content.trim(),
        captionTime: new Date(),
        offsetSeconds: offsetSeconds ?? null,
        sourceId: null,
      },
    });

    return NextResponse.json({ ok: true, id: record.id });
  } catch (err) {
    console.error('[transcripts/save POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
