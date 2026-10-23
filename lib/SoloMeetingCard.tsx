'use client';

import React from 'react';
import { useRemoteParticipants } from '@livekit/components-react';
import { Check, Copy, FileText, UserPlus, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { buildInMeetingInviteClipboardText, buildInviteLinkForClipboard } from '@/lib/KloudMeetToolbar';
import styles from '@/styles/SoloMeetingCard.module.css';

/** Wait this long after joining before deciding the user is alone, so people already in the
 * room have time to appear. */
const SHOW_AFTER_MS = 1500;

/**
 * "Your meeting's ready" card for the first person in a meeting (Google Meet style): copy the
 * invite or link, or open a LiveDoc while waiting. It goes away for good once anyone joins or
 * the user closes it.
 */
export function SoloMeetingCard({
  isDesktop,
  canOpenLiveDoc,
  onOpenLiveDoc,
}: {
  /** Electron app: the copied link opens the desktop app. */
  isDesktop: boolean;
  /** Only people who can switch views get the LiveDoc shortcut. */
  canOpenLiveDoc: boolean;
  onOpenLiveDoc: () => void;
}) {
  const { t } = useI18n();
  const remotes = useRemoteParticipants();
  const [settled, setSettled] = React.useState(false);
  const [closed, setClosed] = React.useState(false);
  const [copied, setCopied] = React.useState<'invite' | 'link' | null>(null);
  const copiedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const id = setTimeout(() => setSettled(true), SHOW_AFTER_MS);
    return () => clearTimeout(id);
  }, []);

  React.useEffect(() => {
    if (remotes.length > 0) setClosed(true);
  }, [remotes.length]);

  React.useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  if (!settled || closed || remotes.length > 0) return null;

  const link = buildInviteLinkForClipboard(isDesktop);
  const copy = (kind: 'invite' | 'link') => {
    const text = kind === 'invite' ? buildInMeetingInviteClipboardText(isDesktop) : link;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(kind);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 2000);
  };

  return (
    <section className={styles.card} aria-labelledby="km-solo-title">
      <div className={styles.head}>
        <h2 id="km-solo-title" className={styles.title}>{t('meeting.solo.title')}</h2>
        <button type="button" className={styles.close} onClick={() => setClosed(true)} aria-label={t('common.close')} title={t('common.close')}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <button type="button" className={styles.primary} onClick={() => copy('invite')}>
        {copied === 'invite' ? <Check size={18} aria-hidden="true" /> : <UserPlus size={18} aria-hidden="true" />}
        {copied === 'invite' ? t('meeting.solo.inviteCopied') : t('meeting.solo.copyInvite')}
      </button>
      <p className={styles.text}>{t('meeting.solo.shareLink')}</p>
      <div className={styles.linkRow}>
        <span className={styles.link}>{link.replace(/^https?:\/\//, '')}</span>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => copy('link')}
          aria-label={t('meeting.solo.copyLink')}
          title={copied === 'link' ? t('meeting.solo.linkCopied') : t('meeting.solo.copyLink')}
        >
          {copied === 'link' ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        </button>
      </div>
      <span className={styles.srOnly} role="status">
        {copied === 'invite' ? t('meeting.solo.inviteCopied') : copied === 'link' ? t('meeting.solo.linkCopied') : ''}
      </span>

      {canOpenLiveDoc && (
        <>
          <div className={styles.divider} />
          <button
            type="button"
            className={styles.docRow}
            onClick={() => {
              setClosed(true);
              onOpenLiveDoc();
            }}
          >
            <span className={styles.docIcon} aria-hidden="true">
              <FileText size={18} />
            </span>
            <span className={styles.docText}>
              <span className={styles.docTitle}>{t('meeting.solo.openLiveDoc')}</span>
              <span className={styles.docHint}>{t('meeting.solo.openLiveDocHint')}</span>
            </span>
          </button>
        </>
      )}
    </section>
  );
}
