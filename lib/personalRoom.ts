import { AsyncLocalStorage } from 'node:async_hooks';
import type { TeamMember } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isPrismaConnectionError } from '@/lib/prismaErrors';

const ownerMemo = new AsyncLocalStorage<Map<string, Promise<TeamMember | null>>>();

/** 同一次请求里，个人房号解析只查一次库。 */
export function withPersonalRoomMemo<T>(run: () => Promise<T>): Promise<T> {
  return ownerMemo.run(new Map(), run);
}

/**
 * 个人房号 URL 大小写不敏感；LiveKit / DB 统一用 TeamMember.personalRoomId 原样。
 * 非个人房号则返回 trim 后的原 roomName。
 */
export async function resolveCanonicalRoomName(roomName: string): Promise<string> {
  const trimmed = roomName.trim();
  if (!trimmed) return trimmed;
  const owner = await findPersonalRoomOwner(trimmed);
  const canonical = owner?.personalRoomId?.trim();
  return canonical || trimmed;
}

/** 是否已被其他成员占用（大小写不敏感） */
export async function isPersonalRoomIdTakenByOther(
  personalRoomId: string,
  memberId: number,
): Promise<boolean> {
  const holder = await findPersonalRoomOwner(personalRoomId.trim());
  return holder != null && holder.id !== memberId;
}

/**
 * 保存个人房号：他人已占用则拒绝；本人仅改大小写则保留 DB 已有写法。
 */
export async function resolvePersonalRoomIdForSave(
  requested: string,
  memberId: number,
): Promise<{ ok: true; personalRoomId: string } | { ok: false }> {
  const trimmed = requested.trim();
  const holder = await findPersonalRoomOwner(trimmed);
  if (holder && holder.id !== memberId) {
    return { ok: false };
  }
  if (holder?.personalRoomId?.trim()) {
    return { ok: true, personalRoomId: holder.personalRoomId.trim() };
  }
  return { ok: true, personalRoomId: trimmed };
}

async function queryPersonalOwner(key: string): Promise<TeamMember | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM TeamMember
      WHERE personalRoomId IS NOT NULL
        AND LOWER(TRIM(personalRoomId)) = ${key}
      LIMIT 1
    `;
    if (!rows[0]) return null;
    return prisma.teamMember.findUnique({ where: { id: rows[0].id } });
  } catch (error) {
    if (isPrismaConnectionError(error)) {
      console.error('[findPersonalRoomOwner] database unavailable', error);
      return null;
    }
    throw error;
  }
}

/** 是否为某成员的专属会议室 roomName（大小写不敏感） */
export async function findPersonalRoomOwner(roomName: string): Promise<TeamMember | null> {
  const trimmed = roomName.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  const store = ownerMemo.getStore();
  const hit = store?.get(key);
  if (hit) return hit;
  const pending = queryPersonalOwner(key);
  store?.set(key, pending);
  return pending;
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
