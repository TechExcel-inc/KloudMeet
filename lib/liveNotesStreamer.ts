/**
 * AI Taking Notes, recorder-page side (see lib/liveNotes.ts).
 *
 * NotesStream carries the room's audio to the Fun-ASR relay and posts back the sentences the
 * recognizer finishes. It owns the connection: it asks the server for a relay ticket, reconnects
 * for as long as the session runs, keeps the audio captured while it was disconnected, and
 * stops cleanly on pause and at the end so the sentence in progress isn't lost.
 *
 * It has no audio code of its own (RoomAudioTap feeds it), so it can be tested with a scripted
 * socket.
 */
import {
  LIVE_BATCH_MAX,
  LIVE_NOTES_PATH,
  LIVE_NOTES_TOKEN_PATH,
  reconnectDelayMs,
  sentenceWallTime,
  type LiveSentence,
} from '@/lib/liveNotes';

/** 16 kHz mono PCM16 */
export const NOTES_SAMPLE_RATE = 16000;
const BYTES_PER_MS = (NOTES_SAMPLE_RATE * 2) / 1000;
/** Audio kept while there is no connection (about 30 s) */
const BACKLOG_MAX_BYTES = 30_000 * BYTES_PER_MS;
/** Unsent audio piling up on an open socket means the connection is stuck */
const STALLED_BYTES = 1_000_000;
const READY_TIMEOUT_MS = 12000;
const POST_EVERY_MS = 1000;
/** The session row is written just after the recorder page is opened */
const NOT_READY_RETRY_MS = 2000;
/** How long finish() waits for the recognizer's last sentence */
const FINISH_TIMEOUT_MS = 1500;
const QUEUE_MAX = 2000;

interface Frame {
  pcm: ArrayBuffer;
  /** When the frame's first sample was captured (ms, this page's clock) */
  atMs: number;
}

interface RelayLine {
  type?: unknown;
  id?: unknown;
  text?: unknown;
  begin?: unknown;
  end?: unknown;
  message?: unknown;
}

/** The parts of a WebSocket that NotesStream uses. */
export interface NotesSocket {
  readyState: number;
  bufferedAmount: number;
  send(data: string | ArrayBuffer): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface NotesStreamOptions {
  /** Recording.activityToken the recorder page was opened with */
  token: string;
  /** Builds the relay address for a one-time ticket */
  relayUrl: (ticket: string) => string;
  openSocket?: (url: string) => NotesSocket;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (message: string, detail?: unknown) => void;
  /**
   * Called once the server has answered whether this recording takes live notes: true when it
   * does (start capturing audio), false when it keeps a media file or has ended (capture nothing).
   */
  onLive?: (live: boolean) => void;
}

const SOCKET_OPEN = 1;

export class NotesStream {
  private readonly token: string;
  private readonly relayUrl: (ticket: string) => string;
  private readonly openSocket: (url: string) => NotesSocket;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly log: (message: string, detail?: unknown) => void;
  private readonly onLive: (live: boolean) => void;
  private announced: boolean | null = null;

  private socket: NotesSocket | null = null;
  /** The relay said the recognizer is ready for audio */
  private ready = false;
  /** Bumped whenever the current connection is abandoned, so late callbacks are ignored */
  private generation = 0;
  private connecting = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private postTimer: ReturnType<typeof setInterval> | null = null;

  private stopped = false;
  private paused = false;
  /** This recording keeps a media file (or has ended): never stream */
  private disabled = false;
  /** Waiting for the recognizer's last sentence after "finish" */
  private finishing: (() => void) | null = null;

  /** Start of the current recognition stream's audio on this page's clock */
  private streamStartMs: number | null = null;
  private backlog: Frame[] = [];
  private backlogBytes = 0;
  private queue: LiveSentence[] = [];
  private posting = false;

  constructor(options: NotesStreamOptions) {
    this.token = options.token;
    this.relayUrl = options.relayUrl;
    this.openSocket = options.openSocket ?? ((url) => new WebSocket(url) as unknown as NotesSocket);
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.now = options.now ?? (() => Date.now());
    this.log = options.log ?? ((message, detail) => console.warn(`[liveNotes] ${message}`, detail ?? ''));
    this.onLive = options.onLive ?? (() => undefined);
  }

  private announce(live: boolean): void {
    if (this.announced === live) return;
    this.announced = live;
    this.onLive(live);
  }

  start(): void {
    if (this.postTimer) return;
    this.postTimer = setInterval(() => void this.post(), POST_EVERY_MS);
    void this.connect();
  }

