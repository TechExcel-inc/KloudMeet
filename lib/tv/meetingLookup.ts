'use client';

import { authHeaders } from '@/lib/kloudSession';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

export type MeetingLookup =
  | {
      ok: true;
      roomName: string;
      title: string | null;
      scheduledFor: string | null;
      createdByMemberId: number | null;
      isPersonalRoom: boolean;
    }
  | { ok: false; reason: 'notFound' | 'ended' | 'network' };

async function getMeeting(code: string): Promise<Response | null> {
  try {
    return await fetchWithTimeout(
      `/api/meetings/${encodeURIComponent(code)}`,
      { headers: authHeaders(), cache: 'no-store' },
      12_000,
    );
  } catch {
    return null;
  }
}

/**
 * Finds a meeting the way the home page's join box does (GET /api/meetings/[code]).
 * A 10-letter code said or typed without dashes ("abcdefghij") is also tried as
 * abc-defg-hij, the shape of generated codes; the code itself is never rewritten.
 */
export async function lookupMeeting(code: string): Promise<MeetingLookup> {
  let res = await getMeeting(code);
  if (res?.status === 404 && /^[a-z]{10}$/.test(code)) {
    const dashed = `${code.slice(0, 3)}-${code.slice(3, 7)}-${code.slice(7)}`;
    const retry = await getMeeting(dashed);
    if (retry) res = retry;
  }
  if (!res) return { ok: false, reason: 'network' };
  if (res.status === 404) return { ok: false, reason: 'notFound' };
  if (!res.ok) return { ok: false, reason: 'network' };
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data) return { ok: false, reason: 'network' };
  const isPersonalRoom = data.isPersonalRoom === true;
  if (data.status === 'ENDED' && !isPersonalRoom) return { ok: false, reason: 'ended' };
  return {
    ok: true,
    roomName: typeof data.roomName === 'string' && data.roomName ? data.roomName : code,
    title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null,
    scheduledFor: typeof data.scheduledFor === 'string' ? data.scheduledFor : null,
    createdByMemberId: typeof data.createdByMemberId === 'number' ? data.createdByMemberId : null,
    isPersonalRoom,
  };
}
