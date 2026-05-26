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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#f8f9fb',
        fontFamily: 'Inter, sans-serif',
        color: '#6b7280',
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
              border: '3px solid #e5e7eb',
              borderTopColor: '#7c3aed',
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
          <p style={{ margin: 0, color: '#374151', maxWidth: 420 }}>
            {t('prejoin.entryLoadError')}
          </p>
          {props.error ? (
            <p
              style={{
                margin: 0,
                fontSize: '0.85rem',
                color: '#9ca3af',
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
                  background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
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
                background: '#fff',
                color: '#4b5563',
                border: '1px solid #d1d5db',
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
