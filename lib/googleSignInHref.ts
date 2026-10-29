import { safeReplayNext } from '@/lib/recordingReplayPath';

/** Start Google sign-in, carrying the page to return to (e.g. a replay link) through the round trip. */
export function googleSignInHref(): string {
  const next = safeReplayNext(new URLSearchParams(window.location.search).get('next'));
  return next ? `/api/auth/google?next=${encodeURIComponent(next)}` : '/api/auth/google';
}

/** True in a desktop app build that hands Google sign-in to the system browser. */
export function googleSignInOpensBrowser(): boolean {
  const api = (window as unknown as { electronAPI?: { googleSignInInBrowser?: boolean } }).electronAPI;
  return api?.googleSignInInBrowser === true;
}

/** "Continue with Kloud" is offered once kloud.cn's confirm page is live (NEXT_PUBLIC_KLOUD_SIGN_IN=1). */
export const KLOUD_SIGN_IN_ENABLED = process.env.NEXT_PUBLIC_KLOUD_SIGN_IN === '1';

/** Start Kloud sign-in, carrying the page to return to through the round trip. */
export function kloudSignInHref(): string {
  const next = safeReplayNext(new URLSearchParams(window.location.search).get('next'));
  return next ? `/api/auth/kloud?next=${encodeURIComponent(next)}` : '/api/auth/kloud';
}
