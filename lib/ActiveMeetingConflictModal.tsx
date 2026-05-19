'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import type { ActiveMeetingInfo } from '@/lib/meetingStartGuard';
import styles from '../styles/Home.module.css';

export function ActiveMeetingConflictModal({
  activeMeeting,
  ending,
  onContinue,
  onStartNew,
  onCancel,
}: {
  activeMeeting: ActiveMeetingInfo;
  ending?: boolean;
  onContinue: () => void;
  onStartNew: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const displayTitle =
    activeMeeting.title?.trim() || activeMeeting.roomName || t('dash.untitledMeeting');

  return (
    <div className={styles.dashModalOverlay} onClick={onCancel}>
      <div
        className={`${styles.dashModalContent} ${styles.conflictModalContent}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="conflict-modal-title"
        aria-modal="true"
      >
        <div className={styles.conflictModalHeader}>
          <h3 id="conflict-modal-title" className={styles.conflictModalTitle}>
            {t('dash.conflict.title')}
          </h3>
          <div className={styles.conflictModalActions}>
            <button
              type="button"
              className={styles.conflictBtnPrimary}
              onClick={onContinue}
              disabled={ending}
            >
              {t('dash.conflict.continue')}
            </button>
            <button
              type="button"
              className={styles.conflictBtnPrimary}
              onClick={onStartNew}
              disabled={ending}
            >
              {ending ? t('common.loading') : t('dash.conflict.startNew')}
            </button>
            <button
              type="button"
              className={styles.conflictBtnCancel}
              onClick={onCancel}
              disabled={ending}
            >
              {t('dash.conflict.cancel')}
            </button>
          </div>
        </div>

        <div className={styles.conflictModalBody}>
          <div className={styles.conflictWarningIcon} aria-hidden>
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
              <rect x="2" y="2" width="20" height="20" rx="2" fill="#ef4444" />
              <path
                d="M12 7v7M12 16.5v.5"
                stroke="#fff"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <p className={styles.conflictStatusText}>{t('dash.conflict.inProgress')}</p>
          <p className={styles.conflictMessage}>{t('dash.conflict.message')}</p>
          <p className={styles.conflictMeetingName}>{displayTitle}</p>
          <p className={styles.conflictNote}>{t('dash.conflict.note')}</p>
        </div>
      </div>
    </div>
  );
}
