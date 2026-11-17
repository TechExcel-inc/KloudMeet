import { prisma } from '@/lib/db';
import { listRoomsByNames } from '@/lib/livekitRooms';
import {
  findPersonalRoomOwner,
  resolveCanonicalRoomName,
} from '@/lib/personalRoom';

/**
 * 与 GET /api/meetings/[roomName] 中 isActive 的计算方式完全一致。
 * 只问这一个房号，不拉全服房间。
 */
export async function getMeetingIsActiveByRoomName(
  roomName: string,
): Promise<boolean> {
  const trimmed = roomName?.trim();
  if (!trimmed) return false;

  try {
    const live = await listRoomsByNames([trimmed]);
    return Boolean(live && live.length > 0);
  } catch (e) {
    console.error('[meetingRoomIsActive] LiveKit query failed', e);
  }

  return false;
}

/** 列表批量判断：roomName 与 LiveKit 房间名大小写不敏感匹配 */
export function isRoomLiveInList(
  roomName: string,
  activeRoomNames: string[],
): boolean {
  const key = roomName.trim().toLowerCase();
  if (!key) return false;
  return activeRoomNames.some((n) => n.trim().toLowerCase() === key);
}

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

export type MeetingRecordForActiveCheck = {
  id: number;
  roomName: string;
  title: string | null;
  status: string;
  actualStartedAt: Date | null;
  startedAt: Date;
  scheduledFor: Date | null;
  createdByMemberId: number;
  deletedAt: Date | null;
  endedReason: string | null;
  rejoinableUntil: Date | null;
  roomEmptyAt?: Date | null;
};

/** 只读查询，不会在 GET 时自动创建新专属会议室场次 */
export async function findMeetingByRoomName(
  roomName: string,
): Promise<MeetingRecordForActiveCheck | null> {
  const trimmed = roomName.trim();
  if (!trimmed) return null;

  return prisma.meeting.findUnique({
    where: { roomName: trimmed },
    select: meetingSelect,
  });
}

/**
 * 仅在「即将入会」时调用：专属会议室已结束或已删除时归档，并创建新 ACTIVE 记录。
 */
export async function ensurePersonalRoomMeeting(
  roomName: string,
): Promise<MeetingRecordForActiveCheck | null> {
  const trimmed = roomName.trim();
  if (!trimmed) return null;

  const canonical = await resolveCanonicalRoomName(trimmed);
  const owner = await findPersonalRoomOwner(canonical);

  let meeting =
    (await findMeetingByRoomName(canonical)) ??
    (canonical !== trimmed ? await findMeetingByRoomName(trimmed) : null);

  if (
    meeting &&
    owner &&
    meeting.roomName !== canonical &&
    meeting.roomName.toLowerCase() === canonical.toLowerCase()
  ) {
    meeting = await prisma.meeting.update({
      where: { id: meeting.id },
      data: { roomName: canonical },
      select: meetingSelect,
    });
  }

  const recycleStatuses = ['ENDED', 'CANCELED'];
  const closed =
    Boolean(meeting?.deletedAt) ||
    (typeof meeting?.status === 'string' &&
      recycleStatuses.includes(meeting.status));
  const shouldRecyclePersonalRoom = !meeting || closed;

  if (shouldRecyclePersonalRoom) {
    if (owner) {
      if (meeting && closed) {
        const archiveFrom = meeting.roomName;
        const archivedName = `${archiveFrom}_${meeting.id}`;
        if (archiveFrom !== archivedName) {
          await prisma.meeting.update({
            where: { id: meeting.id },
            data: { roomName: archivedName },
          });
        }
      }
      const { resolveMemberAccountId } = await import('@/lib/peerTimeCompany');
      const accountId = await resolveMemberAccountId(owner.id);
      // Each new session starts at the owner's default from My Profile (Public when unset).
      const { newMeetingAccessLevel } = await import('@/lib/meetingAccess.server');
      const accessLevel = await newMeetingAccessLevel(owner.id, accountId);
      meeting = await prisma.meeting.create({
        data: {
          roomName: canonical,
          createdByMemberId: owner.id,
          accountId: accountId ?? undefined,
          title: `${owner.fullName || owner.username}'s Room`,
          status: 'ACTIVE',
          accessLevel,
        },
        select: meetingSelect,
      });
    }
  }

  return meeting;
}
