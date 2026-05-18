/** Client-side Kloud session token helpers (browser only). */

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
