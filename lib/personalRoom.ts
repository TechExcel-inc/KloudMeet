import { prisma } from '@/lib/db';

/** 是否为某成员的专属会议室 roomName */
export async function findPersonalRoomOwner(roomName: string) {
  const trimmed = roomName.trim();
  if (!trimmed) return null;
  return prisma.teamMember.findFirst({
    where: {
      OR: [
        { personalRoomId: trimmed },
        { personalRoomId: trimmed.toLowerCase() },
        { personalRoomId: trimmed.toUpperCase() },
      ],
    },
  });
}

/**
 * 专属会议室结束后归档：A999 → A999_{id}，列表不再显示为「进行中」的 A999。
 */
export async function archivePersonalRoomMeeting(meeting: {
  id: number;
  roomName: string;
  createdByMemberId: number;
}): Promise<void> {
  const owner = await findPersonalRoomOwner(meeting.roomName);
  // 仅归档「自己的」专属会议室，避免普通会议 roomName 与他人 personalRoomId 撞号
  if (!owner || owner.id !== meeting.createdByMemberId) return;

  const archivedName = `${meeting.roomName}_${meeting.id}`;
  if (meeting.roomName === archivedName) return;

  await prisma.meeting.update({
    where: { id: meeting.id },
    data: { roomName: archivedName },
  });
}
