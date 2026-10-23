import { safeReplayNext } from '@/lib/recordingReplayPath';

/** Start Google sign-in, carrying the page to return to (e.g. a replay link) through the round trip. */
export function googleSignInHref(): string {
  const next = safeReplayNext(new URLSearchParams(window.location.search).get('next'));
  return next ? `/api/auth/google?next=${encodeURIComponent(next)}` : '/api/auth/google';
}
