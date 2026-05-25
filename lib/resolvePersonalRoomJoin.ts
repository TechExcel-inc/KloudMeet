import { prisma } from '@/lib/db';
import {
  findKloudMemberHostInLiveRoom,
  listActiveRoomNames,
} from '@/lib/livekitRooms';
import {
  getMeetingIsActiveByRoomName,
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
  | { kind: 'direct_join'; roomName: string }
  | {
      kind: 'join_live';
      personalRoomId: string;
      effectiveRoomName: string;
      isPersonalSession: boolean;
      meeting: ResolvedMeetingPayload;
      owner: { id: number; displayName: string };
    }
  | {
      kind: 'open_personal_idle';
      personalRoomId: string;
      owner: { id: number; displayName: string };
    };

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

/**
 * 是否在线：优先用已拉取的 activeRooms（与 listActiveRoomNames 同源，内存匹配）。
 * 仅当 LiveKit 列表拉取失败（空数组）时才按房间名单独查 LiveKit，避免 N 条会议 × 多次 RPC。
 */
async function isMeetingLiveNow(
  roomName: string,
  activeRooms: string[],
): Promise<boolean> {
  if (activeRooms.length > 0) {
    return isRoomLiveInList(roomName, activeRooms);
  }
  return getMeetingIsActiveByRoomName(roomName);
}

/**
 * 从 DB 查登记人主持的会议，再用 LiveKit 校验是否在线（避免 listRooms 漏房间）。
 * 优先非 personalRoomId 的会场（如 yieg-kgxf），其次个人房号码本身。
 */
async function findOwnerJoinableMeetingFromDb(
  ownerId: number,
  personalRoomId: string,
  activeRooms: string[],
): Promise<LiveSessionResult | null> {
  const meetings = await prisma.meeting.findMany({
    where: {
      createdByMemberId: ownerId,
      deletedAt: null,
      status: { notIn: ['ENDED', 'CANCELED'] },
    },
    orderBy: [{ actualStartedAt: 'desc' }, { startedAt: 'desc' }],
    take: 10,
  });

  let bestOther: {
    record: MeetingRecordForActiveCheck;
    startedMs: number;
  } | null = null;
  let bestPersonal: {
    record: MeetingRecordForActiveCheck;
    startedMs: number;
  } | null = null;

  for (const record of meetings) {
    if (!isJoinableMeeting(record)) {
      continue;
    }
    if (!(await isMeetingLiveNow(record.roomName, activeRooms))) {
      continue;
    }

    const startedMs = meetingStartedAtMs(record);
    const isPersonal = isSameRoom(record.roomName, personalRoomId);

    if (isPersonal) {
      if (!bestPersonal || startedMs > bestPersonal.startedMs) {
        bestPersonal = { record, startedMs };
      }
    } else if (!bestOther || startedMs > bestOther.startedMs) {
      bestOther = { record, startedMs };
    }
  }

  const pick = bestOther ?? bestPersonal;
  if (!pick) {
    return null;
  }

  return {
    effectiveRoomName: pick.record.roomName,
    isPersonalSession: isSameRoom(pick.record.roomName, personalRoomId),
    meeting: toResolvedMeeting(pick.record),
    hostMemberId: ownerId,
  };
}

/** 补充：LiveKit 在线房间与 DB 登记人会议匹配（list 扫描） */
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

async function resolveOwnerActiveSession(
  ownerId: number,
  personalRoomId: string,
  activeRooms: string[],
): Promise<LiveSessionResult | null> {
  const fromDb = await findOwnerJoinableMeetingFromDb(
    ownerId,
    personalRoomId,
    activeRooms,
  );
  if (fromDb) {
    return fromDb;
  }
  return resolveRegisteredOwnerOtherLiveSession(
    ownerId,
    personalRoomId,
    activeRooms,
  );
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
      return { kind: 'direct_join', roomName: trimmed };
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

/** 个人会议室入口（如 A999）→ 登记人当前真实会场 */
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

    const ownerActive = await resolveOwnerActiveSession(
      registeredOwner.id,
      trimmed,
      activeRooms,
    );
    if (ownerActive) {
      const hostInfo =
        (await memberHostInfo(ownerActive.hostMemberId)) ?? {
          id: registeredOwner.id,
          displayName: ownerDisplayName(registeredOwner),
        };
      return {
        kind: 'join_live',
        personalRoomId: trimmed,
        effectiveRoomName: ownerActive.effectiveRoomName,
        isPersonalSession: ownerActive.isPersonalSession,
        meeting: ownerActive.meeting,
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
      return {
        kind: 'join_live',
        personalRoomId: trimmed,
        effectiveRoomName: ownerInPersonal.effectiveRoomName,
        isPersonalSession: true,
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
      return {
        kind: 'join_live',
        personalRoomId: trimmed,
        effectiveRoomName: occupied.effectiveRoomName,
        isPersonalSession: true,
        meeting: occupied.meeting,
        owner: hostInfo,
      };
    }

    return {
      kind: 'open_personal_idle',
      personalRoomId: trimmed,
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
