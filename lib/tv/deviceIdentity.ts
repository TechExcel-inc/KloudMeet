'use client';

/**
 * What a phone remote remembers (localStorage): its id and name, and the last TV it
 * controlled (for one-tap reconnect). The TV itself is the Kloud Meet TV Android app.
 */
const REMOTE_KEY = 'km-remote-identity';
const REMOTE_LAST_KEY = 'km-remote-last-tv';

export interface RemoteIdentity {
  deviceId: string;
  name: string;
}

export interface LastTv {
  code: string;
  secret?: string;
  tvName: string;
  /** Last time this phone was connected (epoch ms): a reload within a while reconnects by itself */
  at?: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / storage full */
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomToken(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function loadRemoteIdentity(): RemoteIdentity {
  const saved = read<Partial<RemoteIdentity>>(REMOTE_KEY);
  const identity: RemoteIdentity = {
    deviceId: typeof saved?.deviceId === 'string' && saved.deviceId.length >= 8 ? saved.deviceId : randomToken(16),
    name: typeof saved?.name === 'string' ? saved.name.slice(0, 40) : '',
  };
  write(REMOTE_KEY, identity);
  return identity;
}

export function saveRemoteIdentity(identity: RemoteIdentity): void {
  write(REMOTE_KEY, identity);
}

export function loadLastTv(): LastTv | null {
  const last = read<LastTv>(REMOTE_LAST_KEY);
  return last && /^\d{6}$/.test(last.code) ? last : null;
}

export function saveLastTv(last: LastTv | null): void {
  if (last) write(REMOTE_LAST_KEY, last);
  else {
    try {
      localStorage.removeItem(REMOTE_LAST_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** "iPhone", "iPad", "Android phone"… — shown on the TV next to the person's name. */
export function deviceLabel(ua: string): string {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh|Windows|Linux|CrOS/i.test(ua)) return 'Computer';
  return 'Phone';
}
