import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/** Enough for a month of very busy days; the calendar only needs to know which days have meetings. */
const MAX_MEETINGS = 3000;

/**
 * GET /api/account/meetings/days?from=ISO&to=ISO[&scope=hosted][&search=]
 * The dates of the caller's meetings in [from, to), for the dots in the meeting list's date picker.
 * Each date is the meeting's scheduled time, or when it was created — what the list groups by.
 * The client buckets them by its own local day.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];

    const session = await prisma.session.findUnique({
      where: { token },
      include: { teamMember: true },
    });

    if (!session || !session.teamMember) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const member = session.teamMember;

    const { searchParams } = new URL(request.url);
    const from = new Date(searchParams.get('from') || '');
    const to = new Date(searchParams.get('to') || '');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      return NextResponse.json({ error: 'from and to must be ISO dates, from < to' }, { status: 400 });
    }
    const search = searchParams.get('search')?.trim() || '';
    const scope = searchParams.get('scope') === 'hosted' ? 'hosted' : 'all';

    const searchFilter: Prisma.MeetingWhereInput | null = search
      ? {
          OR: [
            { title: { contains: search } },
            { roomName: { contains: search } },
          ],
        }
      : null;
    const accessFilter: Prisma.MeetingWhereInput =
      scope === 'hosted'
        ? { createdByMemberId: member.id }
        : {
            OR: [
              { createdByMemberId: member.id },
              { participants: { some: { teamMemberId: member.id } } },
            ],
          };
    const rangeFilter: Prisma.MeetingWhereInput = {
      OR: [
        { scheduledFor: { gte: from, lt: to } },
        { scheduledFor: null, createdAt: { gte: from, lt: to } },
      ],
    };

    const meetings = await prisma.meeting.findMany({
      where: {
        deletedAt: null,
        AND: [accessFilter, rangeFilter, ...(searchFilter ? [searchFilter] : [])],
      },
      select: { scheduledFor: true, createdAt: true },
      take: MAX_MEETINGS,
    });

    return NextResponse.json({
      dates: meetings.map((m) => (m.scheduledFor ?? m.createdAt).toISOString()),
    });
  } catch (error) {
    console.error('[account meetings days GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
