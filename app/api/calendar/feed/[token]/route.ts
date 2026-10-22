import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { buildCalendarFeedIcs, feedWindow, FEED_MAX_EVENTS, parseFeedTokenParam } from '@/lib/calendar/feed';
import { ICS_RESPONSE_HEADERS, publicOrigin, toCalendarMeeting } from '@/lib/calendar/server';

/**
 * GET /api/calendar/feed/<token>.ics — read-only subscription feed of the member's scheduled
 * meetings. The unguessable token in the URL is the only credential (calendar apps cannot send
 * a session header); see lib/calendar/feed.ts for the security model.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const token = parseFeedTokenParam((await params)?.token);
    if (!token) return notFound();

    const member = await prisma.teamMember.findUnique({
      where: { calendarFeedToken: token },
      select: { id: true, fullName: true, username: true, status: true, deletedAt: true },
    });
    if (!member || member.status !== 'ACTIVE' || member.deletedAt) return notFound();

    const now = new Date();
    const { from, to } = feedWindow(now);
    const rows = await prisma.meeting.findMany({
      where: {
        createdByMemberId: member.id,
        deletedAt: null,
        status: { not: 'CANCELED' },
        scheduledFor: { gte: from, lte: to },
      },
      orderBy: { scheduledFor: 'asc' },
      take: FEED_MAX_EVENTS,
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
        createdByMember: { select: { fullName: true, username: true } },
      },
    });

    const meetings = rows.flatMap((row) =>
      row.scheduledFor ? [toCalendarMeeting({ ...row, scheduledFor: row.scheduledFor })] : [],
    );
    const body = buildCalendarFeedIcs(meetings, {
      origin: publicOrigin(request),
      calendarName: 'Kloud Meet',
      now,
    });

    return new NextResponse(body, {
      status: 200,
      headers: {
        ...ICS_RESPONSE_HEADERS,
        'Content-Disposition': 'inline; filename="kloud-meet.ics"',
        'X-Robots-Tag': 'noindex, nofollow',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    console.error('[calendar feed GET]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
