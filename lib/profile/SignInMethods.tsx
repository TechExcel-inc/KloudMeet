import React, { useCallback, useEffect, useState } from 'react';
import styles from '../../styles/MyProfileModal.module.css';
import { useI18n } from '../i18n';
import { KLOUD_SIGN_IN_ENABLED } from '../googleSignInHref';

export type SignInMethodsState = {
  email: string | null;
  emailVerified: boolean;
  google: { connected: boolean; canDisconnect: boolean };
  kloud: { connected: boolean; canDisconnect: boolean };
};

type Provider = 'google' | 'kloud';

type KloudCompanyState = {
  account: { id: number; accountName: string; kloudCompanyId: string | null; kloudCompanyName: string | null } | null;
  canLink: boolean;
  candidates: Array<{ id: string; name: string; mappedElsewhere: boolean }> | null;
};

const GoogleMark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 01-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" />
    <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0012 22z" />
    <path fill="#FBBC05" d="M6.4 14a6 6 0 010-3.9V7.5H3.1a10 10 0 000 9z" />
    <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 003.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6z" />
  </svg>
);

const KloudMark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="6" fill="#5552D9" />
    <path fill="#fff" d="M8.2 16.5a3 3 0 01-.4-6 4.3 4.3 0 018.3-.9 2.9 2.9 0 01.7 5.7 3.4 3.4 0 01-.8.1H8.2z" />
  </svg>
);

/**
 * My Profile → Account Security: Google and Kloud as sign-in methods on this account, and (with Kloud
 * connected) which Kloud company this person's Kloud Meet company mirrors.
 */
export function SignInMethods({
  token,
  methods,
  onChange,
  toast,
}: {
  token: string;
  methods: SignInMethodsState;
  onChange: (next: SignInMethodsState) => void;
  toast?: { show: (m: string) => void };
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [confirming, setConfirming] = useState<Provider | null>(null);
  const [error, setError] = useState<{ provider: Provider; message: string } | null>(null);

  const post = async (provider: Provider, action: 'connect' | 'disconnect') => {
    setBusy(provider);
    setError(null);
    try {
      const res = await fetch('/api/account/sign-in-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ provider, message: data.code === 'LAST_METHOD' ? t('profile.lastMethod') : data.error || t('profile.actionFailed') });
        return;
      }
      if (action === 'connect' && typeof data.url === 'string') {
        // The provider brings the browser back to the home page.
        window.location.href = data.url;
        return;
      }
      onChange(data as SignInMethodsState);
      setConfirming(null);
      toast?.show(t('profile.disconnected'));
    } catch {
      setError({ provider, message: t('profile.networkError') });
    } finally {
      setBusy(null);
    }
  };

  const row = (provider: Provider, label: string, mark: React.ReactNode) => {
    const state = methods[provider];
    const name = provider === 'google' ? 'Google' : 'Kloud';
    return (
      <div className={styles.formRow} key={provider}>
        <div className={styles.formLabel}>
          {mark}
          {label}
        </div>
        <div className={styles.changeBtnWrapper}>
          {confirming === provider ? (
            <div className={styles.confirmBox}>
              <div className={styles.formNote}>{t('profile.disconnectQuestion', { provider: name })}</div>
              <div className={styles.passwordActions}>
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={() => void post(provider, 'disconnect')}
                  disabled={busy === provider}
                >
                  {t('profile.disconnect')}
                </button>
                <button type="button" className={styles.btnCancelPassword} onClick={() => setConfirming(null)}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.securityValue}>
                {state.connected ? (
                  <span className={styles.verifiedBadge}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    {t('profile.connected')}
                  </span>
                ) : (
                  <span className={styles.methodMuted}>{t('profile.notConnected')}</span>
                )}
              </div>
              {state.connected ? (
                <button
                  type="button"
                  className={styles.btnChange}
                  onClick={() => {
                    setError(null);
                    setConfirming(provider);
                  }}
                  disabled={!state.canDisconnect}
                  title={state.canDisconnect ? undefined : t('profile.lastMethod')}
                >
                  {t('profile.disconnect')}
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.btnChange}
                  onClick={() => void post(provider, 'connect')}
                  disabled={busy === provider}
                >
                  {t('profile.connect')}
                </button>
              )}
            </>
          )}
          {error?.provider === provider && <div className={styles.inlineError}>{error.message}</div>}
        </div>
      </div>
    );
  };

  return (
    <>
      {row('google', t('profile.google'), <GoogleMark />)}
      {(KLOUD_SIGN_IN_ENABLED || methods.kloud.connected) && row('kloud', t('profile.kloud'), <KloudMark />)}
      {methods.kloud.connected && <KloudCompanyRow token={token} toast={toast} />}
    </>
  );
}

