'use client';

import React from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import styles from '../styles/PreJoin.module.css';

/**
 * Room entry loading / load-error screen (shown before the pre-join page).
 * Colours come from the --km-* tokens, so it follows html[data-theme] like the rest of the pre-meeting pages.
 */
export function RoomEntryLoading(props: {
  error?: string | null;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const hasError = Boolean(props.error);

  // This screen can render before the room page has applied the saved theme
  // (Suspense fallback on a fresh load). Apply the stored choice so it doesn't flash.
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (root.hasAttribute('data-theme')) return;
    try {
      const stored = window.localStorage.getItem('kloud-theme');
      if (stored === 'dark' || stored === 'light') root.setAttribute('data-theme', stored);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className={styles.page} aria-busy={!hasError} aria-live="polite">
      <main className={styles.centerMain}>
        {!hasError ? (
          <div className={styles.stateCard} role="status">
            <div className={styles.spinner} aria-hidden="true" />
            <p className={styles.stateText}>{t('prejoin.loadingMeeting')}</p>
          </div>
        ) : (
          <div className={styles.stateCard} role="alert">
            <span className={`${styles.stateIcon} ${styles.stateIconDanger}`} aria-hidden="true">
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 8.8a15 15 0 0120 0M5 12.5a10 10 0 0110.8-2.1M8.5 16.1a5 5 0 016.3-.6M12 20h.01M3 3l18 18" />
              </svg>
            </span>
            <p className={styles.stateText} style={{ color: 'var(--km-text)', fontWeight: 600 }}>
              {t('prejoin.entryLoadError')}
            </p>
            {props.error ? <p className={styles.stateDetail}>{props.error}</p> : null}
            <div className={styles.stateActions}>
              {props.onRetry ? (
                <button type="button" className={styles.primaryBtn} onClick={props.onRetry}>
                  {t('prejoin.entryRetry')}
                </button>
              ) : null}
              <Link href="/" className={styles.outlineBtn}>
                {t('prejoin.returnDashboard')}
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
