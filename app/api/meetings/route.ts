import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      roomName, 
      createdByMemberId,
      title,
      description,
      scheduledFor,
      durationMinutes,
      timezone,
      status
    } = body;

    if (!roomName || !createdByMemberId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const meeting = await prisma.meeting.create({
      data: {
        roomName,
        createdByMemberId,
        title,
        description,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
        durationMinutes,
        timezone,
        status: status || 'ACTIVE',
      },
    });

    return NextResponse.json(meeting);
  } catch (error) {
    console.error('[meetings POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
