import { RoomServiceClient } from 'livekit-server-sdk';

const LIVEKIT_URL = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

export function getRoomServiceClient(): RoomServiceClient | null {
  if (!LIVEKIT_URL || !API_KEY || !API_SECRET) return null;
  return new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
}

/** Returns LiveKit room names that currently have an active session. */
export async function listActiveRoomNames(): Promise<string[]> {
  const client = getRoomServiceClient();
  if (!client) return [];
  try {
    const rooms = await client.listRooms();
    return rooms.map((r) => r.name);
  } catch (e) {
    console.error('[livekitRooms] listRooms failed', e);
    return [];
  }
}

/** @deprecated 使用 getMeetingIsActiveByRoomName（与 GET /api/meetings/[roomName] 一致） */
export async function isLiveKitRoomActive(roomName: string): Promise<boolean> {
  const { getMeetingIsActiveByRoomName } = await import('@/lib/meetingRoomIsActive');
  return getMeetingIsActiveByRoomName(roomName);
}

export async function deleteLiveKitRoom(roomName: string): Promise<boolean> {
  const client = getRoomServiceClient();
  if (!client) return false;
  try {
    await client.deleteRoom(roomName);
    return true;
  } catch (e) {
    console.error('[livekitRooms] deleteRoom failed', roomName, e);
    return false;
  }
}