  /** True while audio is being recognized or is being kept for the next connection. */
  get active(): boolean {
    return !this.stopped && !this.disabled && !this.paused;
  }

  /** One frame of room audio. `atMs` is when its first sample was captured. */
  pushAudio(pcm: ArrayBuffer, atMs: number): void {
    if (!this.active || this.finishing) return;
    const socket = this.socket;
    if (socket && this.ready && socket.readyState === SOCKET_OPEN) {
      if (socket.bufferedAmount > STALLED_BYTES) {
        this.log('relay stalled; reconnecting');
        this.drop();
        this.keep({ pcm, atMs });
        return;
      }
      this.sendFrame(socket, { pcm, atMs });
      return;
    }
    this.keep({ pcm, atMs });
  }

  /** Pausing ends the recognition stream (its last sentence is still taken); resuming starts a new one. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.clearBacklog();
      void this.finishStream();
    } else if (!this.stopped && !this.disabled) {
      void this.connect();
    }
  }

  /** The session is ending: take the sentence in progress and hand everything in. */
  async finish(): Promise<void> {
    if (this.stopped) return;
    this.paused = true;
    this.clearBacklog();
    await this.finishStream();
    await this.post();
  }

  /** The page is going away. Anything not yet posted goes out as a beacon. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.abandon();
    if (this.postTimer) clearInterval(this.postTimer);
    this.postTimer = null;
    this.clearBacklog();
    const rest = this.queue.splice(0);
    for (let i = 0; i < rest.length; i += LIVE_BATCH_MAX) {
      const body = JSON.stringify({ token: this.token, sentences: rest.slice(i, i + LIVE_BATCH_MAX) });
      const sent = typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
        && navigator.sendBeacon(LIVE_NOTES_PATH, new Blob([body], { type: 'application/json' }));
      if (!sent) {
        void this.fetchImpl(LIVE_NOTES_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch((err: unknown) => this.log('final upload failed', err));
      }
    }
  }

  // ── connection ─────────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    if (!this.active || this.connecting || this.socket) return;
    this.connecting = true;
    const generation = ++this.generation;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try {
      const res = await this.fetchImpl(LIVE_NOTES_TOKEN_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token, clock: this.now() }),
      });
      if (generation !== this.generation || !this.active) return;
      if (res.status === 409) {
        // A recording with a media file, or one that has ended.
        this.disabled = true;
        this.clearBacklog();
        this.announce(false);
        return;
      }
      if (res.status === 404) {
        this.retryIn(NOT_READY_RETRY_MS);
        return;
      }
      if (!res.ok) throw new Error(`ticket request failed (${res.status})`);
      const data: unknown = await res.json();
      if (generation !== this.generation || !this.active) return;
      const ticket = typeof data === 'object' && data !== null ? Reflect.get(data, 'token') : null;
      const lang = typeof data === 'object' && data !== null ? Reflect.get(data, 'lang') : '';
      if (typeof ticket !== 'string' || !ticket) throw new Error('ticket is empty');
      this.announce(true);
      this.open(ticket, typeof lang === 'string' ? lang : '', generation);
    } catch (err) {
      if (generation !== this.generation) return;
      this.log('connect failed', err);
      this.retryIn(reconnectDelayMs(this.attempt++));
    } finally {
      this.connecting = false;
    }
  }

  private open(ticket: string, lang: string, generation: number): void {
    const socket = this.openSocket(this.relayUrl(ticket));
    this.socket = socket;
    this.ready = false;
    this.streamStartMs = null;
    this.readyTimer = setTimeout(() => {
      if (generation === this.generation && !this.ready) this.lost('relay timed out', generation);
    }, READY_TIMEOUT_MS);
    socket.onopen = () => {
      if (generation === this.generation) socket.send(JSON.stringify({ type: 'start', lang }));
    };
    socket.onmessage = (event) => {
      if (generation === this.generation) this.take(String(event.data), socket, generation);
    };
    socket.onerror = () => this.lost('relay connection failed', generation);
    socket.onclose = () => this.lost('relay closed', generation);
  }

  private take(raw: string, socket: NotesSocket, generation: number): void {
    let line: RelayLine;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return;
      line = parsed as RelayLine;
    } catch {
      return;
    }
    if (line.type === 'ready') {
      this.ready = true;
      this.attempt = 0;
      if (this.readyTimer) clearTimeout(this.readyTimer);
      this.readyTimer = null;
      // What was captured while there was no connection goes first, in order.
      const kept = this.backlog;
      this.backlog = [];
      this.backlogBytes = 0;
      for (const frame of kept) this.sendFrame(socket, frame);
      return;
    }
    if (line.type === 'error') {
      this.log('recognizer error', line.message);
      return;
    }
    if (line.type === 'closed') {
      this.lost('recognizer finished', generation);
      return;
    }
    if (line.type !== 'final' || typeof line.text !== 'string' || !line.text.trim()) return;
    if (this.streamStartMs === null) return;
    const time = sentenceWallTime({
      streamStartMs: this.streamStartMs,
      beginMs: typeof line.begin === 'number' ? line.begin : null,
      endMs: typeof line.end === 'number' ? line.end : null,
      nowMs: this.now(),
      text: line.text,
    });
    this.queue.push({
      stream: this.streamStartMs,
      id: typeof line.id === 'number' && Number.isSafeInteger(line.id) && line.id >= 0 ? line.id : this.queue.length,
      startMs: time.startMs,
      endMs: time.endMs,
      text: line.text.trim(),
    });
    if (this.queue.length > QUEUE_MAX) this.queue.splice(0, this.queue.length - QUEUE_MAX);
  }

  private sendFrame(socket: NotesSocket, frame: Frame): void {
    if (this.streamStartMs === null) this.streamStartMs = Math.round(frame.atMs);
    socket.send(frame.pcm);
  }

  /** The connection ended (or never came up). Reconnect unless that was asked for. */
  private lost(reason: string, generation: number): void {
    if (generation !== this.generation) return;
    const wanted = this.finishing;
    this.abandon();
    if (wanted) {
      wanted();
      return;
    }
    if (!this.active) return;
    this.log(reason);
    this.retryIn(reconnectDelayMs(this.attempt++));
  }

