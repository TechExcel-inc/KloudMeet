'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { ConnectionQuality, ParticipantEvent, type Room } from 'livekit-client';
import { useI18n } from './i18n';
import type { RecordingMode } from './recordingControls';
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
  /** AI Notes Only：状态写成 AI Taking Notes，不再在右侧另标类型。 */
  mode?: RecordingMode;
  /** AI Taking Notes with no audio kept: the chip says so instead of "Recording" */
  notesOnly?: boolean;
  /** Host / co-host: the chip opens the recording controls. Everyone else sees a status. */
  canControlRecording: boolean;
  controlsOpen: boolean;
  onOpenRecordingControls: () => void;
  onRecordingDragStart?: () => void;
  recordingButtonRef: React.Ref<HTMLButtonElement>;
  /** LiveDoc keeps its annotation tools along the left edge: start to the right of them. */
  besideLeftRail?: boolean;
  /** Phone: in line with the round buttons at the top right, and icons only: "Recording" is its
   *  red dot, the weak connection its signal bars. */
  phone?: boolean;
}

/**
 * Top-left corner of the meeting: "Recording" while the meeting is recorded, and a hint when your
 * own connection is weak.
 */
export function MeetingCornerStatus({
  room,
  isRecording,
  paused,
  mode = 'full',
  notesOnly = false,
  canControlRecording,
  controlsOpen,
  onOpenRecordingControls,
  onRecordingDragStart,
  recordingButtonRef,
  besideLeftRail = false,
  phone = false,
}: MeetingCornerStatusProps) {
  const { t } = useI18n();
  const weak = useWeakConnection(room);

  const corner = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState<{ left: number; top: number }>();
  const drag = React.useRef<{ pointerId: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const ignoreClick = React.useRef(false);
  const notes = mode === 'ai_notes' || notesOnly;
  const recLabel = notes
    ? paused ? t('toolbar.notesPaused') : t('toolbar.takingNotes')
    : paused ? t('toolbar.recordingPaused') : t('toolbar.recording');

  const clampPosition = React.useCallback((left: number, top: number) => {
    const box = corner.current?.getBoundingClientRect();
    if (!box) return { left, top };
    return {
      left: Math.max(8, Math.min(left, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - box.height - 8)),
    };
  }, []);

  React.useEffect(() => {
    const keepInView = () => setPosition(prior => prior && clampPosition(prior.left, prior.top));
    keepInView();
    window.addEventListener('resize', keepInView);
    return () => window.removeEventListener('resize', keepInView);
  }, [clampPosition, recLabel, phone, weak, isRecording]);

  if ((!isRecording && !weak) || typeof document === 'undefined') return null;

  const dragHandlers = {
    onPointerDown(event: React.PointerEvent<HTMLElement>) {
      if (!event.isPrimary || event.button !== 0) return;
      const box = corner.current?.getBoundingClientRect();
      if (!box) return;
      ignoreClick.current = false;
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        left: box.left, top: box.top, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: React.PointerEvent<HTMLElement>) {
      const current = drag.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (!current.moved) {
        if (Math.hypot(dx, dy) < 5) return;
        current.moved = true;
        ignoreClick.current = true;
        onRecordingDragStart?.();
      }
      setPosition(clampPosition(current.left + dx, current.top + dy));
    },
    onLostPointerCapture(event: React.PointerEvent<HTMLElement>) {
      if (drag.current?.pointerId === event.pointerId) drag.current = null;
    },
  };
  const recClass = `${styles.rec} ${paused ? styles.recPaused : ''}`;

  return createPortal(
    <div
      className={`${styles.corner} ${phone ? styles.cornerPhone : ''} ${besideLeftRail ? styles.cornerBesideRail : ''}`}
      data-meeting-corner=""
      ref={corner}
      style={position}
    >
      {isRecording &&
        (canControlRecording ? (
          <button
            ref={recordingButtonRef}
            type="button"
            className={`${recClass} ${styles.recButton} ${controlsOpen ? styles.recButtonOpen : ''}`}
            {...dragHandlers}
            onClick={event => {
              if (event.detail > 0 && ignoreClick.current) return;
              onOpenRecordingControls();
            }}
            aria-haspopup="menu"
            aria-expanded={controlsOpen}
            aria-label={phone ? recLabel : undefined}
            title={t('toolbar.recordingControls')}
          >
            <span className={styles.recDot} aria-hidden="true" />
            <span className={styles.recLabel}>{recLabel}</span>
            <svg className={styles.chevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        ) : (
          <span {...dragHandlers} className={recClass} role="status" aria-label={phone ? recLabel : undefined} title={phone ? recLabel : undefined}>
            <span className={styles.recDot} aria-hidden="true" />
            <span className={styles.recLabel}>{recLabel}</span>
          </span>
        ))}
      {weak && (
        <span
          className={styles.weak}
          role="status"
          aria-label={phone ? t('meeting.weakConnection') : undefined}
          title={phone ? t('meeting.weakConnection') : undefined}
        >
          <svg className={styles.signal} viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1" y="10" width="3" height="5" rx="1" fill="currentColor" />
            <rect x="6.5" y="6" width="3" height="9" rx="1" className={styles.signalOff} />
            <rect x="12" y="2" width="3" height="13" rx="1" className={styles.signalOff} />
          </svg>
          {!phone && t('meeting.weakConnection')}
        </span>
      )}
    </div>,
    document.body,
  );
}
