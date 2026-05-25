import { prisma } from '@/lib/db';
import {
  findKloudMemberHostInLiveRoom,
  listActiveRoomNames,
} from '@/lib/livekitRooms';
import {
  isRoomLiveInList,
  type MeetingRecordForActiveCheck,
} from '@/lib/meetingRoomIsActive';
import { isPrismaConnectionError } from '@/lib/prismaErrors';
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

export type ResolvedMeetingPayload = {
  id: number;
  roomName: string;
  title: string | null;
  status: string;
  actualStartedAt: Date | null;
  scheduledFor: Date | null;
  createdByMemberId: number;
  isActive: true;
};

export type RoomEntryResolution =
  | { kind: 'not_found' }
  | {
      kind: 'direct_join';
      roomName: string;
      redirectTo: string;
    }
  | {
      kind: 'join_live';
      personalRoomId: string;
      effectiveRoomName: string;
      isPersonalSession: boolean;
      redirectTo: string;
      meeting: ResolvedMeetingPayload;
      owner: { id: number; displayName: string };
    }
  | {
      kind: 'open_personal_idle';
      personalRoomId: string;
      redirectTo: string;
      owner: { id: number; displayName: string };
    };

function buildPersonalRoomRedirectPath(
  effectiveRoomName: string,
  personalRoomId: string,
  action: 'join' | 'start' = 'join',
): string {
  const params = new URLSearchParams({ action, via: personalRoomId });
  return `/rooms/${encodeURIComponent(effectiveRoomName)}?${params.toString()}`;
}

