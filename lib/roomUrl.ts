export function roomPath(roomName: string): string {
  return `/rooms/${encodeURIComponent(roomName)}`;
}

/** Strip all query params from the browser URL. */
export function replaceBrowserRoomUrl(roomName: string): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', roomPath(roomName));
}
