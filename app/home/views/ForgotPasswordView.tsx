'use client';

import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import styles from '../../../styles/Home.module.css';
import { AuthField, AuthShell, FormError, Spinner, useTx } from '../components/ui';

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
  const tx = useTx();
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

  /* Step-aware back (toolbar back arrow + in-card Back button) */
  const handleBack = () => {
    if (step === 'reset') setStep('verify');
    else if (step === 'verify') { setStep('email'); setVerificationCode(''); }
    else onBack();
  };

  const subtitle =
    step === 'email'
      ? t('forgot.description')
      : step === 'verify'
        ? t('forgot.codeSentTo', { email })
        : tx('forgot.chooseNew', 'Choose a new password.');

  const backBtn = (
    <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnText}`} onClick={handleBack}>
      {t('common.back')}
    </button>
  );

  return (
    <AuthShell onBack={handleBack} onOpenHelp={onOpenHelp} title={t('forgot.title')} subtitle={subtitle}>
      {step === 'email' && (
        <>
          <AuthField
            label={t('forgot.emailOrPhone')}
            invalid={!!error}
            type="text"
            autoComplete="username"
            placeholder="you@example.com or +123"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleEmailNext()}
            autoFocus
          />
          <FormError message={error} />
          <div className={styles.authActions}>
            {backBtn}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSm} ${styles.btnFill} ${styles.btnFlat}`}
              disabled={loading}
              aria-busy={loading}
              onClick={handleEmailNext}
            >
              {loading && <Spinner />}
              {loading ? t('signup.sendingCode') : t('common.next')}
            </button>
          </div>
        </>
      )}

      {step === 'verify' && (
        <>
          <AuthField
            label={t('forgot.enter6Digit')}
            invalid={!!error}
            inputClassName={styles.verifyCodeInput}
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
          <FormError message={error} />
          <div className={styles.authActions}>
            {backBtn}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSm} ${styles.btnFill} ${styles.btnFlat}`}
              disabled={verificationCode.length !== 6}
              onClick={handleVerifyNext}
            >
              {t('forgot.verifyCode')}
            </button>
          </div>
        </>
      )}

      {step === 'reset' && (
        <>
          <AuthField
            label={t('forgot.newPassword')}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder={t('signup.passwordHint')}
            maxLength={30}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            passwordToggle={{ shown: showPassword, onToggle: () => setShowPassword(!showPassword) }}
            autoFocus
          />
          <AuthField
            label={t('forgot.confirmNewPassword')}
            type={showConfirm ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder={t('signup.confirmPasswordHint')}
            maxLength={30}
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
            passwordToggle={{ shown: showConfirm, onToggle: () => setShowConfirm(!showConfirm) }}
          />
          <FormError message={error} />
          <div className={styles.authActions}>
            {backBtn}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSm} ${styles.btnFill} ${styles.btnFlat}`}
              disabled={loading}
              aria-busy={loading}
              onClick={handleReset}
            >
              {loading && <Spinner />}
              {loading ? t('forgot.resetting') : t('forgot.resetPassword')}
            </button>
          </div>
        </>
      )}
    </AuthShell>
  );
}
