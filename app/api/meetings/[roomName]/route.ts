import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  findMeetingByRoomName,
  getMeetingIsActiveByRoomName,
} from '@/lib/meetingRoomIsActive';
import { findPersonalRoomOwner } from '@/lib/personalRoom';
import {
  canManageMeeting,
  forbidden,
  isAuthError,
  publicMeetingPayload,
  requireSession,
} from '@/lib/apiAuth';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';

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

    let meetingCore = await findMeetingByRoomName(roomName);
    if (!meetingCore) {
      const owner = await findPersonalRoomOwner(roomName);
      if (!owner) {
        return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
      }
      // 专属会议室无当前场次记录时仍可入会（connection-details 会创建新场次）
      return NextResponse.json({
        roomName,
        title: `${owner.fullName || owner.username}'s Room`,
        status: 'ACTIVE',
        isActive: await getMeetingIsActiveByRoomName(roomName),
        createdByMemberId: owner.id,
        isPersonalRoom: true,
      });
    }

    let meeting = await prisma.meeting.findUnique({
      where: { id: meetingCore.id },
      include: {
        createdByMember: {
          select: { fullName: true, username: true },
        },
        recordings: true,
      },
    });

    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const isActive = await getMeetingIsActiveByRoomName(roomName);

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

    const payload = { ...meeting, status: currentStatus, isActive };
    const sessionMember = await getSessionTeamMember(request);
    if (
      sessionMember &&
      canManageMeeting(sessionMember.id, { createdByMemberId: meeting.createdByMemberId })
    ) {
      return NextResponse.json(payload);
    }
    return NextResponse.json(publicMeetingPayload(payload as Record<string, unknown>));
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
    const member = await requireSession(request);
    if (isAuthError(member)) return member;

    const resolvedParams = await params;
    const roomName = resolvedParams?.roomName;
    if (!roomName) return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });

    const body = await request.json();
    const { title, description, scheduledFor, durationMinutes, timezone, status, actualStartedAt, endedAt } = body;

    const current = await prisma.meeting.findUnique({ where: { roomName } });
    if (!current) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    if (!canManageMeeting(member.id, current)) {
      return forbidden('Only the meeting host can update this meeting');
    }

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
    const member = await requireSession(request);
    if (isAuthError(member)) return member;

    const resolvedParams = await params;
    const roomName = resolvedParams?.roomName;
    if (!roomName) return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });

    const current = await prisma.meeting.findUnique({ where: { roomName } });
    if (!current) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    if (!canManageMeeting(member.id, current)) {
      return forbidden('Only the meeting host can delete this meeting');
    }

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
