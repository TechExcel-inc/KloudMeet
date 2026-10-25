'use client';

import React from 'react';
import { Check, ChevronDown, Copy, Link2 } from 'lucide-react';
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
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

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

  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

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

  const handleCopyInvite = async () => {
    setMenuOpen(false);
    if (!meetingUrl) return;
    const inviteText = `${t('prejoin.inviteText')}\n${meetingUrl}`;
    try {
      await navigator.clipboard.writeText(inviteText);
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
      <span className={styles.shareLabel}>{t('prejoin.shareMeetingUrl')}</span>
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
        <div className={styles.shareMenuWrap} ref={menuRef}>
          <button
            type="button"
            className={styles.copyMenuBtn}
            onClick={() => setMenuOpen((v) => !v)}
            title={t('prejoin.copyInvite')}
            aria-label={t('prejoin.copyInvite')}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className={styles.shareMenu} role="menu">
              <button
                type="button"
                className={styles.shareMenuItem}
                role="menuitem"
                onClick={() => void handleCopyInvite()}
              >
                <Copy size={16} aria-hidden="true" />
                {t('prejoin.copyInvite')}
              </button>
            </div>
          )}
        </div>
      </div>
      <span className={styles.srOnly} role="status" aria-live="polite">
        {copied ? t('schedule.linkCopied') : ''}
      </span>
    </div>
  );
}
