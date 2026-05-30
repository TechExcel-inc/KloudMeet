import { authHeaders } from '@/lib/kloudSession';

const MEETING_CLOSED_NOTICE_KEY = 'kloudMeetingClosedNotice';

/** Persist a short message shown on the home page after redirect. */
export function setMeetingClosedNotice(message: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(MEETING_CLOSED_NOTICE_KEY, message);
  } catch {
    /* ignore */
  }
}

/** Read and clear the home-page notice (returns null if none). */
export function consumeMeetingClosedNotice(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const msg = sessionStorage.getItem(MEETING_CLOSED_NOTICE_KEY);
    if (msg) sessionStorage.removeItem(MEETING_CLOSED_NOTICE_KEY);
    return msg;
  } catch {
    return null;
  }
}

/** True only when meeting is permanently closed (ENDED / CANCELED), not IDLE. */
export async function isMeetingEnded(roomName: string, maxAttempts = 4): Promise<boolean> {
  const encoded = encodeURIComponent(roomName);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(`/api/meetings/${encoded}`, {
        cache: 'no-store',
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.status === 'ENDED' || data?.status === 'CANCELED') {
          return true;
        }
      }
    } catch {
      /* retry */
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return false;
}
