import React, { useEffect, useState } from 'react';
import styles from '../../styles/MyProfileModal.module.css';
import { useI18n } from '../i18n';

type Step = 'view' | 'enter' | 'code';

/**
 * My Profile → Email. The address only changes after a code sent to the new address is confirmed;
 * until then the current one stays. "Verify" confirms the current address the same way.
 */
export function EmailField({
  token,
  email,
  emailVerified,
  onConfirmed,
  toast,
}: {
  token: string;
  email: string;
  emailVerified: boolean;
  onConfirmed: (email: string) => void;
  toast?: { show: (m: string) => void };
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('view');
  const [draft, setDraft] = useState('');
  const [target, setTarget] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [devCode, setDevCode] = useState('');
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendIn]);

  const reset = () => {
    setStep('view');
    setDraft('');
    setTarget('');
    setCode('');
    setError('');
    setDevCode('');
  };

  const sendCode = async (address: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/account/email/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: address }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'EMAIL_IN_USE') setError(t('profile.emailInUse'));
        else if (data.code === 'EMAIL_INVALID') setError(t('profile.emailInvalid'));
        else setError(data.error || t('profile.actionFailed'));
        if (typeof data.retryAfter === 'number') setResendIn(data.retryAfter);
        return;
      }
      setTarget(address.trim().toLowerCase());
      setDevCode(typeof data.code === 'string' ? data.code : '');
      setCode('');
      setStep('code');
      setResendIn(60);
    } catch {
      setError(t('profile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/account/email/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: target, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.code === 'EMAIL_IN_USE' ? t('profile.emailInUse') : data.error || t('profile.actionFailed'));
        return;
      }
      onConfirmed(data.email || target);
      toast?.show(t('profile.emailConfirmed'));
      reset();
    } catch {
      setError(t('profile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'view') {
    return (
      <div className={styles.formField}>
        <div className={styles.emailValue}>
          <span className={styles.emailText}>{email || t('common.none')}</span>
          {email &&
            (emailVerified ? (
              <span className={styles.verifiedBadge}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                {t('profile.verified')}
              </span>
            ) : (
              <span className={styles.notVerifiedText}>{t('profile.notVerified')}</span>
            ))}
        </div>
        {email && !emailVerified && (
          <button type="button" className={styles.btnChange} onClick={() => void sendCode(email)} disabled={busy}>
            {t('profile.verify')}
          </button>
        )}
        <button
          type="button"
          className={styles.btnChange}
          onClick={() => {
            setError('');
            setStep('enter');
          }}
        >
          {t('common.change')}
        </button>
        {error && <div className={styles.inlineError}>{error}</div>}
      </div>
    );
  }

  return (
    <div className={styles.formField}>
      <div className={styles.passwordForm}>
        {error && <div className={styles.passwordError}>{error}</div>}
        {step === 'enter' ? (
          <>
            <input
              className={styles.inputBox}
              type="email"
              autoComplete="email"
              placeholder={t('profile.newEmail')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) void sendCode(draft.trim());
              }}
              autoFocus
            />
            <div className={styles.passwordHint}>{t('profile.emailChangeNote')}</div>
            <div className={styles.passwordActions}>
              <button
                type="button"
                className={styles.btnSavePassword}
                onClick={() => void sendCode(draft.trim())}
                disabled={busy || !draft.trim()}
              >
                {busy ? t('profile.sending') : t('profile.sendCode')}
              </button>
              <button type="button" className={styles.btnCancelPassword} onClick={reset} disabled={busy}>
                {t('common.cancel')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.formNote}>{t('profile.codeSentTo', { email: target })}</div>
            <input
              className={`${styles.inputBox} ${styles.codeInput}`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder={t('profile.codePlaceholder')}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.length === 6) void confirm();
              }}
              autoFocus
            />
            {devCode && <div className={styles.passwordHint}>Dev code: {devCode}</div>}
            <div className={styles.passwordActions}>
              <button
                type="button"
                className={styles.btnSavePassword}
                onClick={() => void confirm()}
                disabled={busy || code.length !== 6}
              >
                {busy ? t('profile.confirming') : t('profile.confirm')}
              </button>
              <button type="button" className={styles.btnCancelPassword} onClick={reset} disabled={busy}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={styles.btnLink}
                onClick={() => void sendCode(target)}
                disabled={busy || resendIn > 0}
              >
                {resendIn > 0 ? t('profile.resendIn', { seconds: String(resendIn) }) : t('profile.resendCode')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
