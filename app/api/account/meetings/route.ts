import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { RoomServiceClient } from 'livekit-server-sdk';

const LIVEKIT_URL = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

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
    const skip = (page - 1) * pageSize;

    const whereClause = {
      createdByMemberId: member.id,
      deletedAt: null,
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

    // REST API Fallback check for active LiveKit rooms
    let activeRooms: string[] = [];
    try {
      if (LIVEKIT_URL && API_KEY && API_SECRET) {
        const roomService = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
        const rooms = await roomService.listRooms();
        activeRooms = rooms.map(r => r.name);
      }
    } catch (e) {
      console.error('[account meetings GET] LiveKit fallback query failed', e);
    }

    // ── Auto-cleanup: mark stale ACTIVE meetings as ENDED ──
    // If DB says ACTIVE but LiveKit says room no longer exists,
    // the webhook was missed (e.g. last person closed browser).
    const staleIds: number[] = [];
    for (const m of meetings) {
      if (
        m.status === 'ACTIVE' &&
        !activeRooms.includes(m.roomName)
      ) {
        staleIds.push(m.id);
      }
    }
    if (staleIds.length > 0) {
      const now = new Date();
      await prisma.meeting.updateMany({
        where: { id: { in: staleIds } },
        data: {
          status: 'ENDED',
          endedAt: now,
        },
      });
      console.log(`[account meetings] auto-ended ${staleIds.length} stale meeting(s)`);
    }

    const enhancedMeetings = meetings.map(m => {
      const mx = m as any;
      const isLive = activeRooms.includes(m.roomName);
      // If we just auto-ended it above, reflect that
      const effectiveStatus = staleIds.includes(m.id) ? 'ENDED' : m.status;
      const isActive = effectiveStatus === 'ENDED' ? false : isLive;
      return {
        ...mx,
        status: effectiveStatus,
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
