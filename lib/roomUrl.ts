import { SPEAK_TOKEN_PARAM } from '@/lib/recordingSpeakActivity';

export function roomPath(roomName: string): string {
  return `/rooms/${encodeURIComponent(roomName)}`;
}

/** Strip transient query params from the browser URL, but keep recorder bot mode. */
export function replaceBrowserRoomUrl(roomName: string): void {
  if (typeof window === 'undefined') return;
  const nextUrl = new URL(roomPath(roomName), window.location.origin);
  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.get('isBot') === 'true') {
    nextUrl.searchParams.set('isBot', 'true');
    const token = currentUrl.searchParams.get(SPEAK_TOKEN_PARAM);
    if (token) nextUrl.searchParams.set(SPEAK_TOKEN_PARAM, token);
  }
  window.history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}`);
}
