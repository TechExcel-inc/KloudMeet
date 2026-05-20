import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { listActiveRoomNames } from '@/lib/livekitRooms';
import { isRoomLiveInList } from '@/lib/meetingRoomIsActive';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    
    // Fetch session
    const session = await prisma.session.findUnique({
      where: { token },
      include: { teamMember: true }
    });

    if (!session || !session.teamMember) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const member = session.teamMember;

    // Parse pagination
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '15', 10);
    const search = searchParams.get('search')?.trim() || '';
    const skip = (page - 1) * pageSize;

    const whereClause: any = {
      createdByMemberId: member.id,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { title: { contains: search } },
              { roomName: { contains: search } },
            ],
          }
        : {}),
    };

    const [total, meetings] = await Promise.all([
      prisma.meeting.count({ where: whereClause }),
      prisma.meeting.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          recordings: {
            select: {
              id: true,
              status: true,
              storageUrl: true,
              durationSeconds: true,
            }
          },
          createdByMember: {
            select: { fullName: true, username: true }
          },
          _count: {
            select: { participants: true }
          }
        }
      })
    ]);

    const activeRooms = await listActiveRoomNames();

    const enhancedMeetings = meetings.map(m => {
      const mx = m as any;
      const isLive = isRoomLiveInList(m.roomName, activeRooms);
      // DB 已结束则一律不算进行中（避免 LiveKit 延迟回收导致误显示 Live）
      const isActive =
        m.status === 'ENDED' || m.status === 'CANCELED' ? false : isLive;
      return {
        ...mx,
        isActive,
        actualStartedAt: isActive && !mx.actualStartedAt ? new Date(mx.startedAt) : mx.actualStartedAt
      };
    });

    return NextResponse.json({
      meetings: enhancedMeetings,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    });
  } catch (error) {
    console.error('[account meetings GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
