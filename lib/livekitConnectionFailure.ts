/**
 * LiveKit disconnect must auto-recover when the Kloud session is still valid.
 * Exhausted auto-recover is a serious failure (bug path): log loudly, then
 * pragmatic rejoin — not a designed "failed N times" product experience.
 */

import {
  isLiveKitAuthError,
  isLiveKitParticipantTokenReusable,
  parseJwtExpiryMs,
} from './livekitToken';

export type SeriousLiveKitFailurePhase =
  | 'initial-connect'
  | 'unexpected-disconnect'
  | 'recovery'
  | 'manual-rejoin'
  | 'pragmatic-rejoin'
  | 'token-renew'
  | 'retries-exhausted'
  | 'pragmatic-rejoin-failed';

export type LiveKitFailureKind = 'auth' | 'network' | 'unknown';

export type SeriousLiveKitFailureContext = {
  phase: SeriousLiveKitFailurePhase;
  attempt: number;
  maxAttempts: number;
  roomName?: string;
  roomState?: string;
  disconnectReason?: string;
  authFail?: boolean;
  failureKind?: LiveKitFailureKind;
  online?: boolean;
  participantToken?: string;
  error: Error;
  extra?: Record<string, unknown>;
};

export function classifyLiveKitFailure(err: unknown): LiveKitFailureKind {
  if (isLiveKitAuthError(err)) return 'auth';
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (
    msg.includes('signal connection') ||
    msg.includes('websocket') ||
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('server unreachable') ||
    msg.includes('disconnect') ||
    msg.includes('disconnected') ||
    msg.includes('client initiated disconnect') ||
    (err instanceof Error && err.name === 'AbortError')
  ) {
    return 'network';
  }
  return 'unknown';
}

export function buildLiveKitTokenDiagnostics(token?: string): {
  tokenPresent: boolean;
  tokenExpIso: string | null;
  tokenMsRemaining: number | null;
  tokenReusable: boolean;
} {
  if (!token) {
    return {
      tokenPresent: false,
      tokenExpIso: null,
      tokenMsRemaining: null,
      tokenReusable: false,
    };
  }
  const expMs = parseJwtExpiryMs(token);
  return {
    tokenPresent: true,
    tokenExpIso: expMs != null ? new Date(expMs).toISOString() : null,
    tokenMsRemaining: expMs != null ? expMs - Date.now() : null,
    tokenReusable: isLiveKitParticipantTokenReusable(token),
  };
}

export function logSeriousLiveKitFailure(ctx: SeriousLiveKitFailureContext): void {
  const failureKind = ctx.failureKind ?? classifyLiveKitFailure(ctx.error);
  const authFail = ctx.authFail ?? failureKind === 'auth';
  const token = buildLiveKitTokenDiagnostics(ctx.participantToken);

  const payload = {
    tag: 'SERIOUS_LIVEKIT_FAILURE',
    ts: new Date().toISOString(),
    phase: ctx.phase,
    attempt: ctx.attempt,
    maxAttempts: ctx.maxAttempts,
    roomName: ctx.roomName,
    roomState: ctx.roomState,
    disconnectReason: ctx.disconnectReason,
    failureKind,
    authFail,
    online: typeof navigator !== 'undefined' ? navigator.onLine : ctx.online,
    errorName: ctx.error?.name,
    errorMessage: ctx.error?.message,
    stack: ctx.error?.stack,
    token,
    href: typeof window !== 'undefined' ? window.location.href : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    extra: ctx.extra,
  };

  // Loud, searchable marker — every exhausted recovery must leave a trail for RCA.
  console.error(
    '[KloudMeet][SERIOUS_LIVEKIT_FAILURE] Auto-recover failed; treating as bug path (not normal UX).',
    payload,
  );
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
