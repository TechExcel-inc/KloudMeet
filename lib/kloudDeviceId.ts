import { randomString } from '@/lib/client-utils';

const SESSION_KEY = 'kloud-device-id';

/**
 * Per-tab device id for LiveKit identity suffix.
 * sessionStorage → each browser tab/window is unique; physical devices differ too.
 */
export function getKloudDeviceId(): string {
  if (typeof window === 'undefined') return 'server';

  try {
    const existing = sessionStorage.getItem(SESSION_KEY)?.trim();
    if (existing && /^[a-z0-9]{4,32}$/.test(existing)) {
      return existing;
    }
    const created = randomString(8);
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return randomString(8);
  }
}

/** Append deviceId query param for /api/connection-details identity suffix. */
export function appendKloudDeviceId(url: URL): void {
  url.searchParams.set('deviceId', getKloudDeviceId());
}
