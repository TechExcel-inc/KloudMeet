'use client';

/**
 * Browser side of meeting access levels: the pre-join state (/api/meetings/[room]/access),
 * knocking (/join-requests), and the credentials every join request carries — the invite link
 * an attendee opened and, for the recording bot, its recording token.
 */
import { authFetch, authHeaders } from './kloudSession';
import { SPEAK_TOKEN_PARAM } from './recordingSpeakActivity';

export type AccessLevelValue = 'PUBLIC' | 'PROTECTED' | 'PRIVATE';

export interface MeetingAccessState {
  roomName: string;
  /** null = a meeting from before access levels (anyone with the link joins). */
  level: AccessLevelValue | null;
  isHost: boolean;
  /** false until the host has joined (and again once everyone has left): others wait. */
  started?: boolean;
  decision: 'join' | 'sign_in' | 'knock' | 'refused';
  reason?: 'NOT_INVITED' | 'DENIED';
  retryAfterMs?: number | null;
  pending?: boolean;
  meeting: {
    title: string | null;
    hostName: string;
    hostAvatarUrl: string | null;
    companyName: string | null;
    hostPresent: boolean | null;
    participantCount: number | null;
  };
  signedInAs: { email: string | null; name: string } | null;
}

export type KnockStatus = 'PENDING' | 'ADMITTED' | 'DENIED' | 'CANCELED' | null;

const INVITE_PARAM = 'invite';
const INVITE_STORAGE_KEY = 'kloudMeetingInvite';

/**
 * Keeps the ?invite= token of the link this tab opened: the page drops query strings from
 * the address bar, and reconnects and the return from sign-in still need it.
 */
export function rememberInviteFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const token = new URL(window.location.href).searchParams.get(INVITE_PARAM);
    if (token) sessionStorage.setItem(INVITE_STORAGE_KEY, token);
  } catch {
    /* ignore */
  }
}

function storedInvite(): string | null {
  try {
    return sessionStorage.getItem(INVITE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Adds the invite link token and the recorder bot's token (if any) to a join request URL. */
export function appendJoinCredentials(url: URL): void {
  if (typeof window === 'undefined') return;
  const invite = storedInvite();
  if (invite) url.searchParams.set(INVITE_PARAM, invite);
  try {
    const recToken = new URL(window.location.href).searchParams.get(SPEAK_TOKEN_PARAM);
    if (recToken) url.searchParams.set(SPEAK_TOKEN_PARAM, recToken);
  } catch {
    /* ignore */
  }
}

function roomPath(roomName: string): string {
  return `/api/meetings/${encodeURIComponent(roomName)}`;
}

export async function fetchMeetingAccess(roomName: string): Promise<MeetingAccessState | null> {
  try {
    const url = new URL(`${roomPath(roomName)}/access`, window.location.origin);
    appendJoinCredentials(url);
    const res = await fetch(url.toString(), { headers: authHeaders(), cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as MeetingAccessState;
  } catch {
    return null;
  }
}

/** Ask to join (again). Resolves to the new status, or TOO_SOON with the wait. */
export async function sendKnock(
  roomName: string,
  displayName: string,
): Promise<{ status: KnockStatus; tooSoonMs?: number; code?: string }> {
  const res = await authFetch(`${roomPath(roomName)}/join-requests`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ displayName }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) return { status: 'DENIED', tooSoonMs: Number(data?.retryAfterMs) || 60_000 };
  if (!res.ok) return { status: null, code: typeof data?.code === 'string' ? data.code : undefined };
  return { status: (data?.status as KnockStatus) ?? null };
}

export async function pollKnock(roomName: string): Promise<{
  status: KnockStatus;
  hostPresent: boolean | null;
  participantCount: number | null;
  retryAfterMs: number;
} | null> {
  try {
    const res = await authFetch(`${roomPath(roomName)}/join-requests?mine=1`, {
      headers: authHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Cancel when leaving the waiting page; keepalive lets it finish while the tab closes. */
export function cancelKnock(roomName: string): void {
  try {
    void fetch(`${roomPath(roomName)}/join-requests`, {
      method: 'DELETE',
      headers: authHeaders(),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

export interface WaitingPerson {
  id: number;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  requestedAt: string;
}

export async function fetchWaitingList(roomName: string): Promise<{
  requests: WaitingPerson[];
  companyName: string | null;
  /** False for Public / Private: knocking does not apply, so the host can stop polling. */
  acceptsKnocks: boolean;
} | null> {
  try {
    const res = await fetch(`${roomPath(roomName)}/join-requests`, { headers: authHeaders(), cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function answerKnocks(
  roomName: string,
  action: 'admit' | 'deny',
  target: { ids: number[] } | { all: true },
): Promise<boolean> {
  try {
    const res = await fetch(`${roomPath(roomName)}/join-requests`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action, ...target }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** People of the caller's company matching `q`, and which of `check` are in the company. */
export async function fetchCompanyPeople(opts: { q?: string; check?: string[] }): Promise<{
  companyName: string | null;
  people: Array<{ id: number; name: string; email: string; avatarUrl: string | null }>;
  companyEmails: string[];
} | null> {
  try {
    const url = new URL('/api/account/company-people', window.location.origin);
    if (opts.q) url.searchParams.set('q', opts.q);
    if (opts.check?.length) url.searchParams.set('check', opts.check.join(','));
    const res = await fetch(url.toString(), { headers: authHeaders(), cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** The signed-in person's default access for new meetings (My Profile); null when unset or unknown. */
export async function fetchMyDefaultMeetingAccess(): Promise<string | null> {
  try {
    const res = await fetch('/api/account/profile', { headers: authHeaders(), cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.defaultMeetingAccess === 'string' ? data.defaultMeetingAccess : null;
  } catch {
    return null;
  }
}

/** "?next=" path that brings someone back to this meeting after signing in. */
export function signInHref(roomName: string, opts: { signup?: boolean } = {}): string {
  const next = encodeURIComponent(`/rooms/${encodeURIComponent(roomName)}`);
  return opts.signup ? `/?signup=1&next=${next}` : `/?next=${next}`;
}
