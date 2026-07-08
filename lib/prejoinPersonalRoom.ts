import { generateRoomId } from '@/lib/client-utils';
import { authFetch, getKloudSessionBearer } from '@/lib/kloudSession';

export const PREJOIN_PERSONAL_ROOM_STORAGE_KEY = 'kloud-prejoin-personal-room-enabled';
export const PREJOIN_ORIGINAL_ROOM_SESSION_KEY = 'kloud-prejoin-original-room';

/** null = no saved preference yet */
export function readPrejoinPersonalRoomPreference(): boolean | null {
  try {
    const value = localStorage.getItem(PREJOIN_PERSONAL_ROOM_STORAGE_KEY);
    if (value === null) return null;
    return value === 'true';
  } catch {
    return null;
  }
}

export function readPrejoinPersonalRoomEnabled(): boolean {
  return readPrejoinPersonalRoomPreference() === true;
}

export function writePrejoinPersonalRoomEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PREJOIN_PERSONAL_ROOM_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

/** 与首页「新建会议」一致：注册随机会议号并返回 roomName。 */
export async function createInstantMeetingRoom(): Promise<string | null> {
  const roomId = generateRoomId();
  if (!getKloudSessionBearer()) {
    return roomId;
  }

  try {
    const res = await authFetch('/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomName: roomId }),
    });
    if (!res.ok) return null;
    return roomId;
  } catch {
    return null;
  }
}

/** 主持人改开个人房并成功进会后，清理未开始的随机会议，避免 DB 孤儿记录。 */
export async function cancelAbandonedInstantMeeting(roomName: string): Promise<void> {
  const trimmed = roomName.trim();
  if (!trimmed) return;

  try {
    const infoRes = await fetch(`/api/meetings/${encodeURIComponent(trimmed)}`);
    if (!infoRes.ok) return;

    const info = await infoRes.json();
    if (info.error) return;
    if (info.isPersonalRoom) return;
    if (info.scheduledFor) return;
    if (info.isActive) return;
    if (info.actualStartedAt) return;
    if (info.status === 'ENDED' || info.status === 'CANCELED') return;

    await authFetch(`/api/meetings/${encodeURIComponent(trimmed)}`, {
      method: 'DELETE',
    });
  } catch {
    /* ignore — best-effort cleanup */
  }
}
