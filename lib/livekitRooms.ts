import { RoomServiceClient } from 'livekit-server-sdk';
import { DataPacket_Kind } from '@livekit/protocol';
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

/**
 * Remove existing participants in the room that share the same kloudMemberId.
 * Called when a user requests a new token so the old session is evicted
 * BEFORE the new one connects — the old client receives DisconnectReason
 * and shows the "Session Moved" popup instead of reconnecting.
 */
export async function evictParticipantsByMemberId(
  roomName: string,
  memberId: number,
  excludeIdentity?: string,
): Promise<number> {
  const client = getRoomServiceClient();
  if (!client) {
    console.warn('[evict] No RoomServiceClient available');
    return 0;
  }

  try {
    const participants = await client.listParticipants(roomName);
    console.log(`[evict] Room "${roomName}" has ${participants.length} participant(s):`,
      participants.map(p => ({ identity: p.identity, sid: p.sid })));
    let evicted = 0;
    for (const p of participants) {
      if (excludeIdentity && p.identity === excludeIdentity) {
        console.log(`[evict] Skipping excludeIdentity match: ${p.identity}`);
        continue;
      }
      const pid = parseKloudMemberIdFromIdentity(p.identity);
      console.log(`[evict] Checking participant identity="${p.identity}" → memberId=${pid}, looking for ${memberId}`);
      if (pid != null && pid === memberId) {
        try {
          // Send a pre-eviction notification via the data channel so the
          // client can show the popup BEFORE the disconnect fires. This
          // prevents the SDK's auto-retry from kicking in.
          const notice = new TextEncoder().encode(
            JSON.stringify({ type: 'SESSION_EVICTED' }),
          );
          try {
            await client.sendData(roomName, notice, DataPacket_Kind.RELIABLE, {
              destinationIdentities: [p.identity],
              topic: 'kloud-session',
            });
            console.log(`[evict] Sent SESSION_EVICTED to ${p.identity}, waiting 150ms…`);
            await new Promise((r) => setTimeout(r, 150));
          } catch (sendErr) {
            console.warn(`[evict] sendData failed (non-fatal) for ${p.identity}`, sendErr);
          }

          console.log(`[evict] Removing participant: ${p.identity} (memberId=${pid})`);
          await client.removeParticipant(roomName, p.identity);
          console.log(`[evict] Successfully removed: ${p.identity}`);
          evicted++;
        } catch (e) {
          console.error('[evict] removeParticipant failed', p.identity, e);
        }
      }
    }
    console.log(`[evict] Done. Evicted ${evicted} participant(s).`);
    return evicted;
  } catch (e: any) {
    if (e?.code === 'not_found' || e?.status === 404) {
      console.log(`[evict] Room "${roomName}" not found (new meeting) — nothing to evict.`);
      return 0;
    }
    console.error('[evict] listParticipants failed', roomName, e);
    return 0;
  }
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
