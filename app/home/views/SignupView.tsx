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

export function SignupView({
  onBack,
  onSignupSuccess,
  onOpenHelp,
  toast,
}: {
  onBack: () => void;
  onSignupSuccess: (user: AuthUser) => void;
  onOpenHelp: () => void;
  toast: { show: (t: string) => void };
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<SignupStep>('email');
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);

  /* ── Step indicator ── */
  const stepIndex = step === 'email' ? 0 : step === 'verify' ? 1 : 2;
  const StepIndicator = () => (
    <div className={styles.signupSteps}>
      {[0, 1, 2].map((i) => (
        <React.Fragment key={i}>
          <div
            className={
              i < stepIndex
                ? styles.signupStepDotDone
                : i === stepIndex
                  ? styles.signupStepDotActive
                  : styles.signupStepDot
            }
          />
          {i < 2 && (
            <div className={i < stepIndex ? styles.signupStepLineDone : styles.signupStepLine} />
          )}
        </React.Fragment>
      ))}
    </div>
  );

  /* ── Start countdown timer ── */
  const startCountdown = useCallback(() => {
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(timer); return 0; }
        return c - 1;
      });
    }, 1000);
  }, []);

  /* ── Send verification code ── */
  const sendCode = async (target?: string) => {
    const addr = (target || email).trim();
    if (!addr) { setError(t('signup.pleaseEnterEmail')); return false; }
    setLoading(true);
    setError('');
    try {
      const isPhone = addr.startsWith('+');
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: addr, type: isPhone ? 1 : 0, intent: 'signup' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('signup.failedSendCode'));
        return false;
      }
      if (data.code) setDevCode(data.code);
      startCountdown();
      return true;
    } catch {
      setError(t('login.networkError'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 1: Email ── */
  const handleEmailNext = async () => {
    const tgt = email.trim();
    if (!tgt) { setError(t('signup.pleaseEnterEmail')); return; }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(tgt)) { setError(t('signup.invalidEmail')); return; }
    const ok = await sendCode(tgt);
    if (ok) setStep('verify');
  };

  /* ── Step 2: Verify ── */
  const handleVerifyNext = () => {
    if (verificationCode.length !== 6) {
      setError(t('signup.enterCode'));
      return;
    }
    setError('');
    setStep('create');
  };

  /* ── Step 3: Create account ── */
  const handleCreate = async () => {
    setError('');
    const usernameRe = /^(?!\d+$)[a-zA-Z0-9]{2,20}$/;
    if (!usernameRe.test(username)) {
      setError(t('signup.loginNameError'));
      return;
    }
    const passwordRe = /^(?![0-9]+$)(?![a-zA-Z]+$)[0-9A-Za-z]{8,30}$/;
    if (!passwordRe.test(password)) {
      setError(t('signup.passwordError'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('signup.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          username: username.trim(),
          password,
          verificationCode: verificationCode.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('signup.signupFailed'));
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
      onSignupSuccess(user);
    } catch {
      setError(t('login.networkError'));
    } finally {
      setLoading(false);
    }
  };

  /* ── Back navigation ── */
  const handleBack = () => {
    setError('');
    if (step === 'create') setStep('verify');
    else if (step === 'verify') { setStep('email'); setVerificationCode(''); }
    else onBack();
  };

  return (
    <div className={styles.anonWrapper}>
      <TopToolbar onBack={handleBack} onOpenHelp={onOpenHelp} hideAvatar />
      
      <div className={styles.authContainer}>
        <div className={styles.authCard}>
          <h1 className={styles.loginTitle}>
            {step === 'verify' ? t('signup.verifyEmail') : t('signup.title')}
          </h1>

          <StepIndicator />

          {error && <div className={styles.errorBanner}>⚠ {error}</div>}

          {/* ── Step 1: Email ── */}
          {step === 'email' && (
            <>
              <label className={styles.fieldLabel}>{t('signup.emailAddress')}</label>
              <input
                className={error ? styles.fieldInputError : styles.fieldInput}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleEmailNext()}
                autoFocus
              />

              <button
                type="button"
                className={loading ? styles.loginSubmitLoading : styles.loginSubmit}
                disabled={loading}
                onClick={handleEmailNext}
              >
                {loading ? (
                  <>
                    <svg className={styles.spinner} viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 11-6.219-8.56"></path>
                    </svg>
                    {t('signup.sendingCode')}
                  </>
                ) : t('common.next')}
              </button>

              <div className={styles.ssoDivider}>{t('signup.orSignUpWith')}</div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                <button type="button" className={styles.anonLink} style={{ flex: 1 }} onClick={() => window.location.href = '/api/auth/google'}>Google</button>
              </div>

              <div className={styles.registerRow} style={{ marginTop: '1rem' }}>
                <span>{t('signup.alreadyHaveAccount')}</span>
                <button type="button" className={styles.linkBtn} onClick={onBack}>
                  {t('nav.signIn')}
                </button>
              </div>
            </>
          )}

          {/* ── Step 2: Verify ── */}
          {step === 'verify' && (
            <>
              <div className={styles.verifyIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="28" height="28">
                  <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className={styles.signupSubtext}>
                {t('signup.codeSentTo', { email })}
              </p>

              <input
                className={styles.verifyCodeInput}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                value={verificationCode}
                onChange={(e) => {
                  setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyNext()}
                autoFocus
              />

              {devCode && (
               <div className={styles.devHint}>{t('signup.devCode', { code: devCode })}</div>
              )}

              <button
                type="button"
                className={verificationCode.length === 6 ? styles.loginSubmit : styles.loginSubmitLoading}
                disabled={verificationCode.length !== 6}
                onClick={handleVerifyNext}
              >
                {t('signup.continue')}
              </button>

              <div className={styles.resendRow}>
                {countdown > 0 ? (
                  <span>{t('signup.resendIn', { seconds: String(countdown) })}</span>
                ) : (
                  <button type="button" className={styles.linkBtn} onClick={() => sendCode()}>
                    {t('signup.resendCode')}
                  </button>
                )}
              </div>
            </>
          )}

          {/* ── Step 3: Create account ── */}
          {step === 'create' && (
            <>
              <p className={styles.signupSubtext}>
                {t('signup.creatingFor', { email })}
              </p>

              <label className={styles.fieldLabel}>{t('signup.loginName')}</label>
              <input
                className={styles.fieldInput}
                type="text"
                placeholder={t('signup.loginNameHint')}
                maxLength={20}
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(''); }}
                autoFocus
              />
              <p className={styles.fieldHint}>{t('signup.cannotAllDigits')}</p>

              <label className={styles.fieldLabel}>{t('signup.passwordLabel')}</label>
              <div className={styles.passwordWrap}>
                <input
                  className={styles.fieldInput}
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('signup.passwordHint')}
                  maxLength={30}
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

              <label className={styles.fieldLabel}>{t('signup.confirmPassword')}</label>
              <div className={styles.passwordWrap}>
                <input
                  className={styles.fieldInput}
                  type={showConfirm ? 'text' : 'password'}
                  placeholder={t('signup.confirmPasswordHint')}
                  maxLength={30}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                  style={{ paddingRight: '2.5rem' }}
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowConfirm(!showConfirm)}
                  style={{ top: 'calc(50% - 8px)' }}
                >
                  {showConfirm ? '🙈' : '👁'}
                </button>
              </div>

              <button
                type="button"
                className={loading ? styles.loginSubmitLoading : styles.loginSubmit}
                disabled={loading}
                onClick={handleCreate}
                style={{ marginTop: '0.5rem' }}
              >
                {loading ? (
                  <>
                    <svg className={styles.spinner} viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 11-6.219-8.56"></path>
                    </svg>
                    {t('signup.creatingAccount')}
                  </>
                ) : t('signup.title')}
              </button>

              <p style={{ fontSize: '0.78rem', color: '#9ca3af', textAlign: 'center', marginTop: '0.75rem' }}>
                {t('signup.termsNotice')}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

