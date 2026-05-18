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

export function ForgotPasswordView({
  onBack,
  onOpenHelp,
  toast,
}: {
  onBack: () => void;
  onOpenHelp: () => void;
  toast: { show: (t: string) => void };
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<'email' | 'verify' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  const sendCode = async () => {
    const addr = email.trim();
    if (!addr) { setError(t('forgot.pleaseEnterEmail')); return false; }
    setLoading(true);
    setError('');
    try {
      const isPhone = addr.startsWith('+');
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: addr, type: isPhone ? 1 : 0, intent: 'reset' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('signup.failedSendCode'));
        return false;
      }
      if (data.code) setDevCode(data.code);
      return true;
    } catch {
      setError(t('login.networkError'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleEmailNext = async () => {
    const ok = await sendCode();
    if (ok) setStep('verify');
  };

  const handleVerifyNext = () => {
    if (verificationCode.length !== 6) { setError(t('forgot.enter6Digit')); return; }
    setError('');
    setStep('reset');
  };

  const handleReset = async () => {
    setError('');
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
      const isPhone = email.trim().startsWith('+');
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [isPhone ? 'phone' : 'email']: email.trim(),
          code: verificationCode.trim(),
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('forgot.resetFailed'));
        return;
      }
      toast.show(t('forgot.resetSuccess'));
      onBack();
    } catch {
      setError(t('login.networkError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.anonWrapper}>
      <TopToolbar onBack={() => {
        if (step === 'reset') setStep('verify');
        else if (step === 'verify') { setStep('email'); setVerificationCode(''); }
        else onBack();
      }} hideAvatar />
      <div className={styles.authContainer}>
        <div className={styles.authCard}>
          <h1 className={styles.loginTitle}>{t('forgot.title')}</h1>
          {error && <div className={styles.errorBanner}>⚠ {error}</div>}

          {step === 'email' && (
            <>
              <p className={styles.signupSubtext}>{t('forgot.description')}</p>
              <label className={styles.fieldLabel}>{t('forgot.emailOrPhone')}</label>
              <input
                className={error ? styles.fieldInputError : styles.fieldInput}
                type="text"
                placeholder="you@example.com or +123"
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
                {loading ? t('signup.sendingCode') : t('common.next')}
              </button>
            </>
          )}

          {step === 'verify' && (
            <>
              <p className={styles.signupSubtext}>{t('forgot.codeSentTo', { email })}</p>
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
              {devCode && <div className={styles.devHint}>{t('forgot.devCode', { code: devCode })}</div>}
              <button
                type="button"
                className={verificationCode.length === 6 ? styles.loginSubmit : styles.loginSubmitLoading}
                disabled={verificationCode.length !== 6}
                onClick={handleVerifyNext}
              >
                {t('forgot.verifyCode')}
              </button>
            </>
          )}

          {step === 'reset' && (
            <>
              <label className={styles.fieldLabel}>{t('forgot.newPassword')}</label>
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
                <button type="button" className={styles.passwordToggle} onClick={() => setShowPassword(!showPassword)}>{showPassword ? '🙈' : '👁'}</button>
              </div>

              <label className={styles.fieldLabel}>{t('forgot.confirmNewPassword')}</label>
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
                <button type="button" className={styles.passwordToggle} onClick={() => setShowConfirm(!showConfirm)}>{showConfirm ? '🙈' : '👁'}</button>
              </div>

              <button
                type="button"
                className={loading ? styles.loginSubmitLoading : styles.loginSubmit}
                disabled={loading}
                onClick={handleReset}
                style={{ marginTop: '0.5rem' }}
              >
                {loading ? t('forgot.resetting') : t('forgot.resetPassword')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

