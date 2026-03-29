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

    const enhancedMeetings = meetings.map(m => {
      const isLive = activeRooms.includes(m.roomName);
      return {
        ...m,
        isActive: isLive,
        actualStartedAt: isLive && !m.actualStartedAt ? new Date(m.startedAt) : m.actualStartedAt
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
