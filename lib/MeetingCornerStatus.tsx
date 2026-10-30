'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { ConnectionQuality, ParticipantEvent, type Room } from 'livekit-client';
import { useI18n } from './i18n';
import styles from '../styles/MeetingCornerStatus.module.css';

/** The weak-connection hint stays this long after the connection recovers, so it doesn't flicker. */
const WEAK_HINT_LINGER_MS = 4000;

/** Whether your own connection to the meeting is poor (LiveKit's connection quality for you). */
export function useWeakConnection(room: Room | undefined): boolean {
  const [weak, setWeak] = React.useState(false);

  React.useEffect(() => {
    if (!room) return;
    const local = room.localParticipant;
    let recoverTimer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      const quality = local.connectionQuality;
      if (quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost) {
        if (recoverTimer) {
          clearTimeout(recoverTimer);
          recoverTimer = null;
        }
        setWeak(true);
        return;
      }
      if (recoverTimer) return;
      recoverTimer = setTimeout(() => {
        recoverTimer = null;
        setWeak(false);
      }, WEAK_HINT_LINGER_MS);
    };
    update();
    local.on(ParticipantEvent.ConnectionQualityChanged, update);
    return () => {
      local.off(ParticipantEvent.ConnectionQualityChanged, update);
      if (recoverTimer) clearTimeout(recoverTimer);
    };
  }, [room]);

  return weak;
}

export interface MeetingCornerStatusProps {
  room: Room | undefined;
  isRecording: boolean;
  paused: boolean;
  /** Host / co-host: the chip opens the recording controls. Everyone else sees a status. */
  canControlRecording: boolean;
  controlsOpen: boolean;
  onOpenRecordingControls: () => void;
  recordingButtonRef: React.Ref<HTMLButtonElement>;
  /** LiveDoc keeps its annotation tools along the left edge: start to the right of them. */
  besideLeftRail?: boolean;
}

/**
 * Top-left corner of the meeting: "Recording" while the meeting is recorded, and a hint when your
 * own connection is weak.
 */
export function MeetingCornerStatus({
  room,
  isRecording,
  paused,
  canControlRecording,
  controlsOpen,
  onOpenRecordingControls,
  recordingButtonRef,
  besideLeftRail = false,
}: MeetingCornerStatusProps) {
  const { t } = useI18n();
  const weak = useWeakConnection(room);

  if ((!isRecording && !weak) || typeof document === 'undefined') return null;

  const recLabel = paused ? t('toolbar.recordingPaused') : t('toolbar.recording');
  const recClass = `${styles.rec} ${paused ? styles.recPaused : ''}`;

  return createPortal(
    <div className={`${styles.corner} ${besideLeftRail ? styles.cornerBesideRail : ''}`}>
      {isRecording &&
        (canControlRecording ? (
          <button
            ref={recordingButtonRef}
            type="button"
            className={`${recClass} ${styles.recButton} ${controlsOpen ? styles.recButtonOpen : ''}`}
            onClick={onOpenRecordingControls}
            aria-haspopup="menu"
            aria-expanded={controlsOpen}
            title={t('toolbar.recordingControls')}
          >
            <span className={styles.recDot} aria-hidden="true" />
            {recLabel}
            <svg className={styles.chevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        ) : (
          <span className={recClass} role="status">
            <span className={styles.recDot} aria-hidden="true" />
            {recLabel}
          </span>
        ))}
      {weak && (
        <span className={styles.weak} role="status">
          <svg className={styles.signal} viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1" y="10" width="3" height="5" rx="1" fill="currentColor" />
            <rect x="6.5" y="6" width="3" height="9" rx="1" className={styles.signalOff} />
            <rect x="12" y="2" width="3" height="13" rx="1" className={styles.signalOff} />
          </svg>
          {t('meeting.weakConnection')}
        </span>
      )}
    </div>,
    document.body,
  );
}
