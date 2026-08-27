'use client';

import React from 'react';
import type { Room } from 'livekit-client';
import { Track } from 'livekit-client';
import styles from '@/styles/MeetingDocumentPip.module.css';

export interface MeetingDocumentPipLabels {
  backToTab: string;
  muteMic: string;
  unmuteMic: string;
  turnOffCam: string;
  turnOnCam: string;
  leave: string;
  meeting: string;
}

export interface MeetingDocumentPipPanelProps {
  room: Room;
  micEnabled: boolean;
  camEnabled: boolean;
  labels: MeetingDocumentPipLabels;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onLeave: () => void;
  onBackToTab: () => void;
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

export function MeetingDocumentPipPanel({
  room,
  micEnabled,
  camEnabled,
  labels,
  onToggleMic,
  onToggleCam,
  onLeave,
  onBackToTab,
}: MeetingDocumentPipPanelProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [hasVideo, setHasVideo] = React.useState(false);

  const displayName =
    room.localParticipant?.name ||
    room.localParticipant?.identity ||
    labels.meeting;

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const local = room.localParticipant;
    const pub = local?.getTrackPublication(Track.Source.Camera);
    const track = pub?.track;

    if (camEnabled && pub && track && !pub.isMuted) {
      track.attach(video);
      setHasVideo(true);
      return () => {
        track.detach(video);
        setHasVideo(false);
      };
    }

    video.srcObject = null;
    setHasVideo(false);
    return undefined;
  }, [room, camEnabled]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.title}>{labels.meeting}</span>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onBackToTab}
          aria-label={labels.backToTab}
          title={labels.backToTab}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="5" width="12" height="10" rx="1.5" />
            <path d="M15 9h4a1 1 0 011 1v8a1 1 0 01-1 1H9a1 1 0 01-1-1v-3" strokeLinecap="round" />
            <path d="M8 8l-4 4 4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className={styles.stage}>
        <video
          ref={videoRef}
          className={`${styles.video} ${hasVideo ? '' : styles.videoHidden}`}
          autoPlay
          playsInline
          muted
        />
        {!hasVideo && (
          <div className={styles.avatarWrap}>
            <div className={styles.avatar}>{initialsFromName(displayName)}</div>
            <p className={styles.name}>{displayName}</p>
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.controlBtn} ${micEnabled ? '' : styles.controlOff}`}
          onClick={onToggleMic}
          aria-label={micEnabled ? labels.muteMic : labels.unmuteMic}
          title={micEnabled ? labels.muteMic : labels.unmuteMic}
        >
          {micEnabled ? (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2z" />
              <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className={`${styles.controlBtn} ${camEnabled ? '' : styles.controlOff}`}
          onClick={onToggleCam}
          aria-label={camEnabled ? labels.turnOffCam : labels.turnOnCam}
          title={camEnabled ? labels.turnOffCam : labels.turnOnCam}
        >
          {camEnabled ? (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M17 10.5V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-3.5l4 4v-11l-4 4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M17 10.5V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-3.5l4 4v-11l-4 4z" />
              <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className={`${styles.controlBtn} ${styles.leaveBtn}`}
          onClick={onLeave}
          aria-label={labels.leave}
          title={labels.leave}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 010-1.41C3.34 8.69 7.46 7 12 7s8.66 1.69 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
