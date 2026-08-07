'use client';

import { useI18n } from './i18n';
import styles from '@/styles/SpeakWhileMutedPrompt.module.css';

export interface SpeakWhileMutedPromptProps {
  visible: boolean;
  onUnmute: () => void;
  onDismiss: () => void;
}

export function SpeakWhileMutedPrompt({ visible, onUnmute, onDismiss }: SpeakWhileMutedPromptProps) {
  const { t } = useI18n();

  if (!visible) return null;

  return (
    <div className={styles.root} role="status" aria-live="polite">
      <div className={styles.card}>
        <div className={styles.iconWrap} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={styles.icon}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l16 16" />
          </svg>
        </div>
        <p className={styles.message}>{t('meeting.speakWhileMutedMessage')}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.unmuteBtn} onClick={onUnmute}>
            {t('meeting.speakWhileMutedUnmute')}
          </button>
          <button
            type="button"
            className={styles.dismissBtn}
            onClick={onDismiss}
            aria-label={t('meeting.speakWhileMutedDismiss')}
            title={t('meeting.speakWhileMutedDismiss')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
