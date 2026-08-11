/** Renew this many ms before JWT `exp` (silent disconnect + reconnect). */
export const LIVEKIT_TOKEN_RENEW_MARGIN_MS = 5 * 60 * 1000;

/** Minimum delay before a scheduled renew runs (avoids tight loops). */
export const LIVEKIT_TOKEN_RENEW_MIN_DELAY_MS = 3_000;

type LiveKitJwtClaims = {
  exp?: unknown;
  nbf?: unknown;
};

/**
 * Parse JWT payload claims (no signature verify). Client renew / reuse only.
 */
export function parseJwtClaims(token: string): LiveKitJwtClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (normalized.length % 4)) % 4;
    const json = atob(normalized + '='.repeat(padLen));
    return JSON.parse(json) as LiveKitJwtClaims;
  } catch {
    return null;
  }
}

/**
 * Parse JWT `exp` (seconds) → epoch ms. Returns null if malformed.
 * Does not verify signature — only used for client-side renew scheduling.
 */
export function parseJwtExpiryMs(token: string): number | null {
  const claims = parseJwtClaims(token);
  if (!claims || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
    return null;
  }
  return claims.exp * 1000;
}

/** Ms until we should renew; 0 if already past the renew margin. */
export function msUntilLiveKitTokenRenew(token: string, nowMs = Date.now()): number | null {
  const expMs = parseJwtExpiryMs(token);
  if (expMs == null) return null;
  return Math.max(0, expMs - LIVEKIT_TOKEN_RENEW_MARGIN_MS - nowMs);
}

/**
 * True when the participant JWT still has life left before the renew window.
 * Reuse these on network reconnects so we do not mint a new ticket.
 * Returns false for malformed tokens, renew-before-expiry, or legacy `nbf: 0`
 * tickets (those are permanently rejected by LiveKit Cloud after any revoke).
 */
export function isLiveKitParticipantTokenReusable(
  token: string,
  nowMs = Date.now(),
): boolean {
  const claims = parseJwtClaims(token);
  if (!claims) return false;
  // Old livekit-server-sdk hardcoded nbf=0 — never reuse after Cloud revoke.
  if (claims.nbf === 0) return false;
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
