'use client';

import { useEffect, useState } from 'react';
import { authFetch, getKloudSessionBearer } from '@/lib/kloudSession';

/** One profile lookup per session token, shared by every menu instance. */
const adminByToken = new Map<string, Promise<boolean>>();

function fetchIsAccountAdmin(token: string): Promise<boolean> {
  let pending = adminByToken.get(token);
  if (!pending) {
    pending = authFetch('/api/auth/profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) =>
        Boolean(data && typeof data === 'object' && (data as { isAccountAdmin?: unknown }).isAccountAdmin === true),
      )
      .catch(() => false);
    adminByToken.set(token, pending);
  }
  return pending;
}

/**
 * Whether the logged-in member is an account OWNER / CO_OWNER.
 * UI-only gate for admin entry points; the server enforces access itself.
 */
export function useIsAccountAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const token = getKloudSessionBearer();
    if (!token) return;
    let cancelled = false;
    void fetchIsAccountAdmin(token).then((value) => {
      if (!cancelled) setIsAdmin(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return isAdmin;
}