  /** Drop the connection now and reconnect. */
  private drop(): void {
    this.abandon();
    if (this.active) this.retryIn(reconnectDelayMs(this.attempt++));
  }

  private abandon(): void {
    this.generation += 1;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    this.finishing = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    }
  }

  private retryIn(ms: number): void {
    if (!this.active || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, ms);
  }

  /** Ask the recognizer to finish, and wait for its last sentence (or a short timeout). */
  private finishStream(): Promise<void> {
    const socket = this.socket;
    if (!socket || !this.ready || socket.readyState !== SOCKET_OPEN) {
      this.abandon();
      return Promise.resolve();
    }
    if (this.finishing) return Promise.resolve();
    const generation = this.generation;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (generation === this.generation) this.abandon();
        resolve();
      }, FINISH_TIMEOUT_MS);
      this.finishing = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.send(JSON.stringify({ type: 'finish' }));
    });
  }

  // ── audio kept while disconnected ──────────────────────────────────────────

  private keep(frame: Frame): void {
    this.backlog.push(frame);
    this.backlogBytes += frame.pcm.byteLength;
    while (this.backlogBytes > BACKLOG_MAX_BYTES && this.backlog.length > 1) {
      this.backlogBytes -= this.backlog.shift()!.pcm.byteLength;
    }
    if (!this.socket && !this.connecting && !this.retryTimer) void this.connect();
  }

  private clearBacklog(): void {
    this.backlog = [];
    this.backlogBytes = 0;
  }

  // ── sentences ──────────────────────────────────────────────────────────────

  private async post(): Promise<void> {
    if (this.posting || this.queue.length === 0 || this.stopped) return;
    const batch = this.queue.splice(0, LIVE_BATCH_MAX);
    this.posting = true;
    try {
      const res = await this.fetchImpl(LIVE_NOTES_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token, sentences: batch }),
      });
      // 404: the session row isn't written yet. 5xx: the server failed for now. Both: try again.
      if (res.status === 404 || res.status >= 500) this.queue.unshift(...batch);
      else if (res.status === 409) {
        this.disabled = true;
        this.announce(false);
      }
      else if (!res.ok) this.log(`sentences refused (${res.status})`);
    } catch (err) {
      this.queue.unshift(...batch);
      this.log('upload failed', err);
    } finally {
      this.posting = false;
    }
  }
}

/** Linear resampling of one mono frame. */
export function resampleMono(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.round(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const at = i * ratio;
    const lo = Math.floor(at);
    const hi = Math.min(lo + 1, input.length - 1);
    output[i] = input[lo] * (1 - (at - lo)) + input[hi] * (at - lo);
  }
  return output;
}

export function floatToPcm16(input: Float32Array): ArrayBuffer {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const n = Math.max(-1, Math.min(1, input[i]));
    out[i] = n < 0 ? n * 32768 : n * 32767;
  }
  return out.buffer;
}
