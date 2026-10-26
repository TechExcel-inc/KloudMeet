/**
 * Why a caption engine could not start or stopped, so the supervisor knows whether to retry
 * and the overlay knows what to say.
 */

export type CaptionFailure =
  /** Relay, token endpoint or speech service unreachable / closed. Retried. */
  | 'network'
  /** Meeting token rejected (it may have just been renewed). Retried. */
  | 'auth'
  /** Microphone is held by another app or the OS for a moment. Retried. */
  | 'mic-busy'
  /** Microphone permission denied. Needs the user. */
  | 'mic-denied'
  /** No microphone (or the chosen one was unplugged). Needs the user. */
  | 'mic-missing'
  /** The host's caption time is used up (billing 402). Retrying cannot help. */
  | 'quota'
  /** Captions are not configured or the meeting is unknown. Retrying cannot help. */
  | 'unavailable';

export class CaptionEngineError extends Error {
  constructor(public readonly kind: CaptionFailure, message: string) {
    super(message);
    this.name = 'CaptionEngineError';
  }
}

const RETRYABLE: ReadonlySet<CaptionFailure> = new Set(['network', 'auth', 'mic-busy']);

export function isRetryable(kind: CaptionFailure): boolean {
  return RETRYABLE.has(kind);
}

/** Token endpoint status → failure kind. */
export function httpFailure(status: number): CaptionFailure {
  if (status === 402) return 'quota';
  if (status === 401 || status === 403) return 'auth';
  if (status === 408 || status === 429 || status >= 500) return 'network';
  return 'unavailable';
}

/** getUserMedia rejection → failure kind. */
export function micFailure(err: unknown): CaptionFailure {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'mic-denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'mic-missing';
  return 'mic-busy';
}

/** Anything an engine threw → a typed error (unknown errors count as network trouble). */
export function toCaptionError(err: unknown): CaptionEngineError {
  if (err instanceof CaptionEngineError) return err;
  return new CaptionEngineError('network', err instanceof Error ? err.message : String(err));
}
