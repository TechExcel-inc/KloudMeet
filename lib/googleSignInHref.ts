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
