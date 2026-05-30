import { authFetch } from '@/lib/kloudSession';

export const PREJOIN_PERSONAL_ROOM_STORAGE_KEY = 'kloud-prejoin-personal-room-enabled';
export const PREJOIN_ORIGINAL_ROOM_SESSION_KEY = 'kloud-prejoin-original-room';

export function readPrejoinPersonalRoomEnabled(): boolean {
  try {
    return localStorage.getItem(PREJOIN_PERSONAL_ROOM_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writePrejoinPersonalRoomEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PREJOIN_PERSONAL_ROOM_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    /* ignore */
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
