import { NextRequest } from 'next/server';
import { Prisma, type Prisma as PrismaTypes } from '@prisma/client';
import { prisma } from '@/lib/db';
import { listRoomsByNames } from '@/lib/livekitRooms';
import { isRoomLiveInList } from '@/lib/meetingRoomIsActive';
import {
  expireIdleMeetingIfNeeded,
  isMeetingPermanentlyClosed,
} from '@/lib/meetingRejoin';
import { fillShareKeys } from '@/lib/recordingShare';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { attendanceOverlapsRecording } from '@/lib/recordingAttendance';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

/** ids=1,2,3 from the home page's 30s refresh: status only, for meetings this member can see. */
function parseMeetingIds(raw: string): number[] {
  const ids: number[] = [];
  for (const part of raw.split(',')) {
    const id = Number(part);
    if (Number.isInteger(id) && id > 0) ids.push(id);
    if (ids.length >= 50) break;
  }
  return ids;
}

/** A meeting's date is its scheduled time, or when it was created — the same date the list groups by. */
function meetingDatedBefore(before: Date): PrismaTypes.MeetingWhereInput {
  return {
    OR: [
      { scheduledFor: { lt: before } },
      { scheduledFor: null, createdAt: { lt: before } },
    ],
  };
}

export async function GET(request: NextRequest) {
  return runWithLocale(request, async () => {
  try {
    // requireSession also rejects expired sessions and inactive members.
    const member = await requireSession(request);
    if (isAuthError(member)) return member;

    const { searchParams } = new URL(request.url);
    const idsParam = searchParams.get('ids');
    if (idsParam !== null) {
      const ids = parseMeetingIds(idsParam);
      if (ids.length === 0) return apiJson({ meetings: [] });
      const rows = await prisma.meeting.findMany({
        where: {
          id: { in: ids },
          deletedAt: null,
          OR: [
            { createdByMemberId: member.id },
            { participants: { some: { teamMemberId: member.id } } },
          ],
        },
        select: {
          id: true,
          roomName: true,
          status: true,
          endedAt: true,
          endedReason: true,
          actualStartedAt: true,
          actualDurationMinutes: true,
          rejoinableUntil: true,
          roomEmptyAt: true,
          createdByMemberId: true,
          startedAt: true,
        },
      });
      const afterIdle = await Promise.all(rows.map((row) => expireIdleMeetingIfNeeded(row)));
      const openNames = afterIdle
        .filter((row) => !isMeetingPermanentlyClosed(row.status))
        .map((row) => row.roomName);
      const live = openNames.length > 0 ? (await listRoomsByNames(openNames)) ?? [] : [];
      const byId = new Map(afterIdle.map((row) => [row.id, row]));
      const meetings = ids.flatMap((id) => {
        const row = byId.get(id);
        if (!row) return [];
        return [{
          id: row.id,
          roomName: row.roomName,
          status: row.status,
          isActive: isMeetingPermanentlyClosed(row.status) ? false : isRoomLiveInList(row.roomName, live),
          isIdle: row.status === 'IDLE',
          endedAt: row.endedAt,
          endedReason: row.endedReason,
          actualStartedAt: row.actualStartedAt,
          actualDurationMinutes: row.actualDurationMinutes,
          rejoinableUntil: row.rejoinableUntil,
        }];
      });
      return apiJson({ meetings });
    }

    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '15', 10);
    const search = searchParams.get('search')?.trim() || '';
    const scope = searchParams.get('scope') === 'hosted' ? 'hosted' : 'all';
    const skip = (page - 1) * pageSize;
    // Go to date: only meetings dated before this instant (the start of the day after the picked one)
    const beforeParam = searchParams.get('before');
    const before = beforeParam ? new Date(beforeParam) : null;
    const beforeFilter: PrismaTypes.MeetingWhereInput | null =
      before && !Number.isNaN(before.getTime()) ? meetingDatedBefore(before) : null;

    const searchFilter: PrismaTypes.MeetingWhereInput | null = search
      ? {
          OR: [
            { title: { contains: search } },
            { roomName: { contains: search } },
          ],
        }
      : null;
    const accessFilter: PrismaTypes.MeetingWhereInput =
      scope === 'hosted'
        ? { createdByMemberId: member.id }
        : {
            OR: [
              { createdByMemberId: member.id },
              { participants: { some: { teamMemberId: member.id } } },
            ],
          };
    const whereClause: PrismaTypes.MeetingWhereInput = {
      deletedAt: null,
      AND: [accessFilter, ...(searchFilter ? [searchFilter] : []), ...(beforeFilter ? [beforeFilter] : [])],
    };

    // Personal rooms keep one row (A999) until End for all. Order by the latest
    // session — a recording, the real start, or the end — not the day the row was created.
    const accessSql =
      scope === 'hosted'
        ? Prisma.sql`m.createdByMemberId = ${member.id}`
        : Prisma.sql`(m.createdByMemberId = ${member.id} OR EXISTS (
            SELECT 1 FROM MeetingParticipant p
            WHERE p.meetingId = m.id AND p.teamMemberId = ${member.id}
          ))`;
    const searchSql = search
      ? Prisma.sql`AND (m.title LIKE ${`%${search}%`} OR m.roomName LIKE ${`%${search}%`})`
      : Prisma.empty;
    const beforeSql =
      before && !Number.isNaN(before.getTime())
        ? Prisma.sql`AND (m.scheduledFor < ${before} OR (m.scheduledFor IS NULL AND m.createdAt < ${before}))`
        : Prisma.empty;
    // Latest recording time is per meeting (Recording.meetingId), not a scan of every recording.
    const idRows = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT m.id
      FROM Meeting m
      WHERE m.deletedAt IS NULL
        AND ${accessSql}
        ${searchSql}
        ${beforeSql}
      ORDER BY
        CASE WHEN m.scheduledFor IS NOT NULL THEN m.scheduledFor
        ELSE GREATEST(
          m.createdAt,
          IFNULL(m.actualStartedAt, m.createdAt),
          IFNULL(m.endedAt, m.createdAt),
          IFNULL((SELECT MAX(r.createdAt) FROM Recording r WHERE r.meetingId = m.id AND r.deletedAt IS NULL), m.createdAt)
        ) END DESC
      LIMIT ${pageSize} OFFSET ${skip}
    `);
    const pageIds = idRows.map((row) => Number(row.id));

    const [total, unordered] = await Promise.all([
      prisma.meeting.count({ where: whereClause }),
      pageIds.length
        ? prisma.meeting.findMany({
            where: { id: { in: pageIds } },
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
          })
        : Promise.resolve([]),
    ]);
    const byId = new Map(unordered.map((m) => [m.id, m]));
    const meetings = pageIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });

    const meetingsAfterIdle = await Promise.all(
      meetings.map((m) => expireIdleMeetingIfNeeded(m)),
    );
    const openNames = meetingsAfterIdle
      .filter((m) => !isMeetingPermanentlyClosed(m.status))
      .map((m) => m.roomName);
    const activeRooms = openNames.length > 0 ? (await listRoomsByNames(openNames)) ?? [] : [];

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

    return apiJson({
      meetings: enhancedMeetings,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error('[account meetings GET]', error);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
