import { prisma } from '@/lib/db';
import { listActiveRoomNames } from '@/lib/livekitRooms';
import {
  isRoomLiveInList,
  type MeetingRecordForActiveCheck,
} from '@/lib/meetingRoomIsActive';
import { findPersonalRoomOwner } from '@/lib/personalRoom';

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

function isPreferredRoomLive(
  preferred: string,
  activeRooms: string[],
): boolean {
  return roomNameVariants(preferred).some((rn) =>
    isRoomLiveInList(rn, activeRooms),
  );
}

function preferredLiveRoomName(
  preferred: string,
  activeRooms: string[],
): string | null {
  for (const rn of roomNameVariants(preferred)) {
    if (isRoomLiveInList(rn, activeRooms)) {
      return rn;
    }
  }
  return null;
}

/** LiveKit 在线即匹配 DB（含 ENDED，用于冲突检测） */
async function findHostMeetingByLiveRoom(
  liveRoomName: string,
  memberId: number,
): Promise<MeetingRecordForActiveCheck | null> {
  for (const rn of roomNameVariants(liveRoomName)) {
    const row = await prisma.meeting.findUnique({
      where: { roomName: rn },
      select: meetingSelect,
    });
    if (row && row.createdByMemberId === memberId) {
      return row;
    }
  }
  return null;
}

async function payloadForActiveLiveRoom(
  liveRoomName: string,
  memberId: number,
): Promise<ReturnType<typeof toPayload> | null> {
  const record = await findHostMeetingByLiveRoom(liveRoomName, memberId);
  if (record) {
    return toPayload(record, true);
  }

  const owner = await findPersonalRoomOwner(liveRoomName);
  if (owner?.id === memberId) {
    return toPayload(
      {
        id: 0,
        roomName: liveRoomName,
        title: `${owner.fullName || owner.username}'s Room`,
        status: 'ACTIVE',
        actualStartedAt: null,
        startedAt: new Date(),
        scheduledFor: null,
        createdByMemberId: memberId,
        deletedAt: null,
      },
      true,
    );
  }

  return null;
}

/**
 * active-meeting（仅主持人）：
 * - 以 LiveKit 在线房间为准（含 DB 已 ENDED 但房间未回收）
 * - 带 preferred（如 My Room A999）时：先找「其它」在线会，再找 preferred 本身是否在线
 */
export async function resolveHostActiveMeeting(
  memberId: number,
  preferredRoomName?: string | null,
): Promise<ReturnType<typeof toPayload> | null> {
  const preferred = preferredRoomName?.trim() || null;

  const activeRooms = await listActiveRoomNames();
  if (activeRooms.length === 0) {
    return null;
  }

  // 1) 其它在线房间（开 My Room 时必须先发现正在进行的普通会议等）
  for (const liveName of activeRooms) {
    if (preferred && isSameRoom(liveName, preferred)) {
      continue;
    }
    const payload = await payloadForActiveLiveRoom(liveName, memberId);
    if (payload) {
      return payload;
    }
  }

  // 2) preferred 本身已在 LiveKit（同房间继续 / 冲突）
  if (preferred && isPreferredRoomLive(preferred, activeRooms)) {
    const liveRn = preferredLiveRoomName(preferred, activeRooms);
    if (liveRn) {
      const payload = await payloadForActiveLiveRoom(liveRn, memberId);
      if (payload) {
        return payload;
      }
    }
  }

  // 3) 无 preferred：专属会议室在线但 DB 已归档
  if (!preferred) {
    const member = await prisma.teamMember.findUnique({
      where: { id: memberId },
      select: { personalRoomId: true, fullName: true, username: true },
    });
    const prId = member?.personalRoomId?.trim();
    if (prId && isRoomLiveInList(prId, activeRooms)) {
      const payload = await payloadForActiveLiveRoom(prId, memberId);
      if (payload) {
        return payload;
      }
    }
  }

  return null;
}
