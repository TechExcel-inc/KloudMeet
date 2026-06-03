import { RoomServiceClient } from 'livekit-server-sdk';
import { parseKloudMemberIdFromIdentity } from '@/lib/meetingOwner';

const LIVEKIT_URL = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

export function getRoomServiceClient(): RoomServiceClient | null {
  if (!LIVEKIT_URL || !API_KEY || !API_SECRET) return null;
  return new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
}

const LIVEKIT_LIST_ROOMS_TIMEOUT_MS = 8_000;

/** Returns LiveKit room names that currently have an active session. */
export async function listActiveRoomNames(): Promise<string[]> {
  const client = getRoomServiceClient();
  if (!client) return [];
  try {
    const rooms = await Promise.race([
      client.listRooms(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('LiveKit listRooms timed out')),
          LIVEKIT_LIST_ROOMS_TIMEOUT_MS,
        );
      }),
    ]);
    return rooms.map((r) => r.name);
  } catch (e) {
    console.error('[livekitRooms] listRooms failed', e);
    return [];
  }
}

function roomNameVariants(roomName: string): string[] {
  const trimmed = roomName.trim();
  return [...new Set([trimmed, trimmed.toLowerCase(), trimmed.toUpperCase()])];
}

/** 从 LiveKit 参与者 identity（km_{memberId} 或 km_{memberId}_{deviceId}）推断 Kloud 主持人 memberId */
export async function findKloudMemberHostInLiveRoom(
  roomName: string,
): Promise<number | null> {
  const client = getRoomServiceClient();
  if (!client) return null;

  for (const rn of roomNameVariants(roomName)) {
    try {
      const participants = await client.listParticipants(rn);
      for (const p of participants) {
        const memberId = parseKloudMemberIdFromIdentity(p.identity);
        if (memberId != null) {
          return memberId;
        }
      }
    } catch (e) {
      console.error('[livekitRooms] listParticipants failed', rn, e);
    }
  }
  return null;
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
