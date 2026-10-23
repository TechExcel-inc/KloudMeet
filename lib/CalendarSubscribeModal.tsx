'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { authFetch } from '@/lib/kloudSession';
import { calendarFeedUrls } from '@/lib/calendar/links';
import { useI18n } from './i18n';
import styles from '../styles/CalendarSubscribeModal.module.css';

/** "Subscribe to your Kloud Meet calendar": manage the private webcal feed link. */
export function CalendarSubscribeModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authFetch('/api/account/calendar-feed')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (!cancelled) setToken(typeof data?.token === 'string' ? data.token : null);
      })
      .catch(() => {
        if (!cancelled) setError(t('calendar.subscribe.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mutate = useCallback(
    async (method: 'POST' | 'DELETE') => {
      setBusy(true);
      setError(null);
      setCopied(false);
      try {
        const res = await authFetch('/api/account/calendar-feed', { method });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setToken(typeof data?.token === 'string' ? data.token : null);
      } catch {
        setError(t('calendar.subscribe.saveFailed'));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const urls = token ? calendarFeedUrls(window.location.origin, token) : null;

  const copy = async () => {
    if (!urls) return;
    try {
      await navigator.clipboard.writeText(urls.https);
      setCopied(true);
    } catch {
      /* clipboard blocked: the URL stays selectable in the field */
    }
  };

  // Portal so the fixed overlay is never trapped inside the toolbar's stacking context.
  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="kloud-calendar-subscribe-title">
        <div className={styles.header}>
          <h2 id="kloud-calendar-subscribe-title" className={styles.title}>
            {t('calendar.subscribe.title')}
          </h2>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.desc}>{t('calendar.subscribe.desc')}</p>

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}

          {loading ? (
            <div className={styles.skeleton} aria-busy="true" />
          ) : urls ? (
            <>
              <label className={styles.fieldLabel} htmlFor="kloud-calendar-feed-url">
                {t('calendar.subscribe.urlLabel')}
              </label>
              <div className={styles.urlRow}>
                <input
                  id="kloud-calendar-feed-url"
                  className={styles.urlInput}
                  value={urls.https}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button type="button" className={styles.btnOutline} onClick={copy}>
                  {t('calendar.subscribe.copy')}
                </button>
              </div>
              <div className={styles.copied} aria-live="polite">
                {copied ? t('calendar.subscribe.copied') : ''}
              </div>

              <div className={styles.actions}>
                <a className={styles.btnSolid} href={urls.webcal}>
                  {t('calendar.subscribe.openApple')}
                </a>
                <a className={styles.btnOutline} href={urls.google} target="_blank" rel="noopener noreferrer">
                  {t('calendar.subscribe.addGoogle')}
                </a>
              </div>

              <p className={styles.hint}>{t('calendar.subscribe.googleHint')}</p>
              <p className={styles.warning}>{t('calendar.subscribe.private')}</p>

              <div className={styles.footer}>
                <button
                  type="button"
                  className={styles.btnText}
                  disabled={busy}
                  onClick={() => {
                    if (confirm(t('calendar.subscribe.resetConfirm'))) void mutate('POST');
                  }}
                >
                  {t('calendar.subscribe.reset')}
                </button>
                <button
                  type="button"
                  className={styles.btnDanger}
                  disabled={busy}
                  onClick={() => {
                    if (confirm(t('calendar.subscribe.turnOffConfirm'))) void mutate('DELETE');
                  }}
                >
                  {t('calendar.subscribe.turnOff')}
                </button>
              </div>
            </>
          ) : (
            <div className={styles.actions}>
              <button type="button" className={styles.btnSolid} disabled={busy} onClick={() => void mutate('POST')}>
                {t('calendar.subscribe.create')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
