import { prisma } from '@/lib/db';
import {
  findPersonalRoomOwner,
  resolveCanonicalRoomName,
} from '@/lib/personalRoom';
import { RoomServiceClient } from 'livekit-server-sdk';

const LIVEKIT_URL =
  process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

function roomNameVariants(roomName: string): string[] {
  const trimmed = roomName.trim();
  return [...new Set([trimmed, trimmed.toLowerCase(), trimmed.toUpperCase()])];
}

/**
 * 与 GET /api/meetings/[roomName] 中 isActive 的计算方式完全一致。
 */
export async function getMeetingIsActiveByRoomName(
  roomName: string,
): Promise<boolean> {
  const trimmed = roomName?.trim();
  if (!trimmed) return false;

  try {
    if (LIVEKIT_URL && API_KEY && API_SECRET) {
      const roomService = new RoomServiceClient(
        LIVEKIT_URL,
        API_KEY,
        API_SECRET,
      );
      for (const rn of roomNameVariants(trimmed)) {
        const matched = await roomService.listRooms([rn]);
        if (matched && matched.length > 0) {
          return true;
        }
      }
      const allRooms = await roomService.listRooms();
      return isRoomLiveInList(trimmed, allRooms.map((r) => r.name));
    }
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
 * 仅在「即将入会」时调用：专属会议室 ENDED 后归档并创建新 ACTIVE 记录。
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
  const shouldRecyclePersonalRoom =
    !meeting ||
    (typeof meeting.status === 'string' &&
      recycleStatuses.includes(meeting.status));

  if (shouldRecyclePersonalRoom) {
    if (owner) {
      if (
        meeting &&
        typeof meeting.status === 'string' &&
        recycleStatuses.includes(meeting.status)
      ) {
        const archiveFrom = meeting.roomName;
        await prisma.meeting.update({
          where: { id: meeting.id },
          data: { roomName: `${archiveFrom}_${meeting.id}` },
        });
      }
      meeting = await prisma.meeting.create({
        data: {
          roomName: canonical,
          createdByMemberId: owner.id,
          title: `${owner.fullName || owner.username}'s Room`,
          status: 'ACTIVE',
        },
        select: meetingSelect,
      });
    }
  }

  return meeting;
}
