import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { buildMeetingIcs, icsContentDisposition, meetingTitle } from '@/lib/calendar/ics';
import { meetingJoinUrl } from '@/lib/calendar/links';
import { ICS_RESPONSE_HEADERS, publicOrigin, toCalendarMeeting } from '@/lib/calendar/server';

/**
 * GET /api/meetings/:roomName/calendar.ics — the meeting as an iCalendar file.
 * Anyone with the meeting link may download it (same as joining). Contents are limited to
 * what "Copy Invite" already shares: title, time, duration, description, host name, link.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
) {
  try {
    const roomName = (await params)?.roomName?.trim();
    if (!roomName) {
      return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });
    }

    const meeting = await prisma.meeting.findUnique({
      where: { roomName },
      select: {
        roomName: true,
        title: true,
        description: true,
        scheduledFor: true,
        durationMinutes: true,
        timezone: true,
        status: true,
        createdAt: true,
        modifiedAt: true,
        deletedAt: true,
        createdByMember: { select: { fullName: true, username: true } },
      },
    });
    if (!meeting || meeting.deletedAt) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }
    const { scheduledFor } = meeting;
    if (!scheduledFor) {
      return NextResponse.json({ error: 'Meeting is not scheduled' }, { status: 404 });
    }

    const calendarMeeting = toCalendarMeeting({ ...meeting, scheduledFor });
    const joinUrl = meetingJoinUrl(publicOrigin(request), meeting.roomName);
    const body = buildMeetingIcs(calendarMeeting, { joinUrl });

    return new NextResponse(body, {
      status: 200,
      headers: {
        ...ICS_RESPONSE_HEADERS,
        'Content-Disposition': icsContentDisposition(meetingTitle(calendarMeeting)),
      },
    });
  } catch (error) {
    console.error('[meetings calendar.ics GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
