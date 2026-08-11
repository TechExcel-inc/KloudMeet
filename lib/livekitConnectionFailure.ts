/**
 * LiveKit disconnect must auto-recover when the Kloud session is still valid.
 * If recovery still fails, that is a serious failure — log loudly for root-cause work.
 */

export type SeriousLiveKitFailurePhase =
  | 'initial-connect'
  | 'unexpected-disconnect'
  | 'recovery'
  | 'manual-rejoin'
  | 'token-renew'
  | 'retries-exhausted';

export type SeriousLiveKitFailureContext = {
  phase: SeriousLiveKitFailurePhase;
  attempt: number;
  maxAttempts: number;
  roomName?: string;
  roomState?: string;
  disconnectReason?: string;
  authFail?: boolean;
  online?: boolean;
  error: Error;
  extra?: Record<string, unknown>;
};

export function logSeriousLiveKitFailure(ctx: SeriousLiveKitFailureContext): void {
  const payload = {
    tag: 'SERIOUS_LIVEKIT_FAILURE',
    ts: new Date().toISOString(),
    phase: ctx.phase,
    attempt: ctx.attempt,
    maxAttempts: ctx.maxAttempts,
    roomName: ctx.roomName,
    roomState: ctx.roomState,
    disconnectReason: ctx.disconnectReason,
    authFail: !!ctx.authFail,
    online: typeof navigator !== 'undefined' ? navigator.onLine : ctx.online,
    errorName: ctx.error?.name,
    errorMessage: ctx.error?.message,
    stack: ctx.error?.stack,
    href: typeof window !== 'undefined' ? window.location.href : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    extra: ctx.extra,
  };

  // Loud, searchable marker — every exhausted recovery must leave a trail.
  console.error('[KloudMeet][SERIOUS_LIVEKIT_FAILURE] Auto-recover failed; something is seriously wrong.', payload);
  try {
    console.error('[KloudMeet][SERIOUS_LIVEKIT_FAILURE_JSON]', JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function isKloudSessionExpiredError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('session expired');
}
