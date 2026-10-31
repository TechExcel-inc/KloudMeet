/**
 * Kloud Meet TV ⇄ phone remote messages.
 *
 * The TV and its remotes meet in a small LiveKit room of their own (`kmtv-<code>`, see
 * /api/tv/token) and talk over its data channel on topic `kmtv`. That room carries no audio
 * or video and is separate from the meeting the TV joins.
 *
 * - remote → TV: `hello` (who is asking), then `cmd`
 * - TV → remote: `welcome` (approved / pending / denied), `state` (what the TV shows),
 *   `feedback` (result of a voice command)
 */

export const TV_TOPIC = 'kmtv';
export const TV_ROOM_PREFIX = 'kmtv-';
export const TV_IDENTITY_PREFIX = 'tv_';
export const REMOTE_IDENTITY_PREFIX = 'rc_';
export const TV_CODE_LENGTH = 6;

export type TvView = 'webcam' | 'liveDoc' | 'shareScreen' | 'design';
export type TvLayout = 'tile' | 'spotlight';
export type TvPanel = 'people' | 'chat';

export type TvCommand =
  | { type: 'key'; key: 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' }
  | { type: 'join'; code: string }
  | { type: 'mic'; on?: boolean }
  | { type: 'cam'; on?: boolean }
  | { type: 'captions'; on?: boolean }
  | { type: 'hand'; on?: boolean }
  | { type: 'layout'; mode: TvLayout }
  | { type: 'view'; view: TvView }
  | { type: 'volume'; delta?: number; level?: number; muted?: boolean }
  | { type: 'panel'; panel: TvPanel | null }
  /** `confirmed`: the remote already asked "Leave?"; otherwise the TV asks. */
  | { type: 'leave'; confirmed?: boolean }
  | { type: 'endForAll'; confirmed?: boolean }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'home' }
  | { type: 'help' }
  /** Speech recognised on the phone; the TV parses it (lib/tv/voiceCommands). */
  | { type: 'voice'; text: string };

export type TvScreen =
  | 'home'
  | 'join'
  | 'settings'
  | 'prejoin'
  | 'checking'
  | 'waitingForHost'
  | 'knocking'
  | 'refused'
  | 'connecting'
  | 'meeting';

export interface TvPerson {
  id: string;
  name: string;
  mic: boolean;
  hand: boolean;
  me?: boolean;
  host?: boolean;
}

export interface TvMeetingState {
  code: string;
  title: string | null;
  /** epoch ms when the TV joined */
  joinedAt: number;
  mic: boolean;
  cam: boolean;
  captions: boolean;
  hand: boolean;
  view: TvView;
  views: TvView[];
  layout: TvLayout;
  isHost: boolean;
  recording: boolean;
  panel: TvPanel | null;
  peopleCount: number;
  /** First 40 people (data messages stay small) */
  people: TvPerson[];
}

export interface TvRecent {
  code: string;
  title: string | null;
  at: number;
}

export interface TvState {
  name: string;
  screen: TvScreen;
  /** The meeting code being joined (pre-join and waiting screens) */
  pendingCode?: string | null;
  pendingTitle?: string | null;
  meeting: TvMeetingState | null;
  volume: number;
  muted: boolean;
  recents: TvRecent[];
  /** The TV can listen itself (Web Speech on the TV) */
  tvVoice: boolean;
  /** A confirmation the TV is showing (so the remote can mirror it) */
  confirm: 'leave' | 'endForAll' | null;
}

export type RemoteStatus = 'approved' | 'pending' | 'denied';

export type TvMessage =
  | { t: 'hello'; name: string; device: string; deviceId: string; secret?: string }
  | { t: 'cmd'; cmd: TvCommand }
  | { t: 'welcome'; status: RemoteStatus; tvName: string }
  | { t: 'state'; state: TvState }
  | { t: 'feedback'; heard: string; text: string; ok: boolean };

const VIEWS: TvView[] = ['webcam', 'liveDoc', 'shareScreen', 'design'];
const NAV_KEYS = ['up', 'down', 'left', 'right', 'ok', 'back'];

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length <= max ? v : null;
}

function optBool(v: unknown): boolean | undefined | null {
  if (v === undefined) return undefined;
  return typeof v === 'boolean' ? v : null;
}

