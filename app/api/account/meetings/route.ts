import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { listActiveRoomNames } from '@/lib/livekitRooms';
import { isRoomLiveInList } from '@/lib/meetingRoomIsActive';
import {
  expireIdleMeetingIfNeeded,
  isMeetingPermanentlyClosed,
} from '@/lib/meetingRejoin';
import { fillShareKeys } from '@/lib/recordingShare';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { attendanceOverlapsRecording } from '@/lib/recordingAttendance';

/** A meeting's date is its scheduled time, or when it was created — the same date the list groups by. */
function meetingDatedBefore(before: Date): Prisma.MeetingWhereInput {
  return {
    OR: [
      { scheduledFor: { lt: before } },
      { scheduledFor: null, createdAt: { lt: before } },
    ],
  };
}

export async function GET(request: NextRequest) {
  try {
    // requireSession also rejects expired sessions and inactive members.
    const member = await requireSession(request);
    if (isAuthError(member)) return member;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '15', 10);
    const search = searchParams.get('search')?.trim() || '';
    const scope = searchParams.get('scope') === 'hosted' ? 'hosted' : 'all';
    const skip = (page - 1) * pageSize;
    // Go to date: only meetings dated before this instant (the start of the day after the picked one)
    const beforeParam = searchParams.get('before');
    const before = beforeParam ? new Date(beforeParam) : null;
    const beforeFilter: Prisma.MeetingWhereInput | null =
      before && !Number.isNaN(before.getTime()) ? meetingDatedBefore(before) : null;

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
    const whereClause: Prisma.MeetingWhereInput = {
      deletedAt: null,
      AND: [accessFilter, ...(searchFilter ? [searchFilter] : []), ...(beforeFilter ? [beforeFilter] : [])],
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
              shareKey: true,
              visibility: true,
              status: true,
              durationSeconds: true,
              teamMemberId: true,
              createdAt: true,
              mediaStartedAt: true,
            },
          },
          createdByMember: {
            select: { fullName: true, username: true },
          },
          _count: {
            select: { participants: true },
          },
        },
      }),
    ]);

    const activeRooms = await listActiveRoomNames();

    const meetingsAfterIdle = await Promise.all(
      meetings.map((m) => expireIdleMeetingIfNeeded(m)),
    );

    // Attendees only see recordings they started, PUBLIC ones, or ones made while they were in the room.
    const attendance = await prisma.meetingParticipant.findMany({
      where: {
        teamMemberId: member.id,
        meetingId: { in: meetingsAfterIdle.map((m) => m.id) },
      },
      select: { meetingId: true, joinedAt: true, leftAt: true },
    });
    const now = new Date();
    const visibleRecordings = (m: (typeof meetingsAfterIdle)[number]) => {
      if (m.createdByMemberId === member.id) return m.recordings;
      const windows = attendance.filter((a) => a.meetingId === m.id);
      return m.recordings.filter(
        (r) =>
          r.visibility === 'PUBLIC' ||
          r.teamMemberId === member.id ||
          windows.some((w) => attendanceOverlapsRecording(w, r, now)),
      );
    };

    const meetingsWithKeys = await Promise.all(
      meetingsAfterIdle.map(async (m) => ({
        ...m,
        recordings: await fillShareKeys(visibleRecordings(m)),
      })),
    );

    const enhancedMeetings = meetingsWithKeys.map((m) => {
      const mx = m as any;
      const isLive = isRoomLiveInList(m.roomName, activeRooms);
      const isActive = isMeetingPermanentlyClosed(m.status) ? false : isLive;
      return {
        ...mx,
        isActive,
        isIdle: m.status === 'IDLE',
        actualStartedAt:
          isActive && !mx.actualStartedAt
            ? new Date(mx.startedAt)
            : mx.actualStartedAt,
      };
    });

    return NextResponse.json({
      meetings: enhancedMeetings,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error('[account meetings GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
