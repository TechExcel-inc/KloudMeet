'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { generateRoomId } from '@/lib/client-utils';
import { ScheduleMeetingModal } from '@/lib/ScheduleMeetingModal';
import { SystemSettingsModal } from '@/lib/SystemSettingsModal';
import { MyProfileModal } from '@/lib/MyProfileModal';
import { useI18n } from '@/lib/i18n';
import { HelpModal } from '@/lib/HelpModal';
import { useDesktopAppLaunch } from '@/lib/useDesktopAppLaunch';
import { handleKloudSessionExpired } from '@/lib/handleKloudSessionExpired';
import { authFetch, authHeaders } from '@/lib/kloudSession';
import styles from '../../../styles/Home.module.css';
import type { AuthUser, SignupStep } from '../types';
import { KloudLogo } from '../components/KloudLogo';
import { TopToolbar } from '../components/TopToolbar';
import { MOCK_RECENT, MOCK_SCHEDULED } from '../mockData';

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

  return (
    <div className={styles.anonWrapper}>
      <TopToolbar onBack={onBack} onOpenHelp={onOpenHelp} hideAvatar />
      
      <div className={styles.authContainer}>
        <form className={styles.authCard} onSubmit={handleLogin}>
          <h1 className={styles.loginTitle}>{t('login.title')}</h1>

          {error && <div className={styles.errorBanner}>⚠ {error}</div>}

          <label className={styles.fieldLabel}>{t('login.emailOrLogin')}</label>
          <input
            className={error ? styles.fieldInputError : styles.fieldInput}
            type="text"
            placeholder={t('login.emailOrLogin')}
            value={identifier}
            onChange={(e) => { setIdentifier(e.target.value); setError(''); }}
            autoFocus
          />

          <label className={styles.fieldLabel}>{t('login.password')}</label>
          <div className={styles.passwordWrap}>
            <input
              className={error ? styles.fieldInputError : styles.fieldInput}
              type={showPassword ? 'text' : 'password'}
              placeholder={t('login.password')}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              style={{ paddingRight: '2.5rem' }}
            />
            <button
              type="button"
              className={styles.passwordToggle}
              onClick={() => setShowPassword(!showPassword)}
              style={{ top: 'calc(50% - 8px)' }}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>

          <div className={styles.forgotRow}>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={onForgotPassword}
            >
              {t('login.forgotPassword')}
            </button>
          </div>

          <button
            type="submit"
            className={loading ? styles.loginSubmitLoading : styles.loginSubmit}
            disabled={loading}
          >
            {loading ? (
              <>
                <svg className={styles.spinner} viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 11-6.219-8.56"></path>
                </svg>
                {t('login.signingIn')}
              </>
            ) : t('login.title')}
          </button>

          <div className={styles.ssoDivider}>{t('login.orContinueWith')}</div>
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', justifyContent: 'center' }}>
            <button type="button" className={styles.anonLink} style={{ flex: 1 }} onClick={() => window.location.href = '/api/auth/google'}>Google</button>
          </div>

          <div className={styles.registerRow}>
            <span>{t('anon.noAccount')}</span>
            <button type="button" className={styles.linkBtn} onClick={onSignUp}>
              {t('nav.signUp')}
            </button>
          </div>

        </form>
      </div>

      {/* ── Download Desktop App — hidden on mobile ── */}
      <div className={`${styles.downloadRow} ${styles.mobileHidden}`} style={{ gap: '0.75rem', flexWrap: 'wrap', margin: 'auto auto 0 auto', paddingBottom: '2rem', justifyContent: 'center', width: '100%' }}>
        <a
          href="/api/download?os=win"
          className={styles.downloadBtn}
          id="download-desktop-app-login-btn"
          title="Download Kloud Meet for Windows"
        >
          {/* Windows Logo */}
          <svg className={styles.downloadBtnIcon} viewBox="0 0 24 24" width="16" height="16" fill="#5227D3">
            <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
          </svg>
          <span className={styles.downloadBtnLabel}>Windows App</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{ opacity: 0.5, marginLeft: 2 }}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </a>

        <a
          href="/api/download?os=mac"
          className={styles.downloadBtn}
          id="download-desktop-app-mac-login-btn"
          title="Download Kloud Meet for Mac"
        >
          {/* App Store Logo */}
          <svg className={styles.downloadBtnIcon} viewBox="0 0 24 24" width="16" height="16">
            <circle cx="12" cy="12" r="12" fill="#5227D3" />
            <path d="M13.2 6.5h-2.4l-4.5 11h2.3l1.2-3.2h4.4l1.2 3.2h2.3l-4.5-11zm-2.8 6.2l1.6-4.3 1.6 4.3h-3.2z" fill="#fff" />
          </svg>
          <span className={styles.downloadBtnLabel}>macOS App</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{ opacity: 0.5, marginLeft: 2 }}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </a>
      </div>
    </div>
  );
}

