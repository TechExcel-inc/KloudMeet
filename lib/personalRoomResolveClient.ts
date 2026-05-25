export type PersonalRoomResolveResponse =
  | { kind: 'not_found' }
  | {
      kind: 'direct_join';
      roomName: string;
      redirectTo: string;
    }
  | {
      kind: 'join_live';
      personalRoomId: string;
      effectiveRoomName: string;
      redirectTo: string;
      isPersonalSession?: boolean;
      meeting?: {
        id: number;
        createdByMemberId: number;
        isActive?: boolean;
        status?: string;
        scheduledFor?: string | null;
        [key: string]: unknown;
      };
      owner?: { id: number; displayName: string };
    }
  | {
      kind: 'open_personal_idle';
      personalRoomId: string;
      redirectTo: string;
      owner?: { id: number; displayName: string };
    };

export async function fetchPersonalRoomResolve(
  roomId: string,
): Promise<PersonalRoomResolveResponse | null> {
  const trimmed = roomId.trim();
  if (!trimmed) return null;

  const res = await fetch(
    `/api/rooms/${encodeURIComponent(trimmed)}/resolve`,
  );
  if (res.status === 404) {
    return { kind: 'not_found' };
  }
  if (!res.ok) {
    return null;
  }
  return (await res.json()) as PersonalRoomResolveResponse;
}

/** 是否需走个人房解析（登记人其它会场 / 空闲等） */
export function isPersonalRoomResolveKind(
  resolved: PersonalRoomResolveResponse | null,
): boolean {
  return (
    resolved?.kind === 'join_live' || resolved?.kind === 'open_personal_idle'
  );
}
