/**
 * AI Taking Notes without a recording file.
 *
 * In AI Notes Only mode the recorder page (the web egress bot) sends the room's mixed audio to the
 * Fun-ASR relay while the meeting runs, and posts each finished sentence here. Nothing is written
 * to storage: the recording row exists only to hold the session (times, pauses, speak intervals,
 * shots), and its transcript is MeetingTranscript rows with a `live-…` sourceId.
 *
 * Shared by the recorder page, the API routes and replay. Pure: no I/O.
 */

/** Recording.storageProvider of a notes session that has no media file. */
export const NO_MEDIA_PROVIDER = 'NONE';

export const LIVE_NOTES_PATH = '/api/recordings/live-notes';
export const LIVE_NOTES_TOKEN_PATH = '/api/recordings/live-notes/token';

/** Server → recorder page, just before the recording stops: flush the last sentence now. */
export const NOTES_FINISH_TOPIC = 'kloud-notes-finish';
/** How long the stop request waits for that flush before it ends the recorder. */
export const NOTES_FINISH_WAIT_MS = 2000;

export const LIVE_BATCH_MAX = 100;
const TEXT_MAX = 4000;
/** A sentence longer than this is a clock error, not speech. */
const SENTENCE_MAX_MS = 10 * 60 * 1000;

/** True when AI Notes Only should transcribe live and keep no file (the default). */
export function liveNotesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.AI_NOTES_CAPTURE || 'live').trim().toLowerCase() !== 'file';
}

export function hasNoMedia(recording: { storageProvider: string }): boolean {
  return recording.storageProvider === NO_MEDIA_PROVIDER;
}

export interface LiveSentence {
  /** The recognition stream it came from: that stream's start on the recorder's clock (ms) */
  stream: number;
  /** Sentence number within the stream */
  id: number;
  /** Start and end of the speech on the recorder's clock (Date.now() on the egress machine) */
  startMs: number;
  endMs: number;
  text: string;
}

export interface LiveBatch {
  token: string;
  sentences: LiveSentence[];
}

function readSentence(value: unknown): LiveSentence | null {
  if (typeof value !== 'object' || value === null) return null;
  const stream = Reflect.get(value, 'stream');
  const id = Reflect.get(value, 'id');
  const startMs = Reflect.get(value, 'startMs');
  const endMs = Reflect.get(value, 'endMs');
  const text = Reflect.get(value, 'text');
  if (typeof stream !== 'number' || typeof id !== 'number') return null;
  if (typeof startMs !== 'number' || typeof endMs !== 'number') return null;
  if (![stream, id, startMs, endMs].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  if (endMs < startMs || endMs - startMs > SENTENCE_MAX_MS) return null;
  if (typeof text !== 'string' || !text.trim()) return null;
  return { stream, id, startMs, endMs, text: text.trim().slice(0, TEXT_MAX) };
}

export function readLiveBatch(value: unknown): LiveBatch | null {
  if (typeof value !== 'object' || value === null) return null;
  const token = Reflect.get(value, 'token');
  const sentences = Reflect.get(value, 'sentences');
  if (typeof token !== 'string' || !token) return null;
  if (!Array.isArray(sentences) || sentences.length > LIVE_BATCH_MAX) return null;
  const parsed = sentences.map(readSentence);
  if (parsed.some((item) => item === null)) return null;
  return { token, sentences: parsed.filter((item): item is LiveSentence => item !== null) };
}

/**
 * MeetingTranscript.sourceId of a live sentence. It carries the sentence's length because the
 * table has a start time only, and matching a sentence to who was speaking needs both ends.
 */
export function liveSourceId(recordingId: number, sentence: LiveSentence): string {
  return `live-${recordingId}-${sentence.stream}-${sentence.id}-${sentence.endMs - sentence.startMs}`;
}

export function liveSourcePrefix(recordingId: number): string {
  return `live-${recordingId}-`;
}

/** Length of the sentence a live sourceId belongs to, or null when it isn't one. */
export function liveSourceDurationMs(sourceId: string | null): number | null {
  const match = /^live-\d+-\d+-\d+-(\d+)$/.exec(sourceId ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * When a sentence was spoken, on the recorder's clock.
 *
 * The recognizer times a sentence from the start of its audio stream, so the wall time is the
 * stream's start plus that offset. If the result can't be right (it would end in the future, or
 * the offsets are missing or out of order), fall back to when the sentence arrived: it ended
 * about one silence threshold ago.
 */
export function sentenceWallTime(opts: {
  streamStartMs: number;
  beginMs: number | null | undefined;
  endMs: number | null | undefined;
  nowMs: number;
  /** The recognizer's end-of-sentence silence */
  silenceMs?: number;
  /** Used for the fallback: roughly how long the text takes to say */
  text: string;
}): { startMs: number; endMs: number } {
  const { streamStartMs, beginMs, endMs, nowMs } = opts;
  if (
    typeof beginMs === 'number' && typeof endMs === 'number' &&
    Number.isFinite(beginMs) && Number.isFinite(endMs) &&
    beginMs >= 0 && endMs >= beginMs && endMs - beginMs <= SENTENCE_MAX_MS &&
    streamStartMs + endMs <= nowMs + 1000
  ) {
    return { startMs: Math.round(streamStartMs + beginMs), endMs: Math.round(streamStartMs + endMs) };
  }
  const end = nowMs - (opts.silenceMs ?? 800);
  // About 4 characters a second for Chinese, faster for spaced languages; bounded either way.
  const spoken = Math.min(60_000, Math.max(800, opts.text.trim().length * 220));
  return { startMs: Math.round(Math.max(streamStartMs, end - spoken)), endMs: Math.round(Math.max(streamStartMs, end)) };
}

/** Seconds between two reconnect attempts of the recorder's recognition stream. */
export function reconnectDelayMs(attempt: number): number {
  return [1000, 2000, 4000, 8000, 15000][Math.min(Math.max(attempt, 0), 4)];
}

/** Whole seconds of a notes session: from its first moment to its end. */
export function notesDurationSeconds(startedAt: Date, endedAt: Date): number {
  return Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
}

export const SILENCE_PATH = '/api/recordings/silence';
/** Longest playback clock replay will build (12 hours). */
export const SILENCE_MAX_SECONDS = 12 * 3600;

/** The silent clock that stands in for a media file on replay. */
export function silenceUrl(seconds: number): string {
  const whole = Math.min(SILENCE_MAX_SECONDS, Math.max(1, Math.ceil(seconds)));
  return `${SILENCE_PATH}?seconds=${whole}`;
}
