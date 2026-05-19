import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { listActiveRoomNames } from '@/lib/livekitRooms';
import { isAuthError, requireSession } from '@/lib/apiAuth';

export async function GET(request: NextRequest) {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;

    const activeRoomNames = await listActiveRoomNames();
    if (activeRoomNames.length === 0) {
      return NextResponse.json({ hasActive: false });
    }

    const meetings = await prisma.meeting.findMany({
      where: {
        createdByMemberId: member.id,
        deletedAt: null,
        status: { not: 'ENDED' },
        roomName: { in: activeRoomNames },
      },
      orderBy: { actualStartedAt: 'desc' },
      take: 1,
      select: {
        id: true,
        roomName: true,
        title: true,
        status: true,
        actualStartedAt: true,
        startedAt: true,
        scheduledFor: true,
      },
    });

    const meeting = meetings[0];
    if (!meeting) {
      return NextResponse.json({ hasActive: false });
    }

    return NextResponse.json({
      hasActive: true,
      meeting: {
        id: meeting.id,
        roomName: meeting.roomName,
        title: meeting.title,
        status: meeting.status,
        actualStartedAt: meeting.actualStartedAt ?? meeting.startedAt,
        scheduledFor: meeting.scheduledFor,
      },
    });
  } catch (error) {
    console.error('[account active-meeting GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
