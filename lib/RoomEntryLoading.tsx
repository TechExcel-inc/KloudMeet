'use client';

import React from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

export function RoomEntryLoading(props: {
  error?: string | null;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const hasError = Boolean(props.error);
  const [isDark, setIsDark] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const readTheme = () => {
      const attrTheme = document.documentElement.getAttribute('data-theme');
      if (attrTheme === 'dark') {
        setIsDark(true);
        return;
      }
      if (attrTheme === 'light') {
        setIsDark(false);
        return;
      }
      const storedTheme = window.localStorage.getItem('kloud-theme');
      if (storedTheme === 'dark') {
        setIsDark(true);
        return;
      }
      if (storedTheme === 'light') {
        setIsDark(false);
        return;
      }
      setIsDark(true);
    };

    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  const palette = isDark
    ? {
        pageBg: 'linear-gradient(180deg, #0f172a 0%, #111827 46%, #0b1120 100%)',
        text: '#94a3b8',
        heading: '#e2e8f0',
        subtle: '#64748b',
        spinnerBase: '#334155',
        spinnerAccent: '#818cf8',
        retryBg: 'linear-gradient(135deg, #6d28d9, #4f46e5)',
        backBg: '#0f172a',
        backText: '#cbd5e1',
        backBorder: '#334155',
      }
    : {
        pageBg: '#f8f9fb',
        text: '#6b7280',
        heading: '#374151',
        subtle: '#9ca3af',
        spinnerBase: '#e5e7eb',
        spinnerAccent: '#7c3aed',
        retryBg: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
        backBg: '#fff',
        backText: '#4b5563',
        backBorder: '#d1d5db',
      };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: palette.pageBg,
        fontFamily: 'Inter, sans-serif',
        color: palette.text,
        fontSize: '0.95rem',
        padding: '1.5rem',
        textAlign: 'center',
        gap: '1rem',
      }}
      aria-busy={!hasError}
      aria-live="polite"
    >
      {!hasError ? (
        <>
          <div
            style={{
              width: 36,
              height: 36,
              border: `3px solid ${palette.spinnerBase}`,
              borderTopColor: palette.spinnerAccent,
              borderRadius: '50%',
              animation: 'kloud-entry-spin 0.8s linear infinite',
            }}
          />
          <p style={{ margin: 0 }}>{t('prejoin.loadingMeeting')}</p>
          <style>{`
            @keyframes kloud-entry-spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </>
      ) : (
        <>
          <p style={{ margin: 0, color: palette.heading, maxWidth: 420 }}>
            {t('prejoin.entryLoadError')}
          </p>
          {props.error ? (
            <p
              style={{
                margin: 0,
                fontSize: '0.85rem',
                color: palette.subtle,
                maxWidth: 480,
                wordBreak: 'break-word',
              }}
            >
              {props.error}
            </p>
          ) : null}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            {props.onRetry ? (
              <button
                type="button"
                onClick={props.onRetry}
                style={{
                  padding: '0.65rem 1.25rem',
                  background: palette.retryBg,
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t('prejoin.entryRetry')}
              </button>
            ) : null}
            <Link
              href="/"
              style={{
                padding: '0.65rem 1.25rem',
                background: palette.backBg,
                color: palette.backText,
                border: `1px solid ${palette.backBorder}`,
                borderRadius: '8px',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              {t('prejoin.returnDashboard')}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
