import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { RoomServiceClient } from 'livekit-server-sdk';

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> }
) {
  try {
    const resolvedParams = await params;
    
    // Explicitly parse string properly as Next.js passes dynamic param objects
    const roomName = resolvedParams?.roomName;
    if (!roomName) {
      return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });
    }

    const meeting = await prisma.meeting.findUnique({
      where: {
        roomName,
      },
      include: {
        createdByMember: {
          select: {
            fullName: true,
            username: true,
          },
        },
      },
    });

    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    let isActive = false;
    try {
      if (LIVEKIT_URL && API_KEY && API_SECRET) {
        const roomService = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
        const activeRooms = await roomService.listRooms([roomName]);
        if (activeRooms && activeRooms.length > 0) {
          isActive = true;
        }
      }
    } catch (e) {
      console.error('[meetings GET] LiveKit query failed', e);
    }

    return NextResponse.json({ ...meeting, isActive });
  } catch (error) {
    console.error('[meetings GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> }
) {
  try {
    const resolvedParams = await params;
    const roomName = resolvedParams?.roomName;
    if (!roomName) return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });

    const body = await request.json();
    const { title, description, scheduledFor, durationMinutes, timezone, status } = body;

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (scheduledFor !== undefined) data.scheduledFor = new Date(scheduledFor);
    if (durationMinutes !== undefined) data.durationMinutes = durationMinutes;
    if (timezone !== undefined) data.timezone = timezone;
    if (status !== undefined) data.status = status;

    const updated = await prisma.meeting.update({
      where: { roomName },
      data
    });
    return NextResponse.json({ success: true, meeting: updated });
  } catch (error) {
    console.error('[meetings PUT]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
