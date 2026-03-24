'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MediaDeviceMenu } from '@livekit/components-react';
import styles from '../styles/SkyMeetToolbar.module.css';

export type ViewMode = 'liveDoc' | 'webcam' | 'shareScreen';

interface SkyMeetToolbarProps {
  activeView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  onExit: () => void;
  micEnabled: boolean;
  camEnabled: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onShareScreen: () => void;
  screenShareActive: boolean;
  canShareScreen: boolean;
}

export function SkyMeetToolbar({
  activeView,
  onViewChange,
  onExit,
  micEnabled,
  camEnabled,
  onToggleMic,
  onToggleCam,
  onShareScreen,
  screenShareActive,
  canShareScreen,
}: SkyMeetToolbarProps) {
  const [visible, setVisible] = useState(true);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Show immediately if cursor is within 90px of bottom
      const threshold = window.innerHeight - 90;
      setVisible(e.clientY >= threshold);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const showComingSoon = (feature: string) => {
    setToastMsg(`${feature} — Coming soon`);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000);
  };

  const handleShareScreenClick = () => {
    onShareScreen();
    onViewChange('shareScreen');
  };

  return (
    <>
      {/* Toast */}
      {toastMsg && <div className={styles.toast}>{toastMsg}</div>}

      {/* Chevron handle when hidden */}
      {!visible && (
        <div className={styles.chevronHandle}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 15l-6-6-6 6" />
          </svg>
        </div>
      )}

      {/* Main toolbar */}
      <div
        className={`${styles.toolbar} ${!visible ? styles.toolbarHidden : ''}`}
      >
        {/* Left: mic / cam / speaker toggles */}
        <div className={styles.leftControls}>
          <div className={styles.controlGroup}>
            <button
              className={`${styles.controlBtn} ${!micEnabled ? styles.controlBtnOff : ''}`}
              onClick={onToggleMic}
              title={micEnabled ? 'Mute Mic' : 'Unmute Mic'}
            >
              {micEnabled ? (
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.55-.9l4.17 4.18L21 19.73 4.27 3z"/></svg>
              )}
            </button>
            <MediaDeviceMenu kind="audioinput" className={styles.chevron} title="Microphone Settings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>
            </MediaDeviceMenu>
          </div>

          <div className={styles.controlGroup}>
            <button
              className={`${styles.controlBtn} ${!camEnabled ? styles.controlBtnOff : ''}`}
              onClick={onToggleCam}
              title={camEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
            >
              {camEnabled ? (
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/></svg>
              )}
            </button>
            <MediaDeviceMenu kind="videoinput" className={styles.chevron} title="Camera Settings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>
            </MediaDeviceMenu>
          </div>

          <div className={styles.controlGroup}>
            <button className={`${styles.controlBtn} ${styles.controlBtnSpeaker}`} title="Speaker Settings" onClick={() => showComingSoon('Speaker Settings')}>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            </button>
            <MediaDeviceMenu kind="audiooutput" className={styles.chevron} title="Speaker Settings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>
            </MediaDeviceMenu>
          </div>
        </div>

        {/* Center: view tabs */}
        <div className={styles.centerTabs}>
          <button
            className={`${styles.tabBtn} ${activeView === 'liveDoc' ? styles.tabBtnActive : ''}`}
            onClick={() => onViewChange('liveDoc')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Live Doc
          </button>

          <button
            className={`${styles.tabBtn} ${activeView === 'webcam' ? styles.tabBtnActive : ''}`}
            onClick={() => onViewChange('webcam')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Webcam
          </button>

          <button
            className={`${styles.tabBtn} ${(activeView === 'shareScreen' || screenShareActive) ? styles.tabBtnActive : ''}`}
            onClick={handleShareScreenClick}
            style={{ opacity: canShareScreen ? 1 : 0.5, cursor: canShareScreen ? 'pointer' : 'not-allowed' }}
            title={!canShareScreen ? 'Someone else is already sharing' : 'Share Screen'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Share Screen
          </button>

          <button className={styles.tabBtn} onClick={() => showComingSoon('Attendee')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Attendee
          </button>

          <button className={styles.tabBtn} onClick={() => showComingSoon('Files')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Files
          </button>

          <button className={styles.tabBtn} onClick={() => {
            const chatToggle = document.querySelector<HTMLButtonElement>('.lk-chat-toggle');
            if (chatToggle) {
              chatToggle.click();
            } else {
              showComingSoon('Chats');
            }
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Chats
          </button>

          <button className={styles.tabBtn} onClick={() => showComingSoon('More')}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
            </svg>
            More
          </button>

          <button className={styles.tabBtn} onClick={() => showComingSoon('Setting')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Setting
          </button>
        </div>

        {/* Right: exit and N menu */}
        <div className={styles.rightControls}>
          <button className={styles.exitBtn} onClick={onExit}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Exit
          </button>

          <button className={styles.nMenuBtn} title="Settings" onClick={() => {
            const settingsToggle = document.querySelector<HTMLButtonElement>('.lk-settings-toggle');
            if (settingsToggle) settingsToggle.click();
          }}>
            N
          </button>
        </div>
      </div>
    </>
  );
}
