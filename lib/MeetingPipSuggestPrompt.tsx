'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n';
import styles from '@/styles/MeetingPipSuggestPrompt.module.css';

const HIDE_MS = 20000;

export interface MeetingPipSuggestPromptProps {
  visible: boolean;
  onEnable: () => void;
  onDismiss: () => void;
}

export function MeetingPipSuggestPrompt({
  visible,
  onEnable,
  onDismiss,
}: MeetingPipSuggestPromptProps) {
  const { t } = useI18n();
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(() => onDismissRef.current(), HIDE_MS);
    return () => window.clearTimeout(id);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className={styles.root} role="status" aria-live="polite">
      <div className={styles.card}>
        <div className={styles.iconWrap} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" className={styles.icon}>
            <rect
              x="3.5"
              y="4.5"
              width="17"
              height="13"
              rx="2.5"
              stroke="currentColor"
              strokeWidth="1.7"
            />
            <rect x="12" y="10" width="7" height="6" rx="1.4" fill="currentColor" />
          </svg>
        </div>
        <p className={styles.message}>{t('meeting.pipSuggestMessage')}</p>
        <button type="button" className={styles.enableBtn} onClick={onEnable}>
          {t('meeting.pipSuggestEnable')}
        </button>
        <button
          type="button"
          className={styles.dismissBtn}
          onClick={onDismiss}
          aria-label={t('meeting.speakWhileMutedDismiss')}
          title={t('meeting.speakWhileMutedDismiss')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className={styles.progress} aria-hidden="true">
          <div className={styles.progressBar} />
        </div>
      </div>
    </div>
  );
}
