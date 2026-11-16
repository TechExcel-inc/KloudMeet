/**
 * GET /api/transcripts/[meetingId]
 *
 * 读取本场会议本地 MeetingTranscript。没有字幕就返回空列表。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireMeetingAccess } from '@/lib/meetingAccessGuards';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  return runWithLocale(req, async () => {
  try {
    const { meetingId } = await params;
    const localMeetingId = parseInt(meetingId, 10);
    if (Number.isNaN(localMeetingId)) {
      return apiJson({ error: 'Invalid meetingId' }, { status: 400 });
    }

    const access = await requireMeetingAccess(req, localMeetingId);
    if (access instanceof NextResponse) return access;

    const captions = await prisma.meetingTranscript.findMany({
      where: { meetingId: localMeetingId },
      orderBy: { captionTime: 'asc' },
    });

    return apiJson({ captions, source: 'local' });
  } catch (err) {
    console.error('[transcripts GET]', err);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
