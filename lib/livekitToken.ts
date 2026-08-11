/** Renew this many ms before JWT `exp` (silent disconnect + reconnect). */
export const LIVEKIT_TOKEN_RENEW_MARGIN_MS = 5 * 60 * 1000;

/** Minimum delay before a scheduled renew runs (avoids tight loops). */
export const LIVEKIT_TOKEN_RENEW_MIN_DELAY_MS = 3_000;

/**
 * Parse JWT `exp` (seconds) → epoch ms. Returns null if malformed.
 * Does not verify signature — only used for client-side renew scheduling.
 */
export function parseJwtExpiryMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (normalized.length % 4)) % 4;
    const json = atob(normalized + '='.repeat(padLen));
    const claims = JSON.parse(json) as { exp?: unknown };
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null;
    return claims.exp * 1000;
  } catch {
    return null;
  }
}

/** Ms until we should renew; 0 if already past the renew margin. */
export function msUntilLiveKitTokenRenew(token: string, nowMs = Date.now()): number | null {
  const expMs = parseJwtExpiryMs(token);
  if (expMs == null) return null;
  return Math.max(0, expMs - LIVEKIT_TOKEN_RENEW_MARGIN_MS - nowMs);
}

/**
 * True when the participant JWT still has life left before the renew window.
 * Reuse these on network reconnects so we do not mint (and revoke) a new ticket.
 * Returns false for malformed tokens or when renew-before-expiry is due.
 */
export function isLiveKitParticipantTokenReusable(
  token: string,
  nowMs = Date.now(),
): boolean {
  const waitMs = msUntilLiveKitTokenRenew(token, nowMs);
  return waitMs != null && waitMs > 0;
}

type LiveKitConnectionErrorLike = {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  reasonName?: unknown;
};

/** LiveKit Cloud rejected the participant JWT (regions / rtc 401, etc.). */
export function isLiveKitAuthError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as LiveKitConnectionErrorLike;
    // ConnectionError from livekit-client copies status/reason onto the thrown error
    if (e.status === 401 || e.status === 403) return true;
    if (e.reasonName === 'NotAllowed') return true;
  }

  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('unauthorized') ||
    msg.includes('not allowed') ||
    msg.includes('invalid token') ||
    msg.includes('token revoked') ||
    msg.includes('token: revoked') ||
    msg.includes('invalid authorization') ||
    msg.includes('invalid api key') ||
    msg.includes('token expired') ||
    msg.includes('token is expired') ||
    msg.includes('could not fetch region settings') ||
    /\b401\b/.test(msg) ||
    /\b403\b/.test(msg)
  );
}
