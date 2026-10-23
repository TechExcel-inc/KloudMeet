import type { NextRequest } from 'next/server';

/**
 * Small in-memory sliding-window limiter for auth endpoints. Per server process: it slows down
 * scripted guessing and mail flooding; the per-code attempt cap in the database is the hard limit.
 */

const buckets = new Map<string, number[]>();
const MAX_KEYS = 50_000;

/** Records a hit for `key`; true when the key already used `limit` hits within `windowMs`. */
export function rateLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const since = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > since);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > MAX_KEYS) {
    // Drop the oldest keys (Map keeps insertion order).
    for (const k of buckets.keys()) {
      buckets.delete(k);
      if (buckets.size <= MAX_KEYS * 0.9) break;
    }
  }
  return false;
}

export function resetRateLimits(): void {
  buckets.clear();
}

export function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}
