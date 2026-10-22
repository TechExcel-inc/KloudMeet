'use client';

import React, { useCallback, useId } from 'react';
import { useI18n } from '@/lib/i18n';
import styles from '../../../styles/Home.module.css';
import { KloudLogo } from './KloudLogo';
import { TopToolbar } from './TopToolbar';

/**
 * t() with an English fallback for keys added in the 2026-10 redesign that may
 * not be in the locale files yet (lib/i18n returns the key itself when missing).
 */
export function useTx() {
  const { t } = useI18n();
  return useCallback(
    (key: string, fallback: string, params?: Record<string, string | number>) => {
      const s = t(key, params);
      if (s !== key) return s;
      let text = fallback;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        });
      }
      return text;
    },
    [t],
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg className={styles.spinner} viewBox="0 0 24 24" fill="none" width={size} height={size} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 11-6.219-8.56"></path>
    </svg>
  );
}

export function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 01-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0012 22z" />
      <path fill="#FBBC05" d="M6.4 14a6 6 0 010-3.9V7.5H3.1a10 10 0 000 9z" />
      <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 003.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6z" />
    </svg>
  );
}

/** Inline error under a form (replaces the old ⚠ banner). */
export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className={styles.errorBanner} role="alert">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 8v5M12 16h.01"></path>
      </svg>
      <span>{message}</span>
    </div>
  );
}

type AuthFieldProps = {
  label: string;
  invalid?: boolean;
  hint?: React.ReactNode;
  /** Override the input class (e.g. verifyCodeInput). */
  inputClassName?: string;
  /** Adds a show/hide password button. */
  passwordToggle?: { shown: boolean; onToggle: () => void };
} & React.InputHTMLAttributes<HTMLInputElement>;

/** Outlined text field with a notched label (Google-account style). */
export function AuthField({ label, invalid, hint, inputClassName, passwordToggle, id, ...inputProps }: AuthFieldProps) {
  const tx = useTx();
  const autoId = useId();
  const inputId = id || `auth-field-${autoId}`;
  const hintId = `${inputId}-hint`;
  const baseCls = inputClassName || styles.fieldInput;
  const inputCls = invalid ? `${baseCls} ${styles.fieldInputError}` : baseCls;
  const showLabel = tx('login.showPassword', 'Show password');
  const hideLabel = tx('login.hidePassword', 'Hide password');

  return (
    <div className={styles.authFieldWrap}>
      <div
        className={`${styles.authField}${invalid ? ` ${styles.authFieldInvalid}` : ''}${passwordToggle ? ` ${styles.passwordWrap}` : ''}`}
      >
        <input
          id={inputId}
          className={inputCls}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? hintId : undefined}
          {...inputProps}
        />
        <label htmlFor={inputId} className={styles.fieldLabel}>
          {label}
        </label>
        {passwordToggle && (
          <button
            type="button"
            className={styles.passwordToggle}
            onClick={passwordToggle.onToggle}
            aria-label={passwordToggle.shown ? hideLabel : showLabel}
            aria-pressed={passwordToggle.shown}
            title={passwordToggle.shown ? hideLabel : showLabel}
          >
            {passwordToggle.shown ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 3l18 18" />
                <path d="M10.6 10.6a2 2 0 002.8 2.8" />
                <path d="M9.9 5.1A9.8 9.8 0 0112 5c5 0 8.5 4.5 9.5 7a13 13 0 01-3 4.2M6.6 6.6A13.4 13.4 0 002.5 12c1 2.5 4.5 7 9.5 7a9.6 9.6 0 004.4-1.1" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 12C3.5 9.5 7 5 12 5s8.5 4.5 9.5 7c-1 2.5-4.5 7-9.5 7s-8.5-4.5-9.5-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        )}
      </div>
      {hint && (
        <span id={hintId} className={styles.fieldHint}>
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * Page shell shared by Sign In / Sign Up / Forgot Password: slim toolbar (back,
 * help, theme, language) over a wide card — logo + big title on the left,
 * the form on the right, actions bottom-right.
 */
export function AuthShell({
  onBack,
  onOpenHelp,
  title,
  subtitle,
  stepText,
  progress,
  formProps,
  footer,
  children,
}: {
  onBack: () => void;
  onOpenHelp?: () => void;
  title: string;
  subtitle?: React.ReactNode;
  stepText?: string;
  /** 0–1; renders the top progress bar (sign-up steps). */
  progress?: number;
  /** When given, the right column is a <form> with these props. */
  formProps?: React.FormHTMLAttributes<HTMLFormElement>;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const column = formProps ? (
    <form className={styles.authForm} noValidate {...formProps}>
      {children}
    </form>
  ) : (
    <div className={styles.authForm}>{children}</div>
  );

  return (
    <div className={`${styles.anonWrapper} ${styles.authPage}`}>
      <TopToolbar onBack={onBack} onOpenHelp={onOpenHelp} hideAvatar hideLogo transparent />
      <div className={styles.authContainer}>
        <section className={styles.authCard}>
          {typeof progress === 'number' && (
            <div
              className={styles.authProgress}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              aria-valuetext={stepText}
            >
              <div className={styles.authProgressBar} style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          <div className={styles.authCardInner}>
            <div className={styles.authIntro}>
              <KloudLogo />
              <h1 className={styles.loginTitle}>{title}</h1>
              {subtitle && <p className={styles.authSub}>{subtitle}</p>}
              {stepText && <span className={styles.authStep}>{stepText}</span>}
            </div>
            {column}
          </div>
        </section>
      </div>
      {footer}
    </div>
  );
}