/** Validates a command from a remote; anything malformed or unknown is dropped. */
export function parseTvCommand(raw: unknown): TvCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  switch (c.type) {
    case 'key':
      return typeof c.key === 'string' && NAV_KEYS.includes(c.key)
        ? { type: 'key', key: c.key as 'up' }
        : null;
    case 'join': {
      const code = normalizeMeetingCode(str(c.code, 300) ?? '');
      return code ? { type: 'join', code } : null;
    }
    case 'mic':
    case 'cam':
    case 'captions':
    case 'hand': {
      const on = optBool(c.on);
      return on === null ? null : { type: c.type, ...(on === undefined ? {} : { on }) };
    }
    case 'layout':
      return c.mode === 'tile' || c.mode === 'spotlight' ? { type: 'layout', mode: c.mode } : null;
    case 'view':
      return VIEWS.includes(c.view as TvView) ? { type: 'view', view: c.view as TvView } : null;
    case 'volume': {
      const out: { type: 'volume'; delta?: number; level?: number; muted?: boolean } = { type: 'volume' };
      if (typeof c.delta === 'number' && Number.isFinite(c.delta)) out.delta = Math.max(-100, Math.min(100, c.delta));
      if (typeof c.level === 'number' && Number.isFinite(c.level)) out.level = Math.max(0, Math.min(100, c.level));
      if (typeof c.muted === 'boolean') out.muted = c.muted;
      return out.delta === undefined && out.level === undefined && out.muted === undefined ? null : out;
    }
    case 'panel':
      return c.panel === null || c.panel === 'people' || c.panel === 'chat'
        ? { type: 'panel', panel: c.panel as TvPanel | null }
        : null;
    case 'leave':
    case 'endForAll':
      return { type: c.type, ...(c.confirmed === true ? { confirmed: true } : {}) };
    case 'confirm':
    case 'cancel':
    case 'home':
    case 'help':
      return { type: c.type };
    case 'voice': {
      const text = str(c.text, 300)?.trim();
      return text ? { type: 'voice', text } : null;
    }
    default:
      return null;
  }
}

/** Parses a data packet; null for anything that isn't a well-formed message. */
export function decodeTvMessage(payload: Uint8Array): TvMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  switch (m.t) {
    case 'hello': {
      const name = str(m.name, 80);
      const device = str(m.device, 80);
      const deviceId = str(m.deviceId, 64);
      if (name === null || device === null || !deviceId) return null;
      const secret = str(m.secret, 64) ?? undefined;
      return { t: 'hello', name, device, deviceId, ...(secret ? { secret } : {}) };
    }
    case 'cmd': {
      const cmd = parseTvCommand(m.cmd);
      return cmd ? { t: 'cmd', cmd } : null;
    }
    case 'welcome':
      return m.status === 'approved' || m.status === 'pending' || m.status === 'denied'
        ? { t: 'welcome', status: m.status, tvName: str(m.tvName, 80) ?? '' }
        : null;
    case 'state':
      return m.state && typeof m.state === 'object' ? { t: 'state', state: m.state as TvState } : null;
    case 'feedback':
      return {
        t: 'feedback',
        heard: str(m.heard, 300) ?? '',
        text: str(m.text, 300) ?? '',
        ok: m.ok === true,
      };
    default:
      return null;
  }
}

export function encodeTvMessage(msg: TvMessage): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(msg));
}

/**
 * What someone typed or pasted as a meeting: a code (abc-defg-hij), a personal ID (m5888)
 * or a full link (…/rooms/abc-defg-hij?x). Same rule as the home page's join box; codes are
 * kept as typed apart from spaces and case (never reformatted).
 */
export function normalizeMeetingCode(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (s.includes('/rooms/')) s = s.split('/rooms/')[1].split('?')[0].split('#')[0];
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep as is */
  }
  s = s.replace(/\s+/g, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(s)) return null;
  return s;
}

/** "482913" → "482 913" for display. */
export function formatPairCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export function isPairCode(code: unknown): code is string {
  return typeof code === 'string' && new RegExp(`^\\d{${TV_CODE_LENGTH}}$`).test(code);
}
