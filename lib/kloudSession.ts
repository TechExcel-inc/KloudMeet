/** Client-side Kloud session token helpers (browser only). */

/** Fired after a meeting sign-in writes `kloudUser`, so open UI can update without a reload. */
export const KLOUD_AUTH_CHANGED = 'kloud-auth-changed';

export interface StoredKloudUser {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  token: string;
}

/**
 * readStoredKloudUser — 读本地已登录账号。没有 token 或姓名时视为未登录。
 */
export function readStoredKloudUser(): StoredKloudUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('kloudUser');
    if (!raw) return null;
    const user = JSON.parse(raw) as Partial<StoredKloudUser>;
    if (!user || typeof user.token !== 'string' || !user.token) return null;
    const displayName = typeof user.displayName === 'string' ? user.displayName.trim() : '';
    const username = typeof user.username === 'string' ? user.username.trim() : '';
    if (!displayName && !username) return null;
    return {
      id: String(user.id ?? ''),
      username,
      displayName: displayName || username,
      email: typeof user.email === 'string' ? user.email : undefined,
      avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : undefined,
      token: user.token,
    };
  } catch {
    return null;
  }
}

/** publishKloudAuthChanged — 通知会议页登录状态变了，不要整页刷新。 */
export function publishKloudAuthChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(KLOUD_AUTH_CHANGED));
}

export function getKloudSessionBearer(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const local = localStorage.getItem('kloudUser');
    if (local) {
      const u = JSON.parse(local);
      if (u?.token && typeof u.token === 'string') return u.token;
    }
    const sess = sessionStorage.getItem('kloudUser');
    if (sess) {
      const u = JSON.parse(sess);
      if (u?.token && typeof u.token === 'string') return u.token;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getKloudSessionBearer();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function connectionDetailsFetchInit(overrides?: RequestInit): RequestInit {
  const o = overrides ?? {};
  const mergedHeaders = {
    ...authHeaders(),
    ...(typeof o.headers === 'object' && o.headers !== null && !Array.isArray(o.headers)
      ? (o.headers as Record<string, string>)
      : {}),
  };
  return { ...o, headers: mergedHeaders };
}

/** fetch with Bearer when logged in */
export function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const o = init ?? {};
  return fetch(input, {
    ...o,
    headers: {
      ...authHeaders(),
      ...(typeof o.headers === 'object' && o.headers !== null && !Array.isArray(o.headers)
        ? (o.headers as Record<string, string>)
        : {}),
    },
  });
}
