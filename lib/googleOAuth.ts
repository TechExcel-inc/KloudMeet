import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { safeReplayNext } from '@/lib/recordingReplayPath';
import { validLinkToken } from '@/lib/accountLinking';

/**
 * Google sign-in / sign-up (OAuth 2.0 authorization code flow).
 * The start route stores a random `state` (and an optional post-login `next` path) in a short-lived
 * httpOnly cookie; the callback only accepts a response carrying the same state (login CSRF guard).
 */

export const GOOGLE_STATE_COOKIE = 'km_google_oauth';
export const GOOGLE_STATE_MAX_AGE_SECONDS = 10 * 60;
const COOKIE_PATH = '/api/auth/google';

/** Public origin of the app — NEXT_PUBLIC_APP_URL, else the Host the browser used (proxy-aware). */
export function appOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const url = new URL(request.url);
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(/:$/, '');
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

export function googleRedirectUri(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

/**
 * `desktop` is the desktop app's PKCE challenge when sign-in started from the app.
 * `link` is a one-time "Connect Google" intent from My Profile (see lib/accountLinking.ts).
 */
export type GoogleStatePayload = { state: string; next: string | null; desktop?: string | null; link?: string | null };

const PKCE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

/** A base64url SHA-256 PKCE challenge (43 chars), or null. */
export function validDesktopChallenge(raw: unknown): string | null {
  return typeof raw === 'string' && PKCE_CHALLENGE_RE.test(raw) ? raw : null;
}

export function newGoogleState(
  rawNext: string | null,
  rawDesktop: string | null = null,
  rawLink: string | null = null,
): GoogleStatePayload {
  return {
    state: crypto.randomBytes(24).toString('hex'),
    next: safeReplayNext(rawNext),
    desktop: validDesktopChallenge(rawDesktop),
    link: validLinkToken(rawLink),
  };
}

export function encodeGoogleState(payload: GoogleStatePayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeGoogleState(raw: string | undefined | null): GoogleStatePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed?.state !== 'string' || !parsed.state) return null;
    return {
      state: parsed.state,
      next: safeReplayNext(typeof parsed.next === 'string' ? parsed.next : null),
      desktop: validDesktopChallenge(parsed.desktop),
      link: validLinkToken(parsed.link),
    };
  } catch {
    return null;
  }
}

/** Constant-time comparison of the state echoed by Google with the one in our cookie. */
export function stateMatches(expected: string, received: string | null): boolean {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function googleStateCookieOptions(origin: string, maxAge = GOOGLE_STATE_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: origin.startsWith('https://'),
    sameSite: 'lax' as const,
    path: COOKIE_PATH,
    maxAge,
  };
}

export function buildGoogleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Username for a new account: the email's local part, letters and digits only. */
export function usernameBaseFromEmail(email: string): string {
  const base = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  return base || 'user';
}
