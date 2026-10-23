'use client';

import React, { useCallback, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import styles from '../../../styles/Home.module.css';
import type { AuthUser, SignupStep } from '../types';
import { AuthField, AuthShell, FormError, GoogleIcon, Spinner, useTx } from '../components/ui';
import { googleSignInHref } from '@/lib/googleSignInHref';
import { isValidPassword } from '@/lib/authPolicy';
import { verifyEmailCode } from '@/lib/verifyEmailCode';

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
  const tx = useTx();
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

  /* ── Step progress (progress bar + "Step N of 3") ── */
  const stepIndex = step === 'email' ? 0 : step === 'verify' ? 1 : 2;
  const stepText = tx('signup.stepOf', 'Step {n} of {total}', { n: stepIndex + 1, total: 3 });

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
  const handleVerifyNext = async () => {
    if (verificationCode.length !== 6) {
      setError(t('signup.enterCode'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      const problem = await verifyEmailCode(email.trim(), verificationCode, 'signup', t('signup.signupFailed'));
      if (problem) {
        setError(problem);
        return;
      }
      setStep('create');
    } catch {
      setError(t('login.networkError'));
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 3: Create account ── */
  const handleCreate = async () => {
    setError('');
    const usernameRe = /^(?!\d+$)[a-zA-Z0-9]{2,20}$/;
    if (!usernameRe.test(username)) {
      setError(t('signup.loginNameError'));
      return;
    }
    if (!isValidPassword(password)) {
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
        // The code expired or was burned meanwhile: send the user back to get a new one.
        if (data.code === 'BAD_CODE') {
          setVerificationCode('');
          setStep('verify');
        }
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

  const subtitle =
    step === 'email'
      ? tx('signup.subtitle', 'Create your Kloud account to host meetings and keep replays.')
      : step === 'verify'
        ? t('signup.codeSentTo', { email })
        : t('signup.creatingFor', { email });

  const primaryCls = `${styles.btn} ${styles.btnSm} ${styles.btnFill} ${styles.btnFlat}`;
  const textCls = `${styles.btn} ${styles.btnSm} ${styles.btnText}`;

  return (
    <AuthShell
      onBack={handleBack}
      onOpenHelp={onOpenHelp}
      title={step === 'verify' ? t('signup.verifyEmail') : t('signup.title')}
      subtitle={subtitle}
      stepText={stepText}
      progress={(stepIndex + 1) / 3}
    >
      {/* ── Step 1: Email ── */}
      {step === 'email' && (
        <>
          <AuthField
            label={t('signup.emailAddress')}
            invalid={!!error}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleEmailNext()}
            autoFocus
          />
          <FormError message={error} />

          <div className={styles.ssoDivider}>{t('signup.orSignUpWith')}</div>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnOutline} ${styles.googleBtn}`}
            onClick={() => window.location.href = googleSignInHref()}
          >
            <GoogleIcon />
            Google
          </button>

          <div className={styles.authActions}>
            <span className={styles.authActionsNote}>{t('signup.alreadyHaveAccount')}</span>
            <button type="button" className={textCls} onClick={onBack}>
              {t('nav.signIn')}
            </button>
            <button
              type="button"
              className={primaryCls}
              disabled={loading}
              aria-busy={loading}
              onClick={handleEmailNext}
            >
              {loading ? (
                <>
                  <Spinner />
                  {t('signup.sendingCode')}
                </>
              ) : t('common.next')}
            </button>
          </div>
        </>
      )}

      {/* ── Step 2: Verify ── */}
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

          <div className={styles.resendRow} aria-live="polite">
            {countdown > 0 ? (
              <span>{t('signup.resendIn', { seconds: String(countdown) })}</span>
            ) : (
              <button type="button" className={styles.linkBtn} onClick={() => sendCode()}>
                {t('signup.resendCode')}
              </button>
            )}
          </div>

          {devCode && (
           <div className={styles.devHint}>{t('signup.devCode', { code: devCode })}</div>
          )}

          <FormError message={error} />

          <div className={styles.authActions}>
            <button type="button" className={textCls} onClick={handleBack}>
              {t('common.back')}
            </button>
            <button
              type="button"
              className={primaryCls}
              disabled={verificationCode.length !== 6 || loading}
              aria-busy={loading}
              onClick={handleVerifyNext}
            >
              {loading && <Spinner />}
              {t('signup.continue')}
            </button>
          </div>
        </>
      )}

      {/* ── Step 3: Create account ── */}
      {step === 'create' && (
        <>
          <AuthField
            label={t('signup.loginName')}
            type="text"
            autoComplete="username"
            placeholder={t('signup.loginNameHint')}
            maxLength={20}
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError(''); }}
            hint={t('signup.cannotAllDigits')}
            autoFocus
          />

          <AuthField
            label={t('signup.passwordLabel')}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder={t('signup.passwordHint')}
            maxLength={64}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            passwordToggle={{ shown: showPassword, onToggle: () => setShowPassword(!showPassword) }}
          />

          <AuthField
            label={t('signup.confirmPassword')}
            type={showConfirm ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder={t('signup.confirmPasswordHint')}
            maxLength={64}
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
            passwordToggle={{ shown: showConfirm, onToggle: () => setShowConfirm(!showConfirm) }}
          />

          <FormError message={error} />

          <p className={styles.termsNotice}>{t('signup.termsNotice')}</p>

          <div className={styles.authActions}>
            <button type="button" className={textCls} onClick={handleBack}>
              {t('common.back')}
            </button>
            <button
              type="button"
              className={primaryCls}
              disabled={loading}
              aria-busy={loading}
              onClick={handleCreate}
            >
              {loading ? (
                <>
                  <Spinner />
                  {t('signup.creatingAccount')}
                </>
              ) : t('signup.title')}
            </button>
          </div>
        </>
      )}
    </AuthShell>
  );
}
