'use client';

import { useEffect, useState } from 'react';
import { authFetch, getKloudSessionBearer } from '@/lib/kloudSession';

type ProfileFlags = { isAccountAdmin: boolean; isInternalStaff: boolean };

const NO_FLAGS: ProfileFlags = { isAccountAdmin: false, isInternalStaff: false };

/** One profile lookup per session token, shared by every menu instance. */
const flagsByToken = new Map<string, Promise<ProfileFlags>>();

function fetchProfileFlags(token: string): Promise<ProfileFlags> {
  let pending = flagsByToken.get(token);
  if (!pending) {
    pending = authFetch('/api/auth/profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        return { isAccountAdmin: d.isAccountAdmin === true, isInternalStaff: d.isInternalStaff === true };
      })
      .catch(() => NO_FLAGS);
    flagsByToken.set(token, pending);
  }
  return pending;
}

function useProfileFlag(flag: keyof ProfileFlags): boolean {
  const [value, setValue] = useState(false);

  useEffect(() => {
    const token = getKloudSessionBearer();
    if (!token) return;
    let cancelled = false;
    void fetchProfileFlags(token).then((flags) => {
      if (!cancelled) setValue(flags[flag]);
    });
    return () => {
      cancelled = true;
    };
  }, [flag]);

  return value;
}

/**
 * Whether the logged-in member is an account OWNER / CO_OWNER.
 * UI-only gate for admin entry points; the server enforces access itself.
 */
export function useIsAccountAdmin(): boolean {
  return useProfileFlag('isAccountAdmin');
}

/**
 * Whether the logged-in member is Kloud Meet staff (INTERNAL_STAFF_EMAILS on the server).
 * UI-only gate for System Settings; the server enforces access itself.
 */
export function useIsInternalStaff(): boolean {
  return useProfileFlag('isInternalStaff');
}
