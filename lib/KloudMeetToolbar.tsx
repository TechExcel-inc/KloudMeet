'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MediaDeviceMenu } from '@livekit/components-react';
import styles from '../styles/KloudMeetToolbar.module.css';

export type ViewMode = 'liveDoc' | 'webcam' | 'shareScreen';

interface KloudMeetToolbarProps {
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
  isDrawingMode: boolean;
  onToggleDrawingMode: () => void;
  isRemoteControlMode: boolean;
  onToggleRemoteControlMode: () => void;
  hasScreenShare: boolean;
  isDesktop: boolean;
  canSwitchViews: boolean;
  chatOpen: boolean;
  onToggleChat: () => void;
}

export function KloudMeetToolbar({
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
  isDrawingMode,
  onToggleDrawingMode,
  isRemoteControlMode,
  onToggleRemoteControlMode,
  hasScreenShare,
  isDesktop,
  canSwitchViews,
  chatOpen,
  onToggleChat,
}: KloudMeetToolbarProps) {
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
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/>
                  <line x1="4" y1="4" x2="20" y2="20" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
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
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                  <line x1="4" y1="4" x2="20" y2="20" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
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

        {/* Center: view tabs (only for host/co-host/presenter) */}
        <div className={styles.centerTabs}>
          {canSwitchViews && (
          <>
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
            className={`${styles.tabBtn} ${activeView === 'shareScreen' ? styles.tabBtnActive : ''}`}
            onClick={handleShareScreenClick}
            style={{ opacity: canShareScreen ? 1 : 0.5, cursor: canShareScreen ? 'pointer' : 'not-allowed' }}
            title={!canShareScreen ? 'Someone else is already sharing' : 'Share Screen'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Share Screen
          </button>

          {isDesktop ? (
            <>
              <button
                className={`${styles.tabBtn} ${isDrawingMode ? styles.tabBtnActive : ''}`}
                onClick={onToggleDrawingMode}
                style={{ opacity: hasScreenShare ? 1 : 0.5, cursor: hasScreenShare ? 'pointer' : 'not-allowed' }}
                title={!hasScreenShare ? 'No active screenshare to annotate' : 'Annotate Screenshare'}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                </svg>
                Annotate
              </button>

              <button
                className={`${styles.tabBtn} ${isRemoteControlMode ? styles.tabBtnActive : ''}`}
                onClick={onToggleRemoteControlMode}
                style={{ opacity: hasScreenShare ? 1 : 0.5, cursor: hasScreenShare ? 'pointer' : 'not-allowed' }}
                title={!hasScreenShare ? 'No active screenshare to control' : 'Remote Control'}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zm-7.518-.267A8.25 8.25 0 1120.25 10.5M8.288 14.212A5.25 5.25 0 1117.25 10.5" />
                </svg>
                Control
              </button>
            </>
          ) : (
            <button
              className={styles.tabBtn}
              onClick={() => {
                const currentUrl = new URL(window.location.href);
                const rn = currentUrl.pathname.split('/').pop() || '';
                window.location.href = `kloudmeet://join/${rn}`;
              }}
              title="Launch Native App for Presentations"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Open App
            </button>
          )}
          </>
          )}

          <button className={styles.tabBtn} onClick={() => showComingSoon('Attendee')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Attendee
          </button>

          <button className={styles.tabBtn} onClick={() => {
            navigator.clipboard.writeText(window.location.href);
            setToastMsg('Invite Link Copied to Clipboard!');
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
            toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000);
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
            </svg>
            Invite
          </button>

          <button className={`${styles.tabBtn} ${chatOpen ? styles.tabBtnActive : ''}`} onClick={onToggleChat}>
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

        <div className={styles.rightControls}>
          <button className={styles.exitBtn} onClick={onExit}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Exit
          </button>
        </div>
      </div>
    </>
  );
}