function KloudCompanyRow({ token, toast }: { token: string; toast?: { show: (m: string) => void } }) {
  const { t } = useI18n();
  const [state, setState] = useState<KloudCompanyState | null>(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
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

  const send = async (method: 'POST' | 'DELETE') => {
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
        return;
      }
      setConfirmUnlink(false);
      toast?.show(method === 'POST' ? t('profile.kloudCompanyLinkedToast') : t('profile.kloudCompanyUnlinkedToast'));
      await load();
    } catch {
      setError(t('profile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;
  const linkedName = state.account?.kloudCompanyId ? state.account.kloudCompanyName || state.account.kloudCompanyId : null;

  let body: React.ReactNode;
  if (linkedName) {
    body = confirmUnlink ? (
      <div className={styles.confirmBox}>
        <div className={styles.formNote}>{t('profile.unlinkQuestion', { company: linkedName })}</div>
        <div className={styles.passwordActions}>
          <button type="button" className={styles.btnDanger} onClick={() => void send('DELETE')} disabled={busy}>
            {t('profile.unlink')}
          </button>
          <button type="button" className={styles.btnCancelPassword} onClick={() => setConfirmUnlink(false)}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    ) : (
      <>
        <div className={styles.securityValue}>{linkedName}</div>
        <button type="button" className={styles.btnChange} onClick={() => setConfirmUnlink(true)}>
          {t('profile.unlink')}
        </button>
      </>
    );
  } else if (!state.canLink) {
    body = <div className={styles.formNote}>{t('profile.onlyOwnerCanLink')}</div>;
  } else if (state.candidates === null) {
    body = (
      <>
        <div className={styles.formNote}>{t('profile.kloudCompaniesStale')}</div>
        <button
          type="button"
          className={styles.btnChange}
          onClick={() => {
            window.location.href = '/api/auth/kloud';
          }}
        >
          {t('profile.signInWithKloudAgain')}
        </button>
      </>
    );
  } else if (state.candidates.length === 0) {
    body = <div className={styles.formNote}>{t('profile.noKloudAdminCompanies')}</div>;
  } else {
    body = (
      <div className={styles.confirmBox}>
        <div className={styles.passwordActions}>
          <select
            className={`${styles.inputBox} ${styles.companySelect}`}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            aria-label={t('profile.chooseKloudCompany')}
          >
            {state.candidates.map((c) => (
              <option key={c.id} value={c.id} disabled={c.mappedElsewhere}>
                {c.mappedElsewhere ? `${c.name} ${t('profile.mappedElsewhere')}` : c.name}
              </option>
            ))}
          </select>
          <button type="button" className={styles.btnChange} onClick={() => void send('POST')} disabled={busy || !choice}>
            {t('profile.link')}
          </button>
        </div>
        <div className={styles.formNote}>{t('profile.kloudCompanyNote')}</div>
      </div>
    );
  }

  return (
    <div className={styles.formRow}>
      <div className={styles.formLabel}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1"/></svg>
        {t('profile.kloudCompany')}
      </div>
      <div className={styles.changeBtnWrapper}>
        {body}
        {error && <div className={styles.inlineError}>{error}</div>}
      </div>
    </div>
  );
}
