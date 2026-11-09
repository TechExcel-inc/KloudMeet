import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n';

export type KloudCompanyState = {
  account: { id: number; accountName: string; kloudCompanyId: string | null; kloudCompanyName: string | null } | null;
  kloudConnected?: boolean;
  canLink: boolean;
  /** null = the company list from the last Kloud sign-in is too old: sign in with Kloud again. */
  candidates: Array<{ id: string; name: string; mappedElsewhere: boolean }> | null;
};

/**
 * The Kloud company this person's team is linked to, and linking / unlinking it
 * (/api/account/kloud-company). Shared by My Profile and Account Settings → Kloud Integration.
 */
export function useKloudCompany(token: string | null, onDone?: (message: string) => void) {
  const { t } = useI18n();
  const [state, setState] = useState<KloudCompanyState | null>(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch('/api/account/kloud-company', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const data = (await res.json()) as KloudCompanyState;
    setState(data);
    const first = data.candidates?.find((c) => !c.mappedElsewhere);
    setChoice((prev) => prev || first?.id || '');
  }, [token]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  /** POST links `choice`; DELETE unlinks. Resolves true when it worked. */
  const send = async (method: 'POST' | 'DELETE'): Promise<boolean> => {
    if (!token) return false;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/account/kloud-company', {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: method === 'POST' ? JSON.stringify({ kloudCompanyId: choice }) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t('profile.actionFailed'));
        return false;
      }
      onDone?.(method === 'POST' ? t('profile.kloudCompanyLinkedToast') : t('profile.kloudCompanyUnlinkedToast'));
      await load();
      return true;
    } catch {
      setError(t('profile.networkError'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const linkedName = state?.account?.kloudCompanyId
    ? state.account.kloudCompanyName || state.account.kloudCompanyId
    : null;

  return { state, choice, setChoice, busy, error, send, linkedName, reload: load };
}
