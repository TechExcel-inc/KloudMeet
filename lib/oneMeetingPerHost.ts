import { resolveHostActiveMeeting } from '@/lib/hostActiveMeeting';
import { listActiveRoomNames } from '@/lib/livekitRooms';
import { isRoomLiveInList } from '@/lib/meetingRoomIsActive';
import { resolveRoomEntry } from '@/lib/resolvePersonalRoomJoin';

/**
 * 一人同一时间只主持一场会（William, 2026-10-26）。入会凭证发放前的两道检查，
 * 任何入口（首页、链接、入会页勾选、桌面端）都会经过；检查本身出错时一律放行。
 */

/** 个人会议 ID 的登记人正在主持另一场在线会议 → 返回那场会的房间名（跟会，不另开）。 */
export async function followOwnerLiveRoom(roomName: string): Promise<string | null> {
  try {
    const entry = await resolveRoomEntry(roomName);
    if (entry.kind !== 'join_live') return null;
    const target = entry.effectiveRoomName.trim();
    return target && target.toLowerCase() !== roomName.trim().toLowerCase() ? target : null;
  } catch (error) {
    console.error('[oneMeetingPerHost] follow owner', roomName, error);
    return null;
  }
}

/**
 * 主持人要开一场尚未开始的会，而自己已在主持另一场在线会议 → 返回那场会。
 * 已在进行的会照常可进（刷新、换设备回到自己的会都不受影响）。
 */
export async function otherLiveMeetingOfHost(memberId: number, roomName: string) {
  try {
    const activeRooms = await listActiveRoomNames();
    if (activeRooms.length === 0 || isRoomLiveInList(roomName, activeRooms)) return null;
    const active = await resolveHostActiveMeeting(memberId, roomName);
    if (!active || active.roomName.trim().toLowerCase() === roomName.trim().toLowerCase()) return null;
    return active;
  } catch (error) {
    console.error('[oneMeetingPerHost] host active meeting', memberId, roomName, error);
    return null;
  }
}
