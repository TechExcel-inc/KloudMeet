import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

/** resolve API 响应（客户端仅消费 join_live.effectiveRoomName） */
export type PersonalRoomResolveResponse =
  | { kind: 'not_found' }
  | { kind: 'direct_join'; roomName: string }
  | {
      kind: 'join_live';
      effectiveRoomName: string;
      personalRoomId?: string;
      isPersonalSession?: boolean;
      meeting?: Record<string, unknown>;
      owner?: { id: number; displayName: string };
    }
  | {
      kind: 'open_personal_idle';
      personalRoomId?: string;
      owner?: { id: number; displayName: string };
    };

export async function fetchPersonalRoomResolve(
  roomId: string,
): Promise<PersonalRoomResolveResponse | null> {
  const trimmed = roomId.trim();
  if (!trimmed) return null;

  const res = await fetchWithTimeout(
    `/api/rooms/${encodeURIComponent(trimmed)}/resolve`,
    undefined,
    12_000,
  );
  if (res.status === 404) {
    return { kind: 'not_found' };
  }
  if (!res.ok) {
    return null;
  }
  return (await res.json()) as PersonalRoomResolveResponse;
}

/** 个人房入口解析出的真实 LiveKit 会场（与当前 URL roomName 不同时需跟会） */
export function getResolvedLiveRoomName(
  roomName: string,
  resolved: PersonalRoomResolveResponse | null,
): string | null {
  if (resolved?.kind !== 'join_live') {
    return null;
  }
  if (
    resolved.effectiveRoomName.toLowerCase() === roomName.trim().toLowerCase()
  ) {
    return null;
  }
  return resolved.effectiveRoomName;
}
