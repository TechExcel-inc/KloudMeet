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

    let meeting = await prisma.meeting.findUnique({
      where: {
        roomName,
      },
      include: {
        createdByMember: {
          select: { fullName: true, username: true },
        },
        recordings: true,
      },
    });

    // Personal room handling: supports creating a new session each time
    // Trigger when: meeting not found OR previous session has ended
    if (!meeting || meeting.status === 'ENDED') {
      const owner = await prisma.teamMember.findFirst({
        where: { personalRoomId: roomName },
      });
      if (owner) {
        // Archive the old ENDED record so it stays as history (rename its roomName)
        if (meeting && meeting.status === 'ENDED') {
          await prisma.meeting.update({
            where: { id: meeting.id },
            data: { roomName: `${roomName}_${meeting.id}` },
          });
        }
        // Create a fresh session record
        const title = `${owner.fullName || owner.username}'s Room`;
        meeting = await prisma.meeting.create({
          data: {
            roomName,
            createdByMemberId: owner.id,
            title,
            status: 'ACTIVE',
          },
          include: {
            createdByMember: {
              select: { fullName: true, username: true },
            },
            recordings: true,
          },
        }) as any;
      }
    }

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

    // Auto update status to PAST_DUE if scheduled time has passed and not currently active
    let currentStatus = meeting.status;
    if (currentStatus === 'ACTIVE' && !isActive && meeting.scheduledFor) {
      const isPast = meeting.scheduledFor < new Date(Date.now() - 5 * 60000); // 5 minutes grace period
      if (isPast) {
        await prisma.meeting.update({
          where: { id: meeting.id },
          data: { status: 'PAST_DUE' }
        });
        currentStatus = 'PAST_DUE';
      }
    }

    return NextResponse.json({ ...meeting, status: currentStatus, isActive });
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
    const { title, description, scheduledFor, durationMinutes, timezone, status, actualStartedAt, endedAt } = body;

    // Fetch current meeting to avoid overwriting webhook-provided values
    const current = await prisma.meeting.findUnique({ where: { roomName } });
    if (!current) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (scheduledFor !== undefined) data.scheduledFor = new Date(scheduledFor);
    if (durationMinutes !== undefined) data.durationMinutes = durationMinutes;
    if (timezone !== undefined) data.timezone = timezone;
    if (status !== undefined) data.status = status;

    // Only set actualStartedAt if not already set (webhook has priority)
    if (actualStartedAt && !current.actualStartedAt) {
      data.actualStartedAt = new Date(actualStartedAt);
    }

    // Calculate actualDurationMinutes when ending a meeting
    if (endedAt && current.status !== 'ENDED') {
      data.endedAt = new Date(endedAt);
      data.status = 'ENDED';
      const startMs = (current.actualStartedAt || data.actualStartedAt || current.startedAt).getTime
        ? new Date(current.actualStartedAt || data.actualStartedAt || current.startedAt).getTime()
        : Date.now();
      const endMs = new Date(endedAt).getTime();
      if (!current.actualDurationMinutes) {
        data.actualDurationMinutes = Math.max(1, Math.round((endMs - startMs) / 60000));
      }
    }

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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> }
) {
  try {
    const resolvedParams = await params;
    const roomName = resolvedParams?.roomName;
    if (!roomName) return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });

    const updated = await prisma.meeting.update({
      where: { roomName },
      data: { deletedAt: new Date() }
    });
    return NextResponse.json({ success: true, meeting: updated });
  } catch (error) {
    console.error('[meetings DELETE]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
