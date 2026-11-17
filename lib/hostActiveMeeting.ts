import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { listActiveRoomNamesOrNull } from '@/lib/livekitRooms';
import {
  isRoomLiveInList,
  type MeetingRecordForActiveCheck,
} from '@/lib/meetingRoomIsActive';

const meetingSelect = {
  id: true,
  roomName: true,
  title: true,
  status: true,
  actualStartedAt: true,
  startedAt: true,
  scheduledFor: true,
  createdByMemberId: true,
  deletedAt: true,
  endedReason: true,
  rejoinableUntil: true,
  roomEmptyAt: true,
} as const;

function toPayload(meeting: MeetingRecordForActiveCheck, isActive: boolean) {
  return {
    id: meeting.id,
    roomName: meeting.roomName,
    title: meeting.title,
    status: meeting.status,
    actualStartedAt: meeting.actualStartedAt ?? meeting.startedAt,
    scheduledFor: meeting.scheduledFor,
    isActive,
  };
}

function roomNameVariants(roomName: string): string[] {
  const trimmed = roomName.trim();
  return [...new Set([trimmed, trimmed.toLowerCase(), trimmed.toUpperCase()])];
}

function isSameRoom(a: string, b: string): boolean {
  return roomNameVariants(a).some(
    (v) => roomNameVariants(b).includes(v) || v === b || v === a,
  );
}

function payloadFor(
  liveName: string,
  rows: MeetingRecordForActiveCheck[],
  member: { personalRoomId: string | null; fullName: string | null; username: string } | null,
  memberId: number,
): ReturnType<typeof toPayload> | null {
  const record =
    rows.find((row) => row.roomName === liveName) ??
    rows.find((row) => isRoomLiveInList(row.roomName, [liveName]));
  if (record) return toPayload(record, true);

  const personal = member?.personalRoomId?.trim();
  if (!personal || !member || !isRoomLiveInList(personal, [liveName])) return null;
  return toPayload(
    {
      id: 0,
      roomName: liveName,
      title: `${member.fullName || member.username}'s Room`,
      status: 'ACTIVE',
      actualStartedAt: null,
      startedAt: new Date(),
      scheduledFor: null,
      createdByMemberId: memberId,
      deletedAt: null,
      endedReason: null,
      rejoinableUntil: null,
      roomEmptyAt: null,
    },
    true,
  );
}

/**
 * active-meeting（仅主持人）：
 * - 以 LiveKit 在线房间为准（含 DB 已 ENDED 但房间未回收）
 * - 带 preferred（如 My Room A999）时：先找「其它」在线会，再找 preferred 本身是否在线
 * 在线名单只拉一次；属于这个主持人的会议用一条查询对上，不再按房间逐条查库。
 * `knownLive` 由调用方传入时不再问 LiveKit。null 表示问过了但失败。
 */
export async function resolveHostActiveMeeting(
  memberId: number,
  preferredRoomName?: string | null,
  knownLive?: string[] | null,
): Promise<ReturnType<typeof toPayload> | null> {
  const preferred = preferredRoomName?.trim() || null;
  const live = knownLive === undefined ? await listActiveRoomNamesOrNull() : knownLive;
  if (!live || live.length === 0) return null;

  const keys = [...new Set(live.map((name) => name.trim().toLowerCase()).filter(Boolean))];
  if (keys.length === 0) return null;

  const [idRows, member] = await Promise.all([
    prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT id FROM Meeting
      WHERE createdByMemberId = ${memberId}
        AND LOWER(roomName) IN (${Prisma.join(keys)})
    `),
    prisma.teamMember.findUnique({
      where: { id: memberId },
      select: { personalRoomId: true, fullName: true, username: true },
    }),
  ]);
  const ids = idRows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id));
  const rows = ids.length
    ? await prisma.meeting.findMany({ where: { id: { in: ids } }, select: meetingSelect })
    : [];

  for (const liveName of live) {
    if (preferred && isSameRoom(liveName, preferred)) continue;
    const payload = payloadFor(liveName, rows, member, memberId);
    if (payload) return payload;
  }

  if (!preferred) return null;
  const preferredLive = live.find((name) => isSameRoom(name, preferred));
  if (!preferredLive) return null;
  return payloadFor(preferredLive, rows, member, memberId);
}
