'use client';

import React from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
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
        <Link2 size={18} className={styles.shareIcon} aria-hidden="true" />
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
          {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        </button>
      </div>
      <span className={styles.srOnly} role="status" aria-live="polite">
        {copied ? t('schedule.linkCopied') : ''}
      </span>
    </div>
  );
}
