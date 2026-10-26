/**
 * CaptionSupervisor — keeps one participant's caption engine running.
 *
 * The engine (Fun-ASR relay or OpenAI) can fail to start or drop mid-meeting. The supervisor
 * retries with backoff, gives up after a few tries (or at once when retrying cannot help, e.g.
 * microphone denied or caption time used up), and reports a status the overlay can show.
 * The engine releases its microphone capture on every failure, so a stopped caption never
 * keeps the mic open.
 */

import type { CaptionEngine } from './RtasrHelper';
import { isRetryable, toCaptionError, type CaptionFailure } from './captionErrors';

export type CaptionState =
  /** Not recognising: captions off or this participant's mic is off. */
  | 'idle'
  | 'connecting'
  | 'live'
  /** Lost or could not connect; another try is scheduled. */
  | 'reconnecting'
  /** Stopped trying; waits for Retry. */
  | 'failed';

export interface CaptionStatus {
  state: CaptionState;
  /** Why the last try failed (reconnecting / failed only). */
  failure?: CaptionFailure;
  /** Retries made since the engine was last live for a while. */
  attempt: number;
}

export const IDLE_CAPTION_STATUS: CaptionStatus = { state: 'idle', attempt: 0 };

/** Delay before each retry; after the last one the supervisor gives up (~30 s in all). */
export const CAPTION_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
/** A connection that stays up this long earns a fresh set of retries. */
export const CAPTION_STABLE_MS = 30000;

export interface CaptionSupervisorOptions {
  delays?: number[];
  stableMs?: number;
}

export class CaptionSupervisor {
  private _status: CaptionStatus = IDLE_CAPTION_STATUS;
  private _wanted = false;
  private _deviceId = '';
  private _seq = 0;
  private _attempt = 0;
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _stableTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _delays: number[];
  private readonly _stableMs: number;

  constructor(
    private readonly engine: CaptionEngine,
    private readonly onStatus: (status: CaptionStatus) => void,
    options: CaptionSupervisorOptions = {},
  ) {
    this._delays = options.delays ?? CAPTION_RETRY_DELAYS_MS;
    this._stableMs = options.stableMs ?? CAPTION_STABLE_MS;
    engine.OnDropped = (err) => {
      if (this._wanted) this._fail(err);
    };
  }

  get status(): CaptionStatus {
    return this._status;
  }

  /** Start recognising (no-op while already running or retrying). */
  start(deviceId = '') {
    if (this._wanted) return;
    this._wanted = true;
    this._deviceId = deviceId;
    this._attempt = 0;
    this._connect('connecting');
  }

  /** Stop recognising and release the microphone. */
  stop() {
    this._wanted = false;
    this._seq += 1;
    this._clearTimers();
    this.engine.Stop();
    this._attempt = 0;
    this._set({ state: 'idle', attempt: 0 });
  }

  /** User asked to try again: fresh set of retries, starting now. */
  retry() {
    if (!this._wanted) return;
    this._clearTimers();
    this._seq += 1;
    this.engine.Stop();
    this._attempt = 0;
    this._connect('connecting');
  }

  /**
   * The network came back: skip the rest of the current wait, or, if we already gave up
   * because of the network (offline longer than the retries last), try again by ourselves.
   */
  nudge() {
    if (!this._wanted) return;
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
      this._connect('reconnecting');
      return;
    }
    if (this._status.state === 'failed' && this._status.failure === 'network') this.retry();
  }

  /** Stop for good (unmount). */
  dispose() {
    this.stop();
    this.engine.OnDropped = undefined;
  }

  private _connect(state: 'connecting' | 'reconnecting') {
    const seq = ++this._seq;
    this._set({ state, failure: state === 'reconnecting' ? this._status.failure : undefined, attempt: this._attempt });
    this.engine.Start(this._deviceId).then(
      () => {
        if (seq !== this._seq || !this._wanted) return;
        this._set({ state: 'live', attempt: this._attempt });
        this._stableTimer = setTimeout(() => {
          this._stableTimer = null;
          this._attempt = 0;
        }, this._stableMs);
      },
      (err: unknown) => {
        if (seq !== this._seq || !this._wanted) return;
        this._fail(err);
      },
    );
  }

  private _fail(err: unknown) {
    const error = toCaptionError(err);
    this._seq += 1;
    this._clearTimers();
    this.engine.Stop();
    console.warn('[captions]', error.kind, error.message);
    if (!isRetryable(error.kind) || this._attempt >= this._delays.length) {
      this._set({ state: 'failed', failure: error.kind, attempt: this._attempt });
      return;
    }
    const delay = this._delays[this._attempt];
    this._attempt += 1;
    this._set({ state: 'reconnecting', failure: error.kind, attempt: this._attempt });
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._connect('reconnecting');
    }, delay);
  }

  private _clearTimers() {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    if (this._stableTimer) clearTimeout(this._stableTimer);
    this._retryTimer = null;
    this._stableTimer = null;
  }

  private _set(next: CaptionStatus) {
    const prev = this._status;
    if (prev.state === next.state && prev.failure === next.failure && prev.attempt === next.attempt) return;
    this._status = next;
    this.onStatus(next);
  }
}
