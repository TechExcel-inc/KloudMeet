'use client';

/**
 * What a TV and a phone remote remember on their own device (localStorage):
 * - the TV: its id, pairing code, QR secret, name, recent meetings, trusted remotes, volume;
 * - the phone: its id and name, and the last TV it controlled (for one-tap reconnect).
 */
import type { TvRecent } from './protocol';

const TV_KEY = 'km-tv-identity';
const RECENTS_KEY = 'km-tv-recents';
const TRUSTED_KEY = 'km-tv-trusted-remotes';
const VOLUME_KEY = 'km-tv-volume';
const MEDIA_KEY = 'km-tv-media';
const REMOTE_KEY = 'km-remote-identity';
const REMOTE_LAST_KEY = 'km-remote-last-tv';

export const DEFAULT_TV_NAME = 'Meeting Room TV';
export const TV_NAME_PRESETS = ['Meeting Room TV', 'Conference Room', 'Boardroom', 'Training Room', 'Huddle Room', 'Classroom'];

export interface TvIdentity {
  deviceId: string;
  /** 6-digit pairing code shown on the TV */
  code: string;
  /** Rides in the QR link only: a phone that scanned it needs no approval on the TV */
  secret: string;
  name: string;
}

export interface TvMediaPrefs {
  mic: boolean;
  cam: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}

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

export function randomToken(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** 100000–999999: no leading zero, so it reads the same when spoken. */
export function newPairCode(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(100_000 + (n[0] % 900_000));
}

export function loadTvIdentity(): TvIdentity {
  const saved = read<Partial<TvIdentity>>(TV_KEY);
  const identity: TvIdentity = {
    deviceId: typeof saved?.deviceId === 'string' && saved.deviceId.length >= 8 ? saved.deviceId : randomToken(16),
    code: typeof saved?.code === 'string' && /^\d{6}$/.test(saved.code) ? saved.code : newPairCode(),
    secret: typeof saved?.secret === 'string' && saved.secret.length >= 12 ? saved.secret : randomToken(16),
    name: typeof saved?.name === 'string' && saved.name.trim() ? saved.name.trim().slice(0, 40) : DEFAULT_TV_NAME,
  };
  write(TV_KEY, identity);
  return identity;
}

export function saveTvIdentity(identity: TvIdentity): void {
  write(TV_KEY, identity);
}

export function loadRecents(): TvRecent[] {
  const list = read<TvRecent[]>(RECENTS_KEY);
  return Array.isArray(list) ? list.filter((r) => r && typeof r.code === 'string').slice(0, 6) : [];
}

export function rememberRecent(code: string, title: string | null): TvRecent[] {
  const next = [{ code, title, at: Date.now() }, ...loadRecents().filter((r) => r.code !== code)].slice(0, 6);
  write(RECENTS_KEY, next);
  return next;
}

export function forgetRecents(): void {
  write(RECENTS_KEY, []);
}

export function loadTrustedRemotes(): string[] {
  const list = read<string[]>(TRUSTED_KEY);
  return Array.isArray(list) ? list.filter((s) => typeof s === 'string').slice(0, 20) : [];
}

export function trustRemote(deviceId: string): void {
  write(TRUSTED_KEY, [deviceId, ...loadTrustedRemotes().filter((d) => d !== deviceId)].slice(0, 20));
}

export function forgetTrustedRemotes(): void {
  write(TRUSTED_KEY, []);
}

export function loadVolume(): { volume: number; muted: boolean } {
  const v = read<{ volume: number; muted: boolean }>(VOLUME_KEY);
  return {
    volume: typeof v?.volume === 'number' ? Math.max(0, Math.min(100, v.volume)) : 80,
    muted: v?.muted === true,
  };
}

export function saveVolume(volume: number, muted: boolean): void {
  write(VOLUME_KEY, { volume, muted });
}

export function loadMediaPrefs(): TvMediaPrefs {
  const m = read<TvMediaPrefs>(MEDIA_KEY);
  return {
    mic: m?.mic !== false,
    cam: m?.cam !== false,
    audioDeviceId: typeof m?.audioDeviceId === 'string' ? m.audioDeviceId : undefined,
    videoDeviceId: typeof m?.videoDeviceId === 'string' ? m.videoDeviceId : undefined,
  };
}

export function saveMediaPrefs(prefs: TvMediaPrefs): void {
  write(MEDIA_KEY, prefs);
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
