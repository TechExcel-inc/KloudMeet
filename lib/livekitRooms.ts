import { RoomServiceClient } from 'livekit-server-sdk';
import { DataPacket_Kind } from '@livekit/protocol';
import { parseKloudMemberIdFromIdentity } from '@/lib/meetingOwner';
import { isRecorderParticipant } from '@/lib/recorderParticipant';

const LIVEKIT_URL = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

export function getRoomServiceClient(): RoomServiceClient | null {
  if (!LIVEKIT_URL || !API_KEY || !API_SECRET) return null;
  return new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
}

const LIVEKIT_LIST_ROOMS_TIMEOUT_MS = 8_000;
/** 入会/重连换票路径上的 LiveKit 服务端调用上限，避免拖慢 /api/connection-details */
const LIVEKIT_EVICT_TIMEOUT_MS = 5_000;

/** withTimeout — 为 LiveKit 服务端 API 调用加超时 */
function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
}

/** Returns LiveKit room names that currently have an active session. */
export async function listActiveRoomNames(): Promise<string[]> {
  return (await listActiveRoomNamesOrNull()) ?? [];
}

/** Like listActiveRoomNames, but null when LiveKit could not be asked, so [] means no live rooms. */
export async function listActiveRoomNamesOrNull(): Promise<string[] | null> {
  const client = getRoomServiceClient();
  if (!client) return null;
  try {
    const rooms = await withTimeout(
      client.listRooms(),
      LIVEKIT_LIST_ROOMS_TIMEOUT_MS,
      'LiveKit listRooms',
    );
    return rooms.map((r) => r.name);
  } catch (e) {
    console.error('[livekitRooms] listRooms failed', e);
    return null;
  }
}

/**
 * Rooms among `names` that are live right now.
 * null: LiveKit could not be asked. []: none of these names are live.
 */
export async function listRoomsByNames(names: string[]): Promise<string[] | null> {
  const unique = [
    ...new Set(
      names.flatMap((name) => {
        const trimmed = name.trim();
        if (!trimmed) return [];
        return [trimmed, trimmed.toLowerCase(), trimmed.toUpperCase()];
      }),
    ),
  ];
  if (unique.length === 0) return [];
  const client = getRoomServiceClient();
  if (!client) return null;
  try {
    const rooms = await withTimeout(
      client.listRooms(unique),
      LIVEKIT_LIST_ROOMS_TIMEOUT_MS,
      'LiveKit listRooms',
    );
    return rooms.map((room) => room.name);
  } catch (e) {
    console.error('[livekitRooms] listRooms by name failed', e);
    return null;
  }
}

interface ListedParticipant {
  identity: string;
  metadata?: string;
}

/** People currently in the room. [] when the room does not exist; null when LiveKit could not be asked. */
export async function listRoomParticipants(roomName: string): Promise<ListedParticipant[] | null> {
  const client = getRoomServiceClient();
  if (!client) return null;
  try {
    const participants = await withTimeout(
      client.listParticipants(roomName),
      LIVEKIT_EVICT_TIMEOUT_MS,
      'LiveKit listParticipants',
    );
    return participants.map((p) => ({ identity: p.identity, metadata: p.metadata }));
  } catch (e: unknown) {
    const err = e as { code?: string; status?: number };
    if (err.code === 'not_found' || err.status === 404) return [];
    console.error('[livekitRooms] listParticipants failed', roomName, e);
    return null;
  }
}

