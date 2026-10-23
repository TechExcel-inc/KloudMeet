'use client';

import React from 'react';
import styles from '../styles/MeetingTopBar.module.css';

function roomCodeFromLocation(): string {
  try {
    return decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '');
  } catch {
    return '';
  }
}

export interface MeetingTopBarProps {
  /** Meeting title; falls back to the room code from the URL. */
  meetingTitle?: string;
  /** What everyone is seeing right now, e.g. "Video · Grid". */
  modeLabel: string;
  /** Extra context next to the mode, e.g. "Whiteboard". */
  modeDetail?: string;
  isRecording?: boolean;
  recordingLabel: string;
  captionsOn?: boolean;
  captionsLabel: string;
}

/**
 * Desktop meeting top bar: clock | meeting name | current mode on the left, recording and
 * captions status on the right. The stage starts below it, so nothing here covers a face or
 * a document.
 */
export function MeetingTopBar({
  meetingTitle,
  modeLabel,
  modeDetail,
  isRecording = false,
  recordingLabel,
  captionsOn = false,
  captionsLabel,
}: MeetingTopBarProps) {
  // Filled after mount so server and client render the same markup.
  const [clock, setClock] = React.useState('');
  const [roomCode, setRoomCode] = React.useState('');
  React.useEffect(() => {
    setRoomCode(roomCodeFromLocation());
    const tick = () => {
      try {
        setClock(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      } catch {
        setClock('');
      }
    };
    tick();
    const id = window.setInterval(tick, 15000);
    return () => window.clearInterval(id);
  }, []);
  const name = (meetingTitle && meetingTitle.trim()) || roomCode;

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        {clock && <span className={styles.clock}>{clock}</span>}
        {clock && name && <span className={styles.divider} aria-hidden="true" />}
        {name && (
          <span className={styles.name} title={name}>
            {name}
          </span>
        )}
        <span className={styles.mode} aria-live="polite">
          <span className={styles.modeDot} aria-hidden="true" />
          {modeLabel}
          {modeDetail && <span className={styles.modeDetail}>· {modeDetail}</span>}
        </span>
      </div>
      <div className={styles.right} aria-live="polite">
        {captionsOn && <span className={`${styles.chip} ${styles.chipCaptions}`}>{captionsLabel}</span>}
        {isRecording && (
          <span className={`${styles.chip} ${styles.chipRec}`}>
            <span className={styles.recDot} aria-hidden="true" />
            {recordingLabel}
          </span>
        )}
      </div>
    </div>
  );
}
