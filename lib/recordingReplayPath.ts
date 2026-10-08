/** Client-safe recording URL helpers. Do not import Prisma here. */

export function recordingReplayPath(shareKey: string): string {
  return `/recordings/${encodeURIComponent(shareKey)}`;
}

/** Only allow a same-origin replay return path. */
export function safeReplayNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/recordings/')) return null;
  if (raw.includes('..') || raw.includes('\\') || raw.includes('//')) return null;
  if (raw.includes('?') || raw.includes('#')) return null;
  return raw;
}
