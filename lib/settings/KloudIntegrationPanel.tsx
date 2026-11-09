import React, { useEffect, useState } from 'react';
import styles from '../../styles/SystemSettingsModal.module.css';
import { useI18n } from '../i18n';
import { getKloudSessionBearer } from '../kloudSession';
import { useKloudCompany } from '../profile/useKloudCompany';

/** Set before the Kloud sign-in round trip so the home page reopens Account Settings on this tab. */
export const REOPEN_ACCOUNT_SETTINGS_KEY = 'simeet.reopenAccountSettings';

type Methods = { kloud: { connected: boolean } };

/**
 * Account Settings → Kloud Integration.
 * 1. Connect Kloud with a login that is owner or admin of the Kloud company.
 * 2. Choose that company and link it: SiMeet becomes a subsystem of it (today: a SiMeet team
 *    linked to the company, whose members join it from Kloud).
 */
export function KloudIntegrationPanel({
  onNotice,
  inMeeting = false,
}: {
  onNotice?: (message: string) => void;
  /** In a meeting the Kloud sign-in would leave it: say to connect from the home page instead. */
  inMeeting?: boolean;
}) {
  const { t } = useI18n();
  const [token] = useState(() => getKloudSessionBearer());
  const [methods, setMethods] = useState<Methods | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const kloud = useKloudCompany(methods?.kloud.connected ? token : null, onNotice);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch('/api/account/sign-in-methods', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setMethods(data as Methods);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  const connect = async () => {
    if (!token) return;
    setConnecting(true);
    setConnectError('');
    try {
      const res = await fetch('/api/account/sign-in-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider: 'kloud', action: 'connect' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.url !== 'string') {
        setConnectError(data.error || t('profile.actionFailed'));
        return;
      }
      try {
        sessionStorage.setItem(REOPEN_ACCOUNT_SETTINGS_KEY, 'kloud');
      } catch {
        // Without storage the person reopens Account Settings themselves.
      }
      window.location.href = data.url;
    } catch {
      setConnectError(t('profile.networkError'));
    } finally {
      setConnecting(false);
    }
  };

  const signInAgain = () => {
    try {
      sessionStorage.setItem(REOPEN_ACCOUNT_SETTINGS_KEY, 'kloud');
    } catch {
      // ignore
    }
    window.location.href = '/api/auth/kloud';
  };

  const connected = methods?.kloud.connected === true;
  const { state, choice, setChoice, busy, error, send, linkedName } = kloud;

  let companyBody: React.ReactNode = null;
  if (!connected) {
    companyBody = <p className={styles.helperText}>{t('settings.kloudConnectFirst')}</p>;
  } else if (!state) {
    companyBody = <p className={styles.helperText}>{t('settings.loadingSettings')}</p>;
  } else if (linkedName) {
    companyBody = (
      <>
        <div className={styles.kloudLinkedCard}>
          <div className={styles.kloudLinkedTitle}>{t('settings.kloudSubsystemName')}</div>
          <div className={styles.kloudLinkedMeta}>{t('settings.kloudSubsystemOf', { company: linkedName })}</div>
        </div>
        <p className={styles.helperText}>{t('settings.kloudMembersNote', { company: linkedName })}</p>
        {confirmUnlink ? (
          <div className={styles.kloudActions}>
            <span className={styles.helperText} style={{ margin: 0 }}>
              {t('settings.kloudUnlinkQuestion', { company: linkedName })}
            </span>
            <button
              type="button"
              className={styles.btnDanger}
              disabled={busy}
              onClick={() => void send('DELETE').then((ok) => ok && setConfirmUnlink(false))}
            >
              {t('profile.unlink')}
            </button>
            <button type="button" className={styles.btnOutline} onClick={() => setConfirmUnlink(false)}>
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <div className={styles.kloudActions}>
            <button type="button" className={styles.btnOutline} onClick={() => setConfirmUnlink(true)}>
              {t('profile.unlink')}
            </button>
          </div>
        )}
      </>
    );
  } else if (!state.canLink) {
    companyBody = <p className={styles.helperText}>{t('profile.onlyOwnerCanLink')}</p>;
  } else if (state.candidates === null) {
    companyBody = (
      <div className={styles.kloudActions}>
        <span className={styles.helperText} style={{ margin: 0 }}>
          {t('profile.kloudCompaniesStale')}
        </span>
        {!inMeeting && (
          <button type="button" className={styles.btnOutline} onClick={signInAgain}>
            {t('profile.signInWithKloudAgain')}
          </button>
        )}
      </div>
    );
  } else if (state.candidates.length === 0) {
    companyBody = <p className={styles.helperText}>{t('profile.noKloudAdminCompanies')}</p>;
  } else {
    companyBody = (
      <>
        <div className={styles.kloudActions}>
          <select
            className={styles.input}
            style={{ flex: 1 }}
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
          <button type="button" className={styles.btnSolid} disabled={busy || !choice} onClick={() => void send('POST')}>
            {t('profile.link')}
          </button>
        </div>
        <p className={styles.helperText}>{t('settings.kloudLinkNote')}</p>
      </>
    );
  }

  return (
    <div className={styles.formGroup}>
      <h3 className={styles.sectionTitle}>{t('settings.kloudIntegration')}</h3>
      <p className={styles.helperText} style={{ marginBottom: '1.5rem' }}>
        {t('settings.kloudIntro')}
      </p>

      <div className={styles.kloudStep}>
        <div className={styles.kloudStepNum}>1</div>
        <div className={styles.kloudStepBody}>
          <div className={styles.label}>{t('settings.kloudStepConnect')}</div>
          {!token ? (
            <p className={styles.helperText}>{t('settings.kloudSignInFirst')}</p>
          ) : !methods ? (
            <p className={styles.helperText}>{t('settings.loadingSettings')}</p>
          ) : connected ? (
            <span className={styles.kloudConnected}>✓ {t('profile.connected')}</span>
          ) : inMeeting ? (
            <p className={styles.helperText}>{t('settings.kloudConnectFromHome')}</p>
          ) : (
            <>
              <div className={styles.kloudActions}>
                <button type="button" className={styles.btnSolid} disabled={connecting} onClick={() => void connect()}>
                  {t('settings.kloudConnect')}
                </button>
              </div>
              <p className={styles.helperText}>{t('settings.kloudConnectNote')}</p>
            </>
          )}
          {connectError && <p className={styles.errorText}>{connectError}</p>}
        </div>
      </div>

      <div className={styles.kloudStep}>
        <div className={styles.kloudStepNum}>2</div>
        <div className={styles.kloudStepBody}>
          <div className={styles.label}>{t('settings.kloudStepCompany')}</div>
          {companyBody}
          {error && <p className={styles.errorText}>{error}</p>}
        </div>
      </div>
    </div>
  );
}
