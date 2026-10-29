'use client';

import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import styles from '../../../styles/Home.module.css';
import type { AuthUser } from '../types';
import { AuthField, AuthShell, FormError, GoogleIcon, KloudIcon, Spinner, useTx } from '../components/ui';
import { MAC_APP_AVAILABLE } from '@/lib/desktopRelease';
import { KLOUD_SIGN_IN_ENABLED, googleSignInHref, googleSignInOpensBrowser, kloudSignInHref } from '@/lib/googleSignInHref';

export function LoginView({
  onBack,
  onLoginSuccess,
  onSignUp,
  onForgotPassword,
  onOpenHelp,
  toast,
}: {
  onBack: () => void;
  onLoginSuccess: (user: AuthUser) => void;
  onSignUp: () => void;
  onForgotPassword: () => void;
  onOpenHelp: () => void;
  toast: { show: (t: string) => void };
}) {
  const { t } = useI18n();
  const tx = useTx();
  const [googleInBrowser, setGoogleInBrowser] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const id = identifier.trim();
    if (!id) { setError(t('login.pleaseEnterEmail')); return; }
    if (!password) { setError(t('login.pleaseEnterPassword')); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: id, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('login.loginFailed'));
        return;
      }
      const user: AuthUser = {
        id: data.user.id,
        username: data.user.username,
        displayName: data.user.fullName || data.user.username,
        email: data.user.email,
        avatarUrl: data.user.avatarUrl,
        token: data.token,
      };
      localStorage.setItem('kloudUser', JSON.stringify(user));
      onLoginSuccess(user);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Download Desktop App — hidden on mobile ── */
  const downloadFooter = (
    <div className={`${styles.downloadRow} ${styles.downloadRowCentered} ${styles.mobileHidden}`}>
      <a
        href="/api/download?os=win"
        className={styles.downloadBtn}
        id="download-desktop-app-login-btn"
        title="Download Kloud Meet for Windows"
      >
        <svg className={styles.downloadBtnIcon} viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
          <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
        </svg>
        <span className={styles.downloadBtnLabel}>Windows App</span>
        <svg className={styles.downloadBtnArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" aria-hidden="true">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </a>

      {MAC_APP_AVAILABLE && (
      <a
        href="/api/download?os=mac"
        className={styles.downloadBtn}
        id="download-desktop-app-mac-login-btn"
        title="Download Kloud Meet for Mac"
      >
        <svg className={styles.downloadBtnIcon} viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <circle cx="12" cy="12" r="12" fill="currentColor" />
          <path d="M13.2 6.5h-2.4l-4.5 11h2.3l1.2-3.2h4.4l1.2 3.2h2.3l-4.5-11zm-2.8 6.2l1.6-4.3 1.6 4.3h-3.2z" fill="#fff" />
        </svg>
        <span className={styles.downloadBtnLabel}>macOS App</span>
        <svg className={styles.downloadBtnArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" aria-hidden="true">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </a>
      )}
    </div>
  );

  const googleButton = (
    <button
      type="button"
      className={`${styles.btn} ${styles.btnOutline} ${styles.googleBtn}`}
      onClick={() => {
        if (googleSignInOpensBrowser()) setGoogleInBrowser(true);
        window.location.href = googleSignInHref();
      }}
    >
      <GoogleIcon />
      Google
    </button>
  );

  return (
    <AuthShell
      onBack={onBack}
      onOpenHelp={onOpenHelp}
      title={t('login.title')}
      subtitle={tx('login.subtitle', 'to continue to Kloud Meet')}
      formProps={{ onSubmit: handleLogin }}
      footer={downloadFooter}
    >
      <AuthField
        label={t('login.emailOrLogin')}
        invalid={!!error}
        type="text"
        autoComplete="username"
        value={identifier}
        onChange={(e) => { setIdentifier(e.target.value); setError(''); }}
        autoFocus
      />

      <AuthField
        label={t('login.password')}
        invalid={!!error}
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        value={password}
        onChange={(e) => { setPassword(e.target.value); setError(''); }}
        passwordToggle={{ shown: showPassword, onToggle: () => setShowPassword(!showPassword) }}
      />

      <FormError message={error} />

      <div className={styles.forgotRow}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnSm} ${styles.btnText}`}
          onClick={onForgotPassword}
        >
          {t('login.forgotPassword')}
        </button>
      </div>

      <div className={styles.ssoDivider}>{t('login.orContinueWith')}</div>
      {KLOUD_SIGN_IN_ENABLED ? (
        <div className={styles.ssoRow}>
          {googleButton}
          <button
            type="button"
            className={`${styles.btn} ${styles.btnOutline} ${styles.googleBtn}`}
            onClick={() => {
              window.location.href = kloudSignInHref();
            }}
          >
            <KloudIcon />
            Kloud
          </button>
        </div>
      ) : (
        googleButton
      )}
      {googleInBrowser && <p className={styles.authSub} role="status">{t('login.googleInBrowser')}</p>}

      <div className={styles.authActions}>
        <span className={styles.authActionsNote}>{t('anon.noAccount')}</span>
        <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnText}`} onClick={onSignUp}>
          {t('nav.signUp')}
        </button>
        <button
          type="submit"
          className={`${styles.btn} ${styles.btnSm} ${styles.btnFill} ${styles.btnFlat}`}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? (
            <>
              <Spinner />
              {t('login.signingIn')}
            </>
          ) : t('login.title')}
        </button>
      </div>
    </AuthShell>
  );
}