/** Participants other than the joiner and their other devices (those are evicted on join). */
export function countListedParticipants(
  participants: ListedParticipant[],
  exclude: { identity?: string; memberId?: number | null },
): number {
  return participants.filter((p) => {
    if (isRecorderParticipant(p)) return false;
    if (exclude.identity && p.identity === exclude.identity) return false;
    const memberId = parseKloudMemberIdFromIdentity(p.identity);
    return !(exclude.memberId != null && memberId === exclude.memberId);
  }).length;
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
 * Remove other sessions for the same kloudMemberId before issuing a new token.
 *
 * @param sameIdentity - Identity about to (re)join. Skipped: LiveKit replaces
 *   that connection on join; removeParticipant would set a Cloud revoke cutoff.
 *   Other identities for the same member get SESSION_EVICTED then removed
 *   (cross-tab / cross-device takeover).
 */
export async function evictParticipantsByMemberId(
  roomName: string,
  memberId: number,
  sameIdentity?: string,
  listed?: ListedParticipant[] | null,
): Promise<number> {
  if (listed === null) return 0;
  const client = getRoomServiceClient();
  if (!client) {
    console.warn('[evict] No RoomServiceClient available');
    return 0;
  }

  const participants = listed ?? (await listRoomParticipants(roomName));
  if (!participants || participants.length === 0) return 0;

  let evicted = 0;
  for (const p of participants) {
    const pid = parseKloudMemberIdFromIdentity(p.identity);
    if (pid == null || pid !== memberId) continue;

    // Same identity (refresh / token renew): do NOT removeParticipant.
    // LiveKit replaces the old connection on join. Calling removeParticipant
    // sets a Cloud revoke cutoff; with legacy nbf:0 JWTs that made every
    // subsequent ticket look permanently revoked.
    if (sameIdentity && p.identity === sameIdentity) continue;

    try {
      // Cross-tab / other device: notify so the old client shows Session Moved
      // instead of auto-reconnecting.
      const notice = new TextEncoder().encode(
        JSON.stringify({ type: 'SESSION_EVICTED' }),
      );
      try {
        await withTimeout(
          client.sendData(roomName, notice, DataPacket_Kind.RELIABLE, {
            destinationIdentities: [p.identity],
            topic: 'kloud-session',
          }),
          LIVEKIT_EVICT_TIMEOUT_MS,
          'LiveKit sendData',
        );
        await new Promise((r) => setTimeout(r, 150));
      } catch (sendErr) {
        console.warn(`[evict] sendData failed (non-fatal) for ${p.identity}`, sendErr);
      }

      await withTimeout(
        client.removeParticipant(roomName, p.identity),
        LIVEKIT_EVICT_TIMEOUT_MS,
        'LiveKit removeParticipant',
      );
      evicted++;
    } catch (e) {
      console.error('[evict] removeParticipant failed', p.identity, e);
    }
  }
  return evicted;
}

/**
 * Participants currently in the room, not counting the joiner's own identity or
 * other sessions of the same member (they are evicted on join).
 * Returns null when LiveKit cannot be queried (callers should fail open).
 */
export async function countOtherRoomParticipants(
  roomName: string,
  exclude: { identity?: string; memberId?: number | null },
): Promise<number | null> {
  const participants = await listRoomParticipants(roomName);
  if (!participants) return null;
  return countListedParticipants(participants, exclude);
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

/**
 * Host/co-host eject: notify target then remove from LiveKit room.
 * Returns true when removeParticipant succeeds.
 */
export async function removeParticipantFromRoom(
  roomName: string,
  identity: string,
): Promise<boolean> {
  const client = getRoomServiceClient();
  if (!client) {
    console.warn('[remove-participant] No RoomServiceClient available');
    return false;
  }

  const notice = new TextEncoder().encode(
    JSON.stringify({ type: 'REMOVED_FROM_MEETING', identity }),
  );
  try {
    await client.sendData(roomName, notice, DataPacket_Kind.RELIABLE, {
      destinationIdentities: [identity],
      topic: 'meeting-control',
    });
    await new Promise((r) => setTimeout(r, 150));
  } catch (sendErr) {
    console.warn('[remove-participant] sendData failed (non-fatal)', identity, sendErr);
  }

  try {
    await client.removeParticipant(roomName, identity);
    return true;
  } catch (e) {
    console.error('[remove-participant] removeParticipant failed', identity, e);
    return false;
  }
}
