'use client';

import React from 'react';
import styles from '../styles/PreJoin.module.css';
import { useI18n } from './i18n';

export function PrejoinMeetingShareLink({
  active,
  roomName,
}: {
  active: boolean;
  roomName?: string;
}) {
  const { t } = useI18n();
  const [meetingUrl, setMeetingUrl] = React.useState('');
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!active) {
      setMeetingUrl('');
      return;
    }

    try {
      const current = new URL(window.location.href);
      if (roomName && roomName.trim()) {
        current.pathname = `/rooms/${encodeURIComponent(roomName.trim())}`;
      }
      current.search = '';
      current.hash = '';
      setMeetingUrl(current.toString());
    } catch {
      setMeetingUrl('');
    }
  }, [active, roomName]);

  const handleCopy = async () => {
    if (!meetingUrl) return;
    try {
      await navigator.clipboard.writeText(meetingUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  if (!active || !meetingUrl) return null;

  const copyLabel = t('schedule.copyLink');

  return (
    <div className={styles.share}>
      <span className={styles.shareLabel}>
        {t('prejoin.shareMeetingUrl')}
      </span>
      <div className={styles.shareBox}>
        <span className={styles.shareUrl} title={meetingUrl}>
          {meetingUrl}
        </span>
        <button
          type="button"
          className={`${styles.iconBtn} ${styles.copyBtn}${copied ? ` ${styles.copyBtnDone}` : ''}`}
          onClick={() => void handleCopy()}
          title={copyLabel}
          aria-label={copyLabel}
        >
          {copied ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 012-2h10" />
            </svg>
          )}
        </button>
      </div>
      <span className={styles.srOnly} role="status" aria-live="polite">
        {copied ? t('schedule.linkCopied') : ''}
      </span>
    </div>
  );
}
