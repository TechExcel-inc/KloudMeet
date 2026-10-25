import type { StoredDesignLink } from '@/lib/designLink';

/** Persist the Design-mode link for late joiners (null clears it). Throws on failure. */
export async function persistMeetingDesignLink({
  roomName,
  url,
  view,
  livekitToken,
}: {
  roomName: string;
  url: string | null;
  /** When clearing: the view the stage goes back to */
  view?: string;
  livekitToken: string;
}): Promise<StoredDesignLink | null> {
  const response = await fetch(`/api/meetings/${encodeURIComponent(roomName)}/design`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${livekitToken}`,
    },
    body: JSON.stringify(url === null && view ? { url, view } : { url }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`persistMeetingDesignLink: ${response.status} ${data?.code || data?.error || ''}`);
  }
  return (data?.designLink as StoredDesignLink | null) ?? null;
}

export interface RecentDesignLink {
  url: string;
  label: string;
  kind: 'figma' | 'web';
  at: number;
}

const RECENT_KEY = 'km-design-recent';
const MAX_RECENT = 8;

/** Links this browser has shown recently (newest first). */
export function readRecentDesignLinks(): RecentDesignLink[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (item): item is RecentDesignLink =>
          !!item && typeof item.url === 'string' && typeof item.label === 'string' && typeof item.at === 'number',
      )
      .map((item): RecentDesignLink => ({ ...item, kind: item.kind === 'figma' ? 'figma' : 'web' }))
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function rememberDesignLink(link: Omit<RecentDesignLink, 'at'>): RecentDesignLink[] {
  const next = [{ ...link, at: Date.now() }, ...readRecentDesignLinks().filter((item) => item.url !== link.url)].slice(
    0,
    MAX_RECENT,
  );
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage may be unavailable */
  }
  return next;
}

export function forgetDesignLink(url: string): RecentDesignLink[] {
  const next = readRecentDesignLinks().filter((item) => item.url !== url);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage may be unavailable */
  }
  return next;
}