function buildDirectMeetingJoinPath(
  roomName: string,
  action: 'join' | 'start' = 'join',
): string {
  return `/rooms/${encodeURIComponent(roomName)}?action=${action}`;
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

/** 访客入会：已结束/已取消/已删除的会即使 LiveKit 仍在也不解析进去 */
function isJoinableMeeting(record: MeetingRecordForActiveCheck): boolean {
  if (record.deletedAt) return false;
  const status = record.status;
  return status !== 'ENDED' && status !== 'CANCELED';
}

/** 该 LiveKit 房间名对应的 DB 会议（不限登记人，谁正在用这间房就跟谁） */
async function findJoinableMeetingByLiveRoom(
  liveRoomName: string,
): Promise<MeetingRecordForActiveCheck | null> {
  for (const rn of roomNameVariants(liveRoomName)) {
    const row = await prisma.meeting.findUnique({
      where: { roomName: rn },
      select: meetingSelect,
    });
    if (row && isJoinableMeeting(row)) {
      return row;
    }
  }
  return null;
}

async function findRegisteredOwnerMeetingByLiveRoom(
  liveRoomName: string,
  ownerId: number,
): Promise<MeetingRecordForActiveCheck | null> {
  const row = await findJoinableMeetingByLiveRoom(liveRoomName);
  if (row && row.createdByMemberId === ownerId) {
    return row;
  }
  return null;
}

async function memberHostInfo(memberId: number): Promise<{
  id: number;
  displayName: string;
} | null> {
  const member = await prisma.teamMember.findUnique({
    where: { id: memberId },
    select: { id: true, fullName: true, username: true },
  });
  if (!member) return null;
  return { id: member.id, displayName: ownerDisplayName(member) };
}

function toResolvedMeeting(
  record: MeetingRecordForActiveCheck,
): ResolvedMeetingPayload {
  return {
    id: record.id,
    roomName: record.roomName,
    title: record.title,
    status: record.status,
    actualStartedAt: record.actualStartedAt ?? record.startedAt,
    scheduledFor: record.scheduledFor,
    createdByMemberId: record.createdByMemberId,
    isActive: true,
  };
}

function ownerDisplayName(owner: {
  fullName: string | null;
  username: string;
}): string {
  return owner.fullName || owner.username;
}

function meetingStartedAtMs(record: MeetingRecordForActiveCheck): number {
  const d = record.actualStartedAt ?? record.startedAt;
  return d instanceof Date ? d.getTime() : new Date(d).getTime();
}

type LiveSessionResult = {
  effectiveRoomName: string;
  isPersonalSession: boolean;
  meeting: ResolvedMeetingPayload;
  hostMemberId: number;
};

/** 登记人正在个人房号码对应的 LiveKit 房间里（本人主持） */
async function resolveRegisteredOwnerLiveInPersonalRoom(
  personalRoomId: string,
  ownerId: number,
  owner: { fullName: string | null; username: string },
  activeRooms: string[],
): Promise<LiveSessionResult | null> {
  if (!isPreferredRoomLive(personalRoomId, activeRooms)) {
    return null;
  }

  const liveRn =
    preferredLiveRoomName(personalRoomId, activeRooms) ?? personalRoomId;
  const record = await findRegisteredOwnerMeetingByLiveRoom(liveRn, ownerId);
  if (record) {
    return {
      effectiveRoomName: record.roomName,
      isPersonalSession: true,
      meeting: toResolvedMeeting(record),
      hostMemberId: ownerId,
    };
  }

  const liveHostId = await findKloudMemberHostInLiveRoom(liveRn);
  if (liveHostId !== ownerId) {
    return null;
  }

  return {
    effectiveRoomName: liveRn,
    isPersonalSession: true,
    meeting: {
      id: 0,
      roomName: liveRn,
      title: `${ownerDisplayName(owner)}'s Room`,
      status: 'ACTIVE',
      actualStartedAt: null,
      scheduledFor: null,
      createdByMemberId: ownerId,
      isActive: true,
    },
    hostMemberId: ownerId,
  };
}

/** 个人房号码在线但非登记人主持（他人占用该号码） */
async function resolvePersonalRoomOccupiedByOther(
  personalRoomId: string,
  registeredOwnerId: number,
  activeRooms: string[],
): Promise<LiveSessionResult | null> {
  if (!isPreferredRoomLive(personalRoomId, activeRooms)) {
    return null;
  }

  const liveRn =
    preferredLiveRoomName(personalRoomId, activeRooms) ?? personalRoomId;
  const record = await findJoinableMeetingByLiveRoom(liveRn);
  if (record && record.createdByMemberId !== registeredOwnerId) {
    return {
      effectiveRoomName: record.roomName,
      isPersonalSession: true,
      meeting: toResolvedMeeting(record),
      hostMemberId: record.createdByMemberId,
    };
  }

  const liveHostId = await findKloudMemberHostInLiveRoom(liveRn);
  if (liveHostId != null && liveHostId !== registeredOwnerId) {
    const hostMember = await memberHostInfo(liveHostId);
    if (!hostMember) {
      return null;
    }
    return {
      effectiveRoomName: liveRn,
      isPersonalSession: true,
      meeting: {
        id: 0,
        roomName: liveRn,
        title: `${hostMember.displayName}'s Room`,
        status: 'ACTIVE',
        actualStartedAt: null,
        scheduledFor: null,
        createdByMemberId: hostMember.id,
        isActive: true,
      },
      hostMemberId: hostMember.id,
    };
  }

  return null;
}

/** 登记人在「其它」LiveKit 房间进行中的会（个人房链接跟到真实会场，如 yieg-kgxf） */
async function resolveRegisteredOwnerOtherLiveSession(
  ownerId: number,
  personalRoomId: string,
  activeRooms: string[],
): Promise<LiveSessionResult | null> {
  let bestOther: {
    effectiveRoomName: string;
    meeting: ResolvedMeetingPayload;
    startedMs: number;
    hostMemberId: number;
  } | null = null;

  for (const liveName of activeRooms) {
    if (isSameRoom(liveName, personalRoomId)) {
      continue;
    }
    const record = await findRegisteredOwnerMeetingByLiveRoom(liveName, ownerId);
    if (!record) {
      continue;
    }
    const startedMs = meetingStartedAtMs(record);
    if (!bestOther || startedMs > bestOther.startedMs) {
      bestOther = {
        effectiveRoomName: record.roomName,
        meeting: toResolvedMeeting(record),
        startedMs,
        hostMemberId: record.createdByMemberId,
      };
    }
  }

  if (!bestOther) {
    return null;
  }

  return {
    effectiveRoomName: bestOther.effectiveRoomName,
    isPersonalSession: false,
    meeting: bestOther.meeting,
    hostMemberId: bestOther.hostMemberId,
  };
}

/**
 * /api/rooms/[roomName]/resolve 统一入口：
 * - 非任何人的 personalRoomId → direct_join，直接进该会议号
 * - 是个人房号 → 再走登记人会场解析
 */
export async function resolveRoomEntry(
  roomName: string,
): Promise<RoomEntryResolution> {
  const trimmed = roomName.trim();
  if (!trimmed) {
    return { kind: 'not_found' };
  }

  try {
    const registeredOwner = await findPersonalRoomOwner(trimmed);
    if (!registeredOwner) {
      return {
        kind: 'direct_join',
        roomName: trimmed,
        redirectTo: buildDirectMeetingJoinPath(trimmed, 'join'),
      };
    }

    return resolvePersonalRoomIdEntry(trimmed, registeredOwner);
  } catch (error) {
    if (isPrismaConnectionError(error)) {
      console.error('[resolveRoomEntry] database unavailable', error);
      return { kind: 'not_found' };
    }
    throw error;
  }
}

/**
 * 个人会议室入口（如 A999）→ 登记人当前真实会场。
 * redirectTo 形如 /rooms/yieg-kgxf?action=join&via=A999（via 永远是入口个人房号）
 */
async function resolvePersonalRoomIdEntry(
  personalRoomId: string,
  registeredOwner: {
    id: number;
    fullName: string | null;
    username: string;
  },
): Promise<RoomEntryResolution> {
  const trimmed = personalRoomId.trim();

  try {
    const activeRooms = await listActiveRoomNames();

    const other = await resolveRegisteredOwnerOtherLiveSession(
      registeredOwner.id,
      trimmed,
      activeRooms,
    );
    if (other) {
      const hostInfo =
        (await memberHostInfo(other.hostMemberId)) ?? {
          id: registeredOwner.id,
          displayName: ownerDisplayName(registeredOwner),
        };
      const redirectTo = buildPersonalRoomRedirectPath(
        other.effectiveRoomName,
        trimmed,
        'join',
      );
      return {
        kind: 'join_live',
        personalRoomId: trimmed,
        effectiveRoomName: other.effectiveRoomName,
        isPersonalSession: false,
        redirectTo,
        meeting: other.meeting,
        owner: hostInfo,
      };
    }

    const ownerInPersonal = await resolveRegisteredOwnerLiveInPersonalRoom(
      trimmed,
      registeredOwner.id,
      registeredOwner,
      activeRooms,
    );
    if (ownerInPersonal) {
      const hostInfo =
        (await memberHostInfo(ownerInPersonal.hostMemberId)) ?? {
          id: registeredOwner.id,
          displayName: ownerDisplayName(registeredOwner),
        };
      const redirectTo = buildPersonalRoomRedirectPath(
        ownerInPersonal.effectiveRoomName,
        trimmed,
        'join',
      );
      return {
        kind: 'join_live',
        personalRoomId: trimmed,
        effectiveRoomName: ownerInPersonal.effectiveRoomName,
        isPersonalSession: true,
        redirectTo,
        meeting: ownerInPersonal.meeting,
        owner: hostInfo,
      };
    }

    const occupied = await resolvePersonalRoomOccupiedByOther(
      trimmed,
      registeredOwner.id,
      activeRooms,
    );
    if (occupied) {
      const hostInfo =
        (await memberHostInfo(occupied.hostMemberId)) ?? {
          id: occupied.hostMemberId,
          displayName: 'Host',
        };
      const redirectTo = buildPersonalRoomRedirectPath(
        occupied.effectiveRoomName,
        trimmed,
        'join',
      );
      return {
        kind: 'join_live',
        personalRoomId: trimmed,
        effectiveRoomName: occupied.effectiveRoomName,
        isPersonalSession: true,
        redirectTo,
        meeting: occupied.meeting,
        owner: hostInfo,
      };
    }

    return {
      kind: 'open_personal_idle',
      personalRoomId: trimmed,
      redirectTo: buildPersonalRoomRedirectPath(trimmed, trimmed, 'join'),
      owner: {
        id: registeredOwner.id,
        displayName: ownerDisplayName(registeredOwner),
      },
    };
  } catch (error) {
    if (isPrismaConnectionError(error)) {
      console.error('[resolvePersonalRoomIdEntry] database unavailable', error);
      return { kind: 'not_found' };
    }
    throw error;
  }
}

/** 序列化给 API / 客户端 */
export function serializeRoomEntryResolution(resolution: RoomEntryResolution) {
  if (resolution.kind === 'not_found') {
    return resolution;
  }
  if (resolution.kind === 'join_live') {
    return {
      ...resolution,
      meeting: {
        ...resolution.meeting,
        actualStartedAt: resolution.meeting.actualStartedAt?.toISOString() ?? null,
        scheduledFor: resolution.meeting.scheduledFor?.toISOString() ?? null,
      },
    };
  }
  return resolution;
}
