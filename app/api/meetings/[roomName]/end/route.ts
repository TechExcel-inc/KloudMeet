import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  canManageMeeting,
  forbidden,
  isAuthError,
  requireSession,
} from '@/lib/apiAuth';
import { deleteLiveKitRoom } from '@/lib/livekitRooms';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
) {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;

    const resolvedParams = await params;
    const roomName = resolvedParams?.roomName;
    if (!roomName) {
      return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });
    }

    const meeting = await prisma.meeting.findUnique({ where: { roomName } });
    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }
    if (!canManageMeeting(member.id, meeting)) {
      return forbidden('Only the meeting host can end this meeting');
    }

    if (meeting.status === 'ENDED') {
      return NextResponse.json({ success: true, meeting });
    }

    const endedAt = new Date();
    const startMs = (
      meeting.actualStartedAt ||
      meeting.startedAt
    ).getTime();
    const actualDurationMinutes = Math.max(
      1,
      Math.round((endedAt.getTime() - startMs) / 60000),
    );

    await deleteLiveKitRoom(roomName);

    const updated = await prisma.meeting.update({
      where: { roomName },
      data: {
        status: 'ENDED',
        endedAt,
        actualDurationMinutes: meeting.actualDurationMinutes ?? actualDurationMinutes,
      },
    });

    return NextResponse.json({ success: true, meeting: updated });
  } catch (error) {
    console.error('[meetings end POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
