/** Query keys kept on room URLs (codec/hq affect LiveKit; region is routing). */
const ROOM_TECH_PARAMS = ['region', 'codec', 'hq'] as const;

export function pickRoomTechSearchParams(
  input: URLSearchParams | string,
): URLSearchParams {
  const raw =
    typeof input === 'string'
      ? input.startsWith('?')
        ? input.slice(1)
        : input
      : input.toString();
  const src = new URLSearchParams(raw);
  const out = new URLSearchParams();
  for (const key of ROOM_TECH_PARAMS) {
    const v = src.get(key);
    if (v != null && v !== '') {
      out.set(key, v);
    }
  }
  return out;
}

export function roomPathWithTechParams(
  roomName: string,
  tech?: URLSearchParams,
): string {
  const q = tech?.toString();
  return q
    ? `/rooms/${encodeURIComponent(roomName)}?${q}`
    : `/rooms/${encodeURIComponent(roomName)}`;
}

/** Remove action/via and other non-tech params from the browser URL. */
export function replaceBrowserRoomUrl(
  roomName: string,
  region?: string,
): void {
  if (typeof window === 'undefined') return;
  const tech = pickRoomTechSearchParams(new URL(window.location.href).searchParams);
  if (region && !tech.has('region')) {
    tech.set('region', region);
  }
  window.history.replaceState(null, '', roomPathWithTechParams(roomName, tech));
}
