/**
 * Recording controls shared by the meeting page, the recorder bot, the record API and replay:
 * who may record, what the recording shows, whether it is paused, and which stretches of the
 * file were paused (skipped on replay, not billed).
 */

export const RECORDING_MODES = ['follow', 'gallery', 'speaker', 'audio'] as const;
export type RecordingMode = (typeof RECORDING_MODES)[number];

export function isRecordingMode(value: unknown): value is RecordingMode {
  return typeof value === 'string' && (RECORDING_MODES as readonly string[]).includes(value);
}

/** What everyone in the meeting needs to know about recording. */
export interface RecordingState {
  active: boolean;
  paused: boolean;
  /** Layout of the running recording, or the one the next recording will use */
  mode: RecordingMode;
  /** Only host / co-host may start, stop and pause (off: presenters may too) */
  hostOnly: boolean;
  /** Transcribe automatically once the recording is ready */
  syncTranscript: boolean;
}

export const IDLE_RECORDING_STATE: RecordingState = {
  active: false,
  paused: false,
  mode: 'follow',
  hostOnly: true,
  syncTranscript: true,
};

/** Data-channel message the person who changed something sends to everyone else. */
export const RECORDING_STATE_MSG = 'RECORDING_STATE';

/** Who may start, stop or pause recording in the meeting UI. */
export function canControlRecording(opts: {
  isHost: boolean;
  isCohost: boolean;
  isPresenter: boolean;
  hostOnly: boolean;
}): boolean {
  if (opts.isHost || opts.isCohost) return true;
  return !opts.hostOnly && opts.isPresenter;
}

export interface PauseSpan {
  from: string;
  to: string;
}

export function parsePauseSpans(raw: unknown): PauseSpan[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is PauseSpan =>
      !!s && typeof s === 'object' && typeof (s as PauseSpan).from === 'string' && typeof (s as PauseSpan).to === 'string',
  );
}

/** Closes the open pause (if any) into the list of spans. */
export function closePause(spans: PauseSpan[], pausedAt: Date | null, now: Date): PauseSpan[] {
  if (!pausedAt || now <= pausedAt) return spans;
  return [...spans, { from: pausedAt.toISOString(), to: now.toISOString() }];
}

/** Total paused time in whole seconds. */
export function pausedSeconds(spans: PauseSpan[]): number {
  let ms = 0;
  for (const s of spans) ms += Math.max(0, Date.parse(s.to) - Date.parse(s.from));
  return Math.round(ms / 1000);
}

/**
 * Paused stretches as [start, end] seconds into the media file, given when the file's first
 * frame was captured. Sorted, clipped at 0; spans before the media started are dropped.
 */
export function pauseRangesInMedia(spans: PauseSpan[], mediaStartedAt: Date | string | null): Array<[number, number]> {
  if (!mediaStartedAt) return [];
  const origin = new Date(mediaStartedAt).getTime();
  return spans
    .map((s): [number, number] => [(Date.parse(s.from) - origin) / 1000, (Date.parse(s.to) - origin) / 1000])
    .filter(([, end]) => end > 0)
    .map(([start, end]): [number, number] => [Math.max(0, start), end])
    .sort((a, b) => a[0] - b[0]);
}

/** Where playback should be: `t`, or the end of the paused stretch `t` falls into. */
export function skipPaused(t: number, ranges: Array<[number, number]>): number {
  for (const [start, end] of ranges) {
    if (t >= start && t < end) return end;
  }
  return t;
}

/** Roles the current host's client reports to the server (LiveKit identities). */
export interface MeetingRoles {
  host: string | null;
  cohosts: string[];
  presenters: string[];
}

export function parseMeetingRoles(raw: unknown): MeetingRoles {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    host: typeof r.host === 'string' ? r.host : null,
    cohosts: list(r.cohosts),
    presenters: list(r.presenters),
  };
}

/** Member id inside a signed-in participant's identity (`km_<memberId>_<device>`). */
export function memberIdOfIdentity(identity: string | null | undefined): number | null {
  const m = /^km_(\d+)_/.exec(identity ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * Server-side recording permission: the meeting's creator, the current host and co-hosts, and —
 * when the meeting isn't host-only — presenters.
 */
export function memberMayRecord(opts: {
  memberId: number;
  creatorId: number;
  roles: MeetingRoles;
  hostOnly: boolean;
}): boolean {
  if (opts.memberId === opts.creatorId) return true;
  const is = (ids: Array<string | null>) => ids.some((id) => memberIdOfIdentity(id) === opts.memberId);
  if (is([opts.roles.host, ...opts.roles.cohosts])) return true;
  return !opts.hostOnly && is(opts.roles.presenters);
}

/** Who may report the room's roles: the creator, or whoever the last report named host. */
export function memberMayReportRoles(opts: { memberId: number; creatorId: number; roles: MeetingRoles }): boolean {
  return opts.memberId === opts.creatorId || memberIdOfIdentity(opts.roles.host) === opts.memberId;
}
