'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch, getKloudSessionBearer } from '@/lib/kloudSession';
import type { BillingSummaryResponse } from '@/lib/billing/summary';

/** One "is billing on?" lookup per session token, shared by every menu / banner. */
const enabledByToken = new Map<string, Promise<boolean>>();

async function fetchSummary(): Promise<BillingSummaryResponse | null> {
  try {
    const res = await authFetch('/api/billing/summary', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as BillingSummaryResponse;
  } catch {
    return null;
  }
}

/** Whether billing is enabled for the logged-in user (false while unknown or logged out). */
export function useBillingEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const token = getKloudSessionBearer();
    if (!token) return;
    let pending = enabledByToken.get(token);
    if (!pending) {
      pending = fetchSummary().then((s) => Boolean(s && s.enabled));
      enabledByToken.set(token, pending);
    }
    let cancelled = false;
    void pending.then((value) => {
      if (!cancelled) setEnabled(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}

export type BillingSummaryState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'error' }
  | { status: 'ready'; summary: BillingSummaryResponse };

export function useBillingSummary(): { state: BillingSummaryState; reload: () => void } {
  const [state, setState] = useState<BillingSummaryState>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!getKloudSessionBearer()) {
      setState({ status: 'signed-out' });
      return;
    }
    let cancelled = false;
    void fetchSummary().then((summary) => {
      if (cancelled) return;
      setState(summary ? { status: 'ready', summary } : { status: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, [nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload };
}
