'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { KloudMeetToolbar, ViewMode, buildInviteLinkForClipboard } from '@/lib/KloudMeetToolbar';
import { LiveDocView } from '@/lib/LiveDocView';
import { HelpModal } from '@/lib/HelpModal';
import { createLivedocInstance, createOrUpdateInstantAccount } from '@/lib/livedoc/client';
import { AnnotationCanvas } from '@/lib/AnnotationCanvas';
import { RemoteControlOverlay, RemoteControlRequest } from '@/lib/RemoteControlOverlay';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { useToolbarIsMobile } from '@/lib/useToolbarIsMobile';
import { ConnectionDetails } from '@/lib/types';
import { useI18n, LOCALE_OPTIONS } from '@/lib/i18n';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  PreJoin,
  RoomContext,
  VideoConference,
  VideoTrack,
  useTracks,
  TrackLoop,
  ParticipantTile,
  RoomAudioRenderer,
  ConnectionStateToast,
} from '@livekit/components-react';
import {
  ExternalE2EEKeyProvider,
  RoomOptions,
  VideoCodec,
  VideoPresets,
  Room,
  DeviceUnsupportedError,
  RoomConnectOptions,
  RoomEvent,
  ConnectionState,
  RemoteParticipant,
  TrackPublishDefaults,
  VideoCaptureOptions,
  Track,
  DataPacket_Kind,
} from 'livekit-client';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';
import { ChatPanel, AttendeePanel, chatAndAttendeeStyles } from '@/lib/ChatAndAttendeePanel';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
}) {
  const searchParams = useSearchParams();
  const isActionStart = searchParams?.get('action') === 'start';
  const isBot = searchParams?.get('isBot') === 'true';

  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );

  // Force microphone to always default ON, regardless of persisted state.
  // Camera and other choices remain persisted from localStorage.
  if (typeof window !== 'undefined') {
    try {
      const key = 'lk-user-choices';
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.audioEnabled === false) {
          parsed.audioEnabled = true;
          localStorage.setItem(key, JSON.stringify(parsed));
        }
      }
    } catch (_) { /* ignore */ }
  }

  const preJoinDefaults = React.useMemo(() => {
    return {
      username: '',
      videoEnabled: true,
      audioEnabled: true,
    };
  }, []);
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  const [meetingInfo, setMeetingInfo] = React.useState<any>(null);
  const [currentUser, setCurrentUser] = React.useState<any>(null);
  const [isSameTabRefresh, setIsSameTabRefresh] = React.useState(false);
  const [elapsedTime, setElapsedTime] = React.useState('');
  const [showAvatarMenu, setShowAvatarMenu] = React.useState(false);
  const { t, locale, setLocale } = useI18n();
  const [showLangMenu, setShowLangMenu] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('kloudUser');
        if (stored) setCurrentUser(JSON.parse(stored));

        if (sessionStorage.getItem('activeKloudRoom') === props.roomName) {
          setIsSameTabRefresh(true);
        }
      } catch (e) { }
    }

    fetch(`/api/meetings/${props.roomName}`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) setMeetingInfo(data);
      })
      .catch(console.error);
  }, [props.roomName]);

  React.useEffect(() => {
    if (!meetingInfo?.startedAt) return;
    const tick = () => {
      const start = new Date(meetingInfo.startedAt).getTime();
      const diffMs = Date.now() - start;
      if (diffMs < 0) {
        setElapsedTime('00:00');
        return;
      }
      const totalSec = Math.floor(diffMs / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      setElapsedTime(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const intv = setInterval(tick, 1000);
    return () => clearInterval(intv);
  }, [meetingInfo?.startedAt]);

  const isHost = React.useMemo(() => {
    return meetingInfo?.createdByMemberId && currentUser?.id === meetingInfo.createdByMemberId;
  }, [meetingInfo, currentUser]);

  const isActive = meetingInfo?.isActive === true;

  const preJoinTitle = React.useMemo(() => {
    if (isHost && !isActive) return t('prejoin.startingMeeting');
    if (isHost && isActive) return t('prejoin.activeMeeting');
    if (meetingInfo?.createdByMember) return t('prejoin.joiningUser', { name: meetingInfo.createdByMember.fullName || meetingInfo.createdByMember.username });
    return t('prejoin.joiningMeeting');
  }, [isHost, isActive, meetingInfo, t]);

  const preJoinSubtitle = React.useMemo(() => {
    if (isHost && !isActive) return t('prejoin.configDevice');
    if (isHost && isActive) return t('prejoin.alreadyHosting');
    if (meetingInfo?.startedAt) return t('prejoin.inProgress', { time: elapsedTime || '00:00' });
    return t('prejoin.configDevice');
  }, [isHost, isActive, meetingInfo, elapsedTime, t]);

  const preJoinButtonText = React.useMemo(() => {
    if (isHost && !isActive) return t('prejoin.startNow');
    if (isHost && isActive) return t('prejoin.joinAsHost');
    return t('prejoin.joinNow');
  }, [isHost, isActive, t]);

  const handlePreJoinSubmit = React.useCallback(async (values: LocalUserChoices) => {
    try {
      setPreJoinChoices(values);
      const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
      url.searchParams.append('roomName', props.roomName);
      url.searchParams.append('participantName', values.username);
      if (props.region) {
        url.searchParams.append('region', props.region);
      }
      const connectionDetailsResp = await fetch(url.toString());
      if (!connectionDetailsResp.ok) {
        throw new Error(
          `Server error ${connectionDetailsResp.status}: ${await connectionDetailsResp.text()}`,
        );
      }
      const connectionDetailsData = await connectionDetailsResp.json();
      setConnectionDetails(connectionDetailsData);

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('activeKloudRoom', props.roomName);
      }
    } catch (error: any) {
      console.error('Failed to get connection details:', error);
      alert(
        `${t('prejoin.connectError', { error: error.message })}`,
      );
    }
  }, [props.roomName, props.region, t]);
  const handlePreJoinError = React.useCallback((error: any) => {
    console.error('PreJoin Validation Error:', error);
    alert(`${t('prejoin.prejoinError', { error: error?.message || String(error) })}`);
  }, [t]);

  React.useEffect(() => {
    if (isBot && !connectionDetails && preJoinChoices === undefined) {
      handlePreJoinSubmit({
        username: 'KloudMeet Recorder',
        videoEnabled: false,
        audioEnabled: false,
        videoDeviceId: '',
        audioDeviceId: '',
      });
    }
  }, [isBot, connectionDetails, preJoinChoices, handlePreJoinSubmit]);

  if (meetingInfo?.status === 'ENDED' || meetingInfo?.status === 'CANCELED') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f8f9fb', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#fff', padding: '3rem 2.5rem', borderRadius: '16px', boxShadow: '0 8px 35px rgba(17,24,39,0.05)', textAlign: 'center', maxWidth: '440px', width: '90%', border: '1px solid #e5e7eb' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: meetingInfo.status === 'ENDED' ? '#dcfce7' : '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
            {meetingInfo.status === 'ENDED' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" width="32" height="32"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" width="32" height="32"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            )}
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: '0 0 0.5rem' }}>
            {meetingInfo.status === 'ENDED' ? t('prejoin.meetingConcluded') : t('prejoin.meetingCanceled')}
          </h1>
          <p style={{ color: '#6b7280', fontSize: '1rem', margin: '0 0 2rem' }}>
            {meetingInfo.status === 'ENDED'
              ? t('prejoin.meetingEndedDesc')
              : t('prejoin.meetingCanceledDesc')}
          </p>
          <Link href="/" style={{ display: 'inline-block', padding: '0.75rem 1.5rem', background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', color: '#fff', borderRadius: '8px', textDecoration: 'none', fontWeight: 600, width: '100%' }}>
            {t('prejoin.returnDashboard')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <main style={{ height: '100%' }}>
      {connectionDetails === undefined || preJoinChoices === undefined ? (
        <div className="kloud-prejoin-wrapper" style={{ display: isBot ? 'none' : undefined }}>
          <style>{`
            .kloud-prejoin-wrapper button[type="submit"].lk-button,
            .kloud-prejoin-wrapper .lk-prejoin > button.lk-button:last-of-type {
              color: transparent !important;
              position: relative !important;
              overflow: hidden !important;
            }
            .kloud-prejoin-wrapper button[type="submit"].lk-button::after,
            .kloud-prejoin-wrapper .lk-prejoin > button.lk-button:last-of-type::after {
              content: "${preJoinButtonText}";
              position: absolute !important;
              left: 0;
              top: 0;
              width: 100%;
              height: 100%;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white !important;
              font-size: 1rem !important;
              font-weight: 600 !important;
              pointer-events: none !important;
            }

            /* Make dropdown arrow backgrounds match the main purple backgrounds precisely */
            .kloud-prejoin-wrapper .lk-button-group,
            .kloud-prejoin-wrapper .lk-button-group > button,
            .kloud-prejoin-wrapper .lk-button-group > div {
              background: linear-gradient(135deg, #6d28d9, #7c3aed) !important;
            }
            .kloud-prejoin-wrapper .lk-button-group > button:hover,
            .kloud-prejoin-wrapper .lk-button-group > div:hover {
              background: linear-gradient(135deg, #5b21b6, #6d28d9) !important;
            }

            /* Toolbar CSS - EAD-PFM Aesthetic */
            .kloud-prejoin-toolbar {
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 72px;
              padding: 0 2rem;
              display: flex;
              align-items: center;
              justify-content: space-between;
              z-index: 50;
            }
            .kloud-prejoin-logo-toolbar {
              display: flex;
              align-items: center;
              gap: 0.6rem;
              text-decoration: none;
              color: #1e1e2e;
              font-weight: 700;
              font-size: 1.25rem;
              font-family: 'Inter', sans-serif;
            }
            .kloud-prejoin-logo-icon-toolbar {
              width: 32px;
              height: 32px;
              border-radius: 9px;
              background: linear-gradient(135deg, #7c3aed, #5b21b6);
              display: inline-flex;
              align-items: center;
              justify-content: center;
            }
            .ead-toolbar-right {
              display: flex;
              align-items: center;
              gap: 0.75rem;
            }
            .ead-btn {
              height: 38px;
              background: #fff;
              border: 1px solid #d1d5db;
              color: #4b5563;
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
              transition: all 0.15s ease;
              outline: none;
              font-family: 'Inter', sans-serif;
              box-sizing: border-box;
            }
            .ead-btn:hover {
              background: #f9fafb;
              border-color: #9ca3af;
              color: #111827;
            }
            .ead-icon-btn, .ead-avatar-btn {
              width: 38px;
              border-radius: 50%;
              padding: 0;
            }
            .ead-pill-btn {
              padding: 0 12px;
              border-radius: 19px;
              gap: 6px;
              font-size: 0.85rem;
              font-weight: 600;
            }
            .ead-btn-active {
              background: #8b5cf6 !important;
              color: #fff !important;
              border-color: #f59e0b !important;
              box-shadow: 0 0 0 1px #f59e0b !important;
            }
            .ead-avatar-fallback {
              width: 100%;
              height: 100%;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
            }
            .ead-avatar-fallback svg {
              width: 18px;
              height: 18px;
            }
            .ead-avatar-btn img {
              width: 100%;
              height: 100%;
              border-radius: 50%;
              object-fit: cover;
            }
            .ead-dropdown-container {
              position: relative;
            }
            .ead-dropdown-menu {
              position: absolute;
              top: calc(100% + 8px);
              right: 0;
              background: #252834;
              border-radius: 8px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              width: 220px;
              display: flex;
              flex-direction: column;
              border: 1px solid #374151;
              animation: eadFade 0.15s ease;
              z-index: 100;
              overflow: hidden;
            }
            @keyframes eadFade {
              from { opacity: 0; transform: translateY(-8px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .ead-menu-header {
              display: flex;
              align-items: center;
              gap: 8px;
              padding: 12px 16px;
              font-size: 0.72rem;
              font-weight: 700;
              letter-spacing: 0.08em;
              color: #9ca3af;
              text-transform: uppercase;
              border-bottom: 1px solid #374151;
              font-family: 'Inter', sans-serif;
            }
            .ead-menu-item {
              background: transparent;
              border: none;
              text-align: left;
              padding: 10px 16px;
              font-size: 0.9rem;
              font-weight: 500;
              color: #d1d5db;
              cursor: pointer;
              transition: all 0.1s;
              display: flex;
              align-items: center;
              gap: 10px;
              font-family: 'Inter', sans-serif;
            }
            .ead-menu-item:hover {
              background: #374151;
              color: #fff;
            }
            .ead-menu-item-active {
              background: #8b5cf6 !important;
              color: #fff !important;
            }
            .ead-menu-code {
              margin-left: auto;
              font-size: 0.8rem;
              color: #9ca3af;
              display: flex;
              align-items: center;
            }
            .ead-menu-item-active .ead-menu-code {
              color: #ddd6fe;
            }

            /* --- Mobile Adaptation for Toolbar --- */
            @media (max-width: 768px) {
              .kloud-prejoin-toolbar {
                padding: 0 1rem;
                height: 64px;
              }
              .kloud-prejoin-logo-toolbar {
                font-size: 0; /* Hide Kloud Meet text */
                gap: 0;
              }
              .kloud-prejoin-logo-icon-toolbar {
                width: 32px;
                height: 32px;
              }
              .ead-toolbar-right {
                gap: 0.4rem;
              }
              .ead-btn {
                height: 36px;
              }
              .ead-icon-btn, .ead-avatar-btn {
                width: 36px;
              }
              .ead-pill-btn {
                padding: 0 10px;
                font-size: 0.85rem;
              }
              .ead-dropdown-menu {
                width: 200px;
                right: -10px; /* Prevent edge overflow */
              }
            }
          `}</style>

          <header className="kloud-prejoin-toolbar">
            <div className="kloud-prejoin-toolbar-left" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <Link href="/" className="ead-btn ead-icon-btn" title="Go Back" style={{ textDecoration: 'none' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <Link href="/" className="kloud-prejoin-logo-toolbar">
                <span className="kloud-prejoin-logo-icon-toolbar">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" width="18" height="18">
                    <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                Kloud Meet
              </Link>
            </div>

            <div className="ead-toolbar-right">
              {/* Help Button */}
              <button className="ead-btn ead-icon-btn" title={t('nav.help')} onClick={() => { setShowLangMenu(false); setShowAvatarMenu(false); setShowHelp(true); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              </button>

              {/* Language Pill Button */}
              <div className="ead-dropdown-container">
                <button
                  className={`ead-btn ead-pill-btn ${showLangMenu ? 'ead-btn-active' : ''}`}
                  onClick={() => { setShowLangMenu(!showLangMenu); setShowAvatarMenu(false); }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <span>{LOCALE_OPTIONS.find(l => l.code === locale)?.shortCode || 'EN'}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {showLangMenu && (
                  <div className="ead-dropdown-menu">
                    <div className="ead-menu-header">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                      {t('nav.selectLanguage')}
                    </div>
                    {LOCALE_OPTIONS.map(opt => (
                      <button
                        key={opt.code}
                        className={`ead-menu-item ${locale === opt.code ? 'ead-menu-item-active' : ''}`}
                        onClick={() => { setLocale(opt.code); setShowLangMenu(false); }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                        {opt.label}
                        <span className="ead-menu-code">
                          {opt.shortCode}
                          {locale === opt.code && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginLeft: '6px' }}><path d="M20 6L9 17l-5-5" /></svg>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Avatar Button */}
              <div className="ead-dropdown-container">
                <button
                  className={`ead-btn ead-avatar-btn ${showAvatarMenu ? 'ead-btn-active' : ''}`}
                  onClick={() => { setShowAvatarMenu(!showAvatarMenu); setShowLangMenu(false); }}
                >
                  {currentUser?.avatarUrl ? (
                    <img src={currentUser.avatarUrl} alt="Avatar" />
                  ) : (
                    <div className="ead-avatar-fallback">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </div>
                  )}
                </button>
                {showAvatarMenu && (
                  <div className="ead-dropdown-menu">
                    <button onClick={() => alert('Profile coming soon')} className="ead-menu-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                      {t('prejoin.profile')}
                    </button>
                    <button onClick={() => alert('System Settings coming soon')} className="ead-menu-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                      {t('nav.systemSettings')}
                    </button>
                    <button onClick={() => alert('AI Digital Human Setup coming soon')} className="ead-menu-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                      {t('prejoin.aiDigitalHuman')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="kloud-prejoin-header">
            <h2 className="kloud-prejoin-title">{preJoinTitle}</h2>
            <p className="kloud-prejoin-subtitle">{preJoinSubtitle}</p>
          </div>
          {!isBot && (
            <PreJoin
              defaults={preJoinDefaults}

              onSubmit={handlePreJoinSubmit}
              onError={handlePreJoinError}
            />
          )}
          {isHost && isActive && !isSameTabRefresh && (
            <div style={{ textAlign: 'center', marginTop: '1.25rem', zIndex: 2 }}>
              <button
                onClick={() => { window.location.href = '/'; }}
                style={{ background: 'transparent', border: 'none', color: '#ff6352', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.9rem', fontFamily: 'Inter, sans-serif' }}
              >
                {t('prejoin.orStartNew')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div data-lk-theme="default" style={{ height: '100%' }}>
          <VideoConferenceComponent
            connectionDetails={connectionDetails}
            userChoices={preJoinChoices}
            options={{ codec: props.codec, hq: props.hq }}
          />
        </div>
      )}

      {/* Help Modal — always available (pre-join + in-meeting) */}
      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </main>
  );
}

function MobileVideoLayout() {
  const { t } = useI18n();
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );

  return (
    <div
      className="lk-mobile-scroll-grid"
      style={{
        flex: 1,
        height: '100%',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        background: '#0a0a0a'
      }}
    >
      <TrackLoop tracks={tracks}>
        <div style={{ width: '100%', minHeight: '30vh', aspectRatio: '16/9', borderRadius: '16px', overflow: 'hidden', flexShrink: 0, position: 'relative', background: '#1e1e2e' }}>
          <ParticipantTile style={{ width: '100%', height: '100%' }} />
        </div>
      </TrackLoop>
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}

function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  options: {
    hq: boolean;
    codec: VideoCodec;
  };
}) {
  const { t } = useI18n();
  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);

  const searchParams = useSearchParams();
  const isActionStart = searchParams?.get('action') === 'start';

  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);
  const [activeView, setActiveView] = React.useState<ViewMode>('webcam');
  const [micEnabled, setMicEnabled] = React.useState(props.userChoices.audioEnabled);
  const [camEnabled, setCamEnabled] = React.useState(props.userChoices.videoEnabled);
  const [screenShareActive, setScreenShareActive] = React.useState(false);
  const [isWebcamSidebarCollapsed, setIsWebcamSidebarCollapsed] = React.useState(false);
  const [isDrawingMode, setIsDrawingMode] = React.useState(false);
  const [isRemoteControlMode, setIsRemoteControlMode] = React.useState(false);
  // Remote control permission flow
  const [remoteControlPending, setRemoteControlPending] = React.useState(false);
  const [remoteControlRequest, setRemoteControlRequest] = React.useState<RemoteControlRequest | null>(null);
  const [approvedControllerIdentity, setApprovedControllerIdentity] = React.useState<string | null>(null);
  const [screenShareSurface, setScreenShareSurface] = React.useState<
    'monitor' | 'window' | 'browser' | 'current-tab' | 'unknown'
  >('unknown');
  // Only activate mirror-block AFTER surface detection completes (avoids overlay flash)
  const [surfaceDetected, setSurfaceDetected] = React.useState(false);
  const isDesktop = useIsDesktop();
  const isToolbarMobile = useToolbarIsMobile();
  // 微信/手机内置浏览器无法自动播放时，显示「点击播放」覆盖层
  const [needsPlayTap, setNeedsPlayTap] = React.useState(false);

  const [showMeetingReadyModal, setShowMeetingReadyModal] = React.useState(false);
  const [isRecording, setIsRecording] = React.useState(false);
  const [showRecordPopup, setShowRecordPopup] = React.useState(false);
  const [showRecordingConsent, setShowRecordingConsent] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);

  const handleToggleRecording = async (action: 'start' | 'stop') => {
    try {
      const dbUser = JSON.parse(localStorage.getItem('kloudUser') || '{}');
      if (!dbUser.id) {
        alert('You must be logged in to record');
        return;
      }
      setIsRecording(action === 'start');
      const pageUrlStr = window.location.href;

      const res = await fetch(`/api/meetings/${window.location.pathname.split('/').filter(Boolean).pop()}/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, teamMemberId: dbUser.id, pageUrl: pageUrlStr })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(`Recording failed: ${data.error}`);
        setIsRecording(action === 'stop'); // revert
      } else {
        console.log(`Recording ${action} successful`, data);
      }
    } catch (e) {
      console.error(e);
      alert('Network error while toggling recording');
      setIsRecording(action === 'stop'); // revert
    }
  };

  React.useEffect(() => {
    if (navigator.mediaDevices && (navigator.mediaDevices as any).setCaptureHandleConfig) {
      try {
        (navigator.mediaDevices as any).setCaptureHandleConfig({
          handle: 'kloudmeet',
          exposeOrigin: true,
          permittedOrigins: ['*'],
        });
      } catch (e) {
        console.warn('Capture Handle Config failed', e);
      }
    }
  }, []);

  const roomOptions = React.useMemo((): RoomOptions => {
    let videoCodec: VideoCodec | undefined = props.options.codec ? props.options.codec : 'vp9';
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
      videoCodec = undefined;
    }
    const videoCaptureDefaults: VideoCaptureOptions = {
      deviceId: props.userChoices.videoDeviceId ?? undefined,
      resolution: props.options.hq ? VideoPresets.h2160 : VideoPresets.h720,
    };
    const publishDefaults: TrackPublishDefaults = {
      dtx: false,
      videoSimulcastLayers: props.options.hq
        ? [VideoPresets.h1080, VideoPresets.h720]
        : [VideoPresets.h540, VideoPresets.h216],
      red: !e2eeEnabled,
      videoCodec,
    };
    return {
      videoCaptureDefaults: videoCaptureDefaults,
      publishDefaults: publishDefaults,
      audioCaptureDefaults: {
        deviceId: props.userChoices.audioDeviceId ?? undefined,
      },
      adaptiveStream: true,
      dynacast: true,
      e2ee: keyProvider && worker && e2eeEnabled ? { keyProvider, worker } : undefined,
      singlePeerConnection: true,
    };
  }, [props.userChoices, props.options.hq, props.options.codec]);

  const room = React.useMemo(() => new Room(roomOptions), []);

  // Check for any active screen share tracks in the room
  const screenShareTracks = useTracks([Track.Source.ScreenShare], { room });
  const hasScreenShare = screenShareTracks.length > 0;

  // 手机端观看他人共享时默认折叠头像栏，优先看到共享画面
  React.useEffect(() => {
    if (isToolbarMobile && hasScreenShare && !screenShareActive) {
      setIsWebcamSidebarCollapsed(true);
    }
  }, [isToolbarMobile, hasScreenShare, screenShareActive]);

  // Auto-collapse webcam sidebar when entering remote control mode for maximum screen visibility
  React.useEffect(() => {
    if (isRemoteControlMode && hasScreenShare) {
      setIsWebcamSidebarCollapsed(true);
    }
  }, [isRemoteControlMode, hasScreenShare]);

  // 手机端检测：屏幕共享出现时，尝试自动 play 所有视频；如果被浏览器拒绝（微信等），显示「点击播放」按钮
  React.useEffect(() => {
    if (!isToolbarMobile || !hasScreenShare || screenShareActive) {
      setNeedsPlayTap(false);
      return;
    }
    // 短暂等待 LiveKit 把 video 元素渲染出来
    const timer = setTimeout(() => {
      const videos = Array.from(document.querySelectorAll('video'));
      if (videos.length === 0) { setNeedsPlayTap(true); return; }
      // 尝试 play，如果所有 video 都已经在播放则不需要显示按钮
      const allPlaying = videos.every((v) => !v.paused);
      if (allPlaying) { setNeedsPlayTap(false); return; }
      // 尝试静默 play
      Promise.all(videos.map((v) => v.play().catch(() => null)))
        .then(() => {
          const stillPaused = videos.some((v) => v.paused);
          setNeedsPlayTap(stillPaused);
        })
        .catch(() => setNeedsPlayTap(true));
    }, 800);
    return () => clearTimeout(timer);
  }, [isToolbarMobile, hasScreenShare, screenShareActive]);

  // React to screen share status logic automatically
  React.useEffect(() => {
    if (hasScreenShare) {
      if (screenShareActive) {
        // Reset detection flag — mirror-block won't activate until detection completes
        setSurfaceDetected(false);
        setTimeout(() => {
          const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
          if (pub && pub.track) {
            const nativeStr = pub.track.mediaStreamTrack;
            if (nativeStr) {
              const settings = nativeStr.getSettings();
              let surf = (settings.displaySurface as any) || 'unknown';
              if ((nativeStr as any).getCaptureHandle) {
                const handle = (nativeStr as any).getCaptureHandle();
                if (handle && handle.handle === 'kloudmeet') {
                  surf = 'current-tab';
                }
              }
              setScreenShareSurface(surf);
              setSurfaceDetected(true);
            } else {
              setSurfaceDetected(true);
            }
          } else {
            setSurfaceDetected(true);
          }
        }, 500);
      } else {
        setScreenShareSurface('unknown');
        setSurfaceDetected(false);
      }
      setActiveView('shareScreen');
      // Broadcast to all: switch to shareScreen view
      if (screenShareActive) {
        broadcastViewChangeRef.current?.('shareScreen');
      }
    } else {
      setScreenShareActive(false);
      setIsDrawingMode(false);
      setIsRemoteControlMode(false);
      setScreenShareSurface('unknown');
      setSurfaceDetected(false);
      setActiveView((prev) => {
        if (prev === 'shareScreen') {
          // Broadcast fallback to webcam
          broadcastViewChangeRef.current?.('webcam');
          return 'webcam';
        }
        return prev;
      });
    }
  }, [hasScreenShare, screenShareActive, room.localParticipant]);

  // Ref for broadcast function (defined later in DataChannel sync block)
  const broadcastViewChangeRef = React.useRef<((view: ViewMode) => void) | null>(null);

  const handleViewChange = React.useCallback(
    (view: ViewMode) => {
      if (view !== 'shareScreen') {
        setIsDrawingMode(false);
        setIsRemoteControlMode(false);
        if (screenShareActive) {
          setScreenShareActive(false);
          room.localParticipant.setScreenShareEnabled(false).catch(console.error);
        }
      }
      setActiveView(view);
      // Broadcast view change to all participants
      broadcastViewChangeRef.current?.(view);
    },
    [screenShareActive, room],
  );

  React.useEffect(() => {
    if (e2eeEnabled) {
      keyProvider
        .setKey(decodePassphrase(e2eePassphrase))
        .then(() => {
          room.setE2EEEnabled(true).catch((e) => {
            if (e instanceof DeviceUnsupportedError) {
              alert(
                `You're trying to join an encrypted meeting, but your browser does not support it. Please update it to the latest version and try again.`,
              );
              console.error(e);
            } else {
              throw e;
            }
          });
        })
        .then(() => setE2eeSetupComplete(true));
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, room, e2eePassphrase]);

  const connectOptions = React.useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  React.useEffect(() => {
    room.on(RoomEvent.Disconnected, handleOnLeave);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleError);

    if (e2eeSetupComplete) {
      room
        .connect(
          props.connectionDetails.serverUrl,
          props.connectionDetails.participantToken,
          connectOptions,
        )
        .then(() => {
          if (isActionStart) {
            const wasRefresh = typeof window !== 'undefined' && sessionStorage.getItem('activeKloudRoom') === window.location.pathname.split('/').filter(Boolean).pop();
            if (!wasRefresh) setShowMeetingReadyModal(true);
          }
          // Auto-copy the meeting link to clipboard when joining to make it easy to invite others,
          // especially if the app goes to the background during screen sharing.
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(window.location.href).catch(console.error);
            console.log('Meeting URL auto-copied to clipboard!');
          }

          // Fallback: Set actualStartedAt via API in case LiveKit webhook isn't configured
          const rn = props.connectionDetails.roomName;
          fetch(`/api/meetings/${rn}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actualStartedAt: new Date().toISOString() }),
          }).catch(e => console.warn('[meeting start fallback] failed', e));
        })
        .catch((error) => {
          handleError(error);
        });
      if (props.userChoices.videoEnabled) {
        room.localParticipant.setCameraEnabled(true).catch((error) => {
          handleError(error);
        });
      }
      if (props.userChoices.audioEnabled) {
        room.localParticipant.setMicrophoneEnabled(true).catch((error) => {
          handleError(error);
        });
      }
    }
    return () => {
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
    };
  }, [e2eeSetupComplete, room, props.connectionDetails, props.userChoices]);

  const lowPowerMode = useLowCPUOptimizer(room);

  const router = useRouter();
  const handleOnLeave = React.useCallback(() => {
    router.push('/');
  }, [router]);
  const handleError = React.useCallback((error: Error) => {
    // Ignore user cancellation errors (like declining screen share)
    if (
      error.name === 'NotAllowedError' ||
      error.message?.toLowerCase().includes('permission') ||
      error.message?.toLowerCase().includes('notallowed')
    ) {
      console.warn('User cancelled or denied media request:', error);
      return;
    }

    console.error(error);
    alert(`Encountered an unexpected error, check the console logs for details: ${error.message}`);
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    alert(
      `Encountered an unexpected encryption error, check the console logs for details: ${error.message}`,
    );
  }, []);

  React.useEffect(() => {
    if (lowPowerMode) {
      console.warn('Low power mode enabled');
    }
  }, [lowPowerMode]);

  // ── 手机息屏恢复音频 ──
  // iOS/Android 浏览器在息屏或切后台时会 suspend AudioContext，
  // 当页面重新可见时，调用 room.startAudio() 恢复音频播放。
  React.useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        try {
          await room.startAudio();
          console.log('[KloudMeet] Audio resumed after visibility change');
        } catch (e) {
          console.warn('[KloudMeet] Audio resume after screen-on failed:', e);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [room]);

  // ── Wake Lock: 防止手机息屏中断音频 ──
  // 在支持 Wake Lock API 的浏览器上，保持屏幕唤醒以避免
  // AudioContext 被系统挂起。如果 Wake Lock 被释放（如切后台），
  // 页面恢复可见时自动重新获取。
  React.useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    let cancelled = false;

    const requestWakeLock = async () => {
      if (cancelled || !('wakeLock' in navigator)) return;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          console.log('[KloudMeet] Wake Lock released');
        });
        console.log('[KloudMeet] Wake Lock acquired');
      } catch (e) {
        console.warn('[KloudMeet] Wake Lock request failed:', e);
      }
    };

    // 页面恢复可见时重新获取 Wake Lock（iOS Safari / Android Chrome 切后台后会自动释放）
    const handleVisibilityForWakeLock = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityForWakeLock);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityForWakeLock);
      if (wakeLock) {
        wakeLock.release().catch(() => { });
      }
    };
  }, []);

  // ── 静音音频保活：防止 iOS Safari 息屏时挂起 WebRTC ──
  // iOS Safari（以及部分 Android 浏览器）在息屏后会暂停页面中所有音频。
  // 通过在一个隐藏的 <audio> 元素中循环播放极短的静音音频，
  // 可以保持浏览器的音频会话处于激活状态，从而让 WebRTC 的音频流持续工作。
  // 这样即使息屏，双方也能继续听到对方说话。
  React.useEffect(() => {
    // 1秒静音 WAV：44字节 WAV 头 + 8000个零采样（8kHz mono 8-bit, ~1 秒）
    // 用 base64 data URL 避免额外文件请求
    const createSilentWav = (): string => {
      const sampleRate = 8000;
      const numSamples = sampleRate; // 1 second
      const bitsPerSample = 8;
      const numChannels = 1;
      const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
      const blockAlign = numChannels * (bitsPerSample / 8);
      const dataSize = numSamples * numChannels * (bitsPerSample / 8);
      const headerSize = 44;
      const buffer = new ArrayBuffer(headerSize + dataSize);
      const view = new DataView(buffer);

      // RIFF header
      const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
          view.setUint8(offset + i, str.charCodeAt(i));
        }
      };
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true); // chunk size
      view.setUint16(20, 1, true);  // PCM
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, bitsPerSample, true);
      writeString(36, 'data');
      view.setUint32(40, dataSize, true);

      // 静音数据（8-bit PCM 的静音值是 128）
      for (let i = 0; i < dataSize; i++) {
        view.setUint8(headerSize + i, 128);
      }

      // 转 base64
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return 'data:audio/wav;base64,' + btoa(binary);
    };

    let audio: HTMLAudioElement | null = null;
    let started = false;

    const startKeepAlive = () => {
      if (started) return;
      started = true;
      try {
        audio = new Audio(createSilentWav());
        audio.loop = true;
        audio.volume = 0.01; // 几乎静音，但非零以保持音频会话
        // Safari 需要 playsinline
        audio.setAttribute('playsinline', 'true');
        audio.setAttribute('webkit-playsinline', 'true');
        audio.play().then(() => {
          console.log('[KloudMeet] Silent audio keep-alive started');
        }).catch((e) => {
          console.warn('[KloudMeet] Silent audio keep-alive autoplay blocked:', e);
          started = false;
        });
      } catch (e) {
        console.warn('[KloudMeet] Silent audio keep-alive creation failed:', e);
        started = false;
      }
    };

    // 进入会议后立即尝试播放（此时已有用户交互，一般不会被阻止）
    startKeepAlive();

    // 如果第一次被 autoplay policy 阻止，下一次用户交互时重试
    const retryOnInteraction = () => {
      if (!started) {
        startKeepAlive();
      }
    };
    document.addEventListener('click', retryOnInteraction, { once: true });
    document.addEventListener('touchstart', retryOnInteraction, { once: true });

    // 页面恢复可见时确保还在播放
    const handleVisibilityForKeepAlive = () => {
      if (document.visibilityState === 'visible' && audio) {
        if (audio.paused) {
          audio.play().catch(() => { });
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityForKeepAlive);

    return () => {
      document.removeEventListener('click', retryOnInteraction);
      document.removeEventListener('touchstart', retryOnInteraction);
      document.removeEventListener('visibilitychange', handleVisibilityForKeepAlive);
      if (audio) {
        audio.pause();
        audio.src = '';
        audio = null;
      }
    };
  }, []);

  // Modify video elements globally:
  // 1. Force disable native PiP overlays (e.g. Firefox)
  // 2. Add properties specifically for WeChat / X5 engine to support inline viewing
  React.useEffect(() => {
    const patchVideoElements = () => {
      document.querySelectorAll('video').forEach((video) => {
        if (!video.hasAttribute('disablePictureInPicture')) video.setAttribute('disablePictureInPicture', 'true');
        // WeChat & Mobile browser specific attributes to ensure screen shares (and normal video) play inline
        if (!video.hasAttribute('playsinline')) video.setAttribute('playsinline', 'true');
        if (!video.hasAttribute('webkit-playsinline')) video.setAttribute('webkit-playsinline', 'true');
        if (!video.hasAttribute('x5-playsinline')) video.setAttribute('x5-playsinline', 'true');
        if (!video.hasAttribute('x5-video-player-type')) video.setAttribute('x5-video-player-type', 'h5');
      });
    };
    patchVideoElements();
    const observer = new MutationObserver(patchVideoElements);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const handleToggleMic = React.useCallback(() => {
    const next = !micEnabled;
    setMicEnabled(next);
    room.localParticipant.setMicrophoneEnabled(next).catch(handleError);
  }, [micEnabled, room]);

  const handleToggleCam = React.useCallback(() => {
    const next = !camEnabled;
    setCamEnabled(next);
    room.localParticipant.setCameraEnabled(next).catch(handleError);
  }, [camEnabled, room]);

  const handleShareScreen = React.useCallback(() => {
    // Mobile browsers can't do screen share — show a warning toast
    if (isToolbarMobile) {
      alert('Use Kloud Meet App to be able to do screenshare.');
      return;
    }

    // If someone else is actively sharing, we cannot share
    if (hasScreenShare && !screenShareActive) {
      alert('Only one person can share their screen at a time.');
      return;
    }

    const next = !screenShareActive;
    setScreenShareActive(next);

    room.localParticipant.setScreenShareEnabled(next).catch((e) => {
      setScreenShareActive(false);
      console.error(e);
    });
  }, [screenShareActive, room, hasScreenShare, isToolbarMobile]);

  // Leave: just disconnect without ending the meeting for everyone
  const handleLeave = React.useCallback(() => {
    room.disconnect();
    router.push('/');
  }, [room, router]);


  const isPresenterScreencast = screenShareActive;
  const isPureLiveDoc = activeView === 'liveDoc';
  // Mirror-blocked: presenter is sharing AND surface detected AND it's NOT a safe "browser tab" share
  const isMirrorBlocked = screenShareActive && surfaceDetected && screenShareSurface !== 'browser';

  // Determine host: override (from transfer) takes precedence over join-time computation
  const [hostIdentityOverride, setHostIdentityOverride] = React.useState<string | null>(null);
  const [hostIdentityFromJoin, setHostIdentityFromJoin] = React.useState<string>(
    room.localParticipant.identity,
  );

  // Recompute host from join times whenever participants change
  React.useEffect(() => {
    const recompute = () => {
      // Only one person in the meeting? They're the host, period.
      if (room.remoteParticipants.size === 0) {
        setHostIdentityFromJoin(room.localParticipant.identity);
        return;
      }
      // Multiple participants: earliest joiner is host
      let earliest = room.localParticipant.joinedAt?.getTime() || Infinity;
      let hId = room.localParticipant.identity;
      for (const [, p] of room.remoteParticipants) {
        const t = p.joinedAt?.getTime() || Infinity;
        if (t < earliest) {
          earliest = t;
          hId = p.identity;
        }
      }
      setHostIdentityFromJoin(hId);
    };
    // Compute immediately
    recompute();
    // Safety: recompute after a short delay (joinedAt may not be populated yet)
    const timer = setTimeout(recompute, 1000);
    // Re-compute on key room events
    room.on(RoomEvent.Connected, recompute);
    room.on(RoomEvent.ParticipantConnected, recompute);
    room.on(RoomEvent.ParticipantDisconnected, recompute);
    return () => {
      clearTimeout(timer);
      room.off(RoomEvent.Connected, recompute);
      room.off(RoomEvent.ParticipantConnected, recompute);
      room.off(RoomEvent.ParticipantDisconnected, recompute);
    };
  }, [room]);

  const hostIdentity = hostIdentityOverride || hostIdentityFromJoin;
  const isHost = hostIdentity === room.localParticipant.identity;
  const [copresenterIdentities, setCopresenterIdentities] = React.useState<string[]>([]);
  const isCopresenter = copresenterIdentities.includes(room.localParticipant.identity);
  const [cohostIdentities, setCohostIdentities] = React.useState<string[]>([]);
  const isCohost = cohostIdentities.includes(room.localParticipant.identity);
  // Auto-assign Presenter: whoever owns the active screen share track
  const autoPresenterIdentity = screenShareTracks.length > 0
    ? (screenShareTracks[0].participant?.identity ?? null)
    : null;
  const isAutoPresenter = autoPresenterIdentity === room.localParticipant.identity;
  // Interactive meetings: everyone can switch views by default
  const canSwitchViews = true;

  const meetingRoomName = props.connectionDetails.roomName;
  const [livedocInstanceId, setLivedocInstanceId] = React.useState<string | null>(null);
  const [livedocInitError, setLivedocInitError] = React.useState<string | null>(null);
  const [livedocInitInProgress, setLivedocInitInProgress] = React.useState(false);
  const [livekitConnected, setLivekitConnected] = React.useState(false);
  const livedocHostBootstrappedRef = React.useRef(false);

  React.useEffect(() => {
    const onConnected = () => setLivekitConnected(true);
    const onDisconnected = () => {
      setLivekitConnected(false);
      livedocHostBootstrappedRef.current = false;
    };
    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    if (room.state === ConnectionState.Connected) {
      setLivekitConnected(true);
    }
    return () => {
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room]);

  // ═══ Meeting Control Sync via DataChannel ═══
  const TOPIC = 'meeting-control';
  const encoder = React.useMemo(() => new TextEncoder(), []);
  const decoder = React.useMemo(() => new TextDecoder(), []);

  // Host's authoritative state (only used when isHost)
  const authState = React.useRef<{
    view: ViewMode;
    presenter: string | null;
    livedocInstanceId: string | null;
  }>({
    view: activeView,
    presenter: null,
    livedocInstanceId: null,
  });

  // Keep authState in sync when host changes view locally
  React.useEffect(() => {
    if (isHost) {
      authState.current.view = activeView;
    }
  }, [isHost, activeView]);

  React.useEffect(() => {
    if (isHost) {
      authState.current.livedocInstanceId = livedocInstanceId;
    }
  }, [isHost, livedocInstanceId]);

  // Helper: send a meeting control message
  const sendMeetingMsg = React.useCallback(
    (msg: object, destinationIdentities?: string[]) => {
      const data = encoder.encode(JSON.stringify(msg));
      const opts: any = { reliable: true, topic: TOPIC };
      if (destinationIdentities) {
        opts.destinationIdentities = destinationIdentities;
      }
      room.localParticipant.publishData(data, opts).catch(() => {
        room.localParticipant
          .publishData(data, {
            topic: TOPIC,
            ...(destinationIdentities ? { destinationIdentities } : {}),
          })
          .catch(console.error);
      });
    },
    [room, encoder],
  );

  // End for All (host/co-host only): broadcast END_MEETING, mark as ended in DB, then disconnect
  const handleEndForAll = React.useCallback(async () => {
    // Notify all participants to leave via DataChannel
    sendMeetingMsg({ type: 'END_MEETING' });

    const rn = window.location.pathname.split('/').filter(Boolean).pop() || '';
    try {
      await fetch(`/api/meetings/${rn}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endedAt: new Date().toISOString() }),
      });
    } catch (e) {
      console.warn('[meeting end] failed', e);
    }
    // Small delay to allow the DataChannel message to propagate
    await new Promise((r) => setTimeout(r, 300));
    room.disconnect();
    router.push('/');
  }, [room, router, sendMeetingMsg]);

  // Host: anonymous token + LiveDoc instance, then broadcast id to the room
  React.useEffect(() => {
    if (!livekitConnected || !isHost) return;
    if (livedocHostBootstrappedRef.current) return;
    let cancelled = false;
    (async () => {
      setLivedocInitInProgress(true);
      setLivedocInitError(null);
      try {
        const userToken = await createOrUpdateInstantAccount(props.userChoices.username);
        const id = await createLivedocInstance({
          userToken,
          jitsiInstanceId: meetingRoomName,
        });
        if (cancelled) return;
        livedocHostBootstrappedRef.current = true;
        setLivedocInstanceId(id);
        authState.current.livedocInstanceId = id;
        sendMeetingMsg({ type: 'LIVEDOC_INSTANCE', livedocInstanceId: id });
      } catch (e) {
        if (!cancelled) {
          livedocHostBootstrappedRef.current = true;
          setLivedocInitError((e as Error).message ?? String(e));
        }
      } finally {
        if (!cancelled) {
          setLivedocInitInProgress(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [livekitConnected, isHost, meetingRoomName, props.userChoices.username, sendMeetingMsg]);

  React.useEffect(() => {
    if (!isHost) return;
    const handler = (participant: RemoteParticipant) => {
      const id = authState.current.livedocInstanceId;
      if (id) {
        sendMeetingMsg({ type: 'LIVEDOC_INSTANCE', livedocInstanceId: id }, [participant.identity]);
      }
    };
    room.on(RoomEvent.ParticipantConnected, handler);
    return () => {
      room.off(RoomEvent.ParticipantConnected, handler);
    };
  }, [room, isHost, sendMeetingMsg]);

  // Host/Presenter: broadcast VIEW_CHANGE to all participants
  const broadcastViewChange = React.useCallback(
    (view: ViewMode) => {
      if (isHost) {
        authState.current.view = view;
      }
      sendMeetingMsg({ type: 'VIEW_CHANGE', view });
    },
    [isHost, sendMeetingMsg],
  );

  // Keep the ref in sync for handleViewChange
  React.useEffect(() => {
    broadcastViewChangeRef.current = broadcastViewChange;
  }, [broadcastViewChange]);

  // Listen for incoming DataChannel messages
  React.useEffect(() => {
    const handleData = (payload: Uint8Array, participant?: any, kind?: any, topic?: string) => {
      if (topic !== TOPIC) return;
      try {
        const msg = JSON.parse(decoder.decode(payload));
        const senderIdentity = participant?.identity;

        if (msg.type === 'VIEW_CHANGE') {
          // View change from host/presenter — update immediately
          setActiveView(msg.view as ViewMode);
        } else if (msg.type === 'LIVEDOC_INSTANCE' && typeof msg.livedocInstanceId === 'string') {
          setLivedocInstanceId(msg.livedocInstanceId);
        } else if (msg.type === 'CORRECTION') {
          // Correction from host — update to authoritative state
          setActiveView(msg.view as ViewMode);
          if (msg.presenter !== undefined) {
            setCopresenterIdentities(Array.isArray(msg.presenter) ? msg.presenter : msg.presenter ? [msg.presenter] : []);
          }
          if (typeof (msg as { livedocInstanceId?: string }).livedocInstanceId === 'string') {
            setLivedocInstanceId((msg as { livedocInstanceId: string }).livedocInstanceId);
          }
        } else if (msg.type === 'SET_PRESENTER') {
          if (msg.identity) {
            setCopresenterIdentities((prev) =>
              prev.includes(msg.identity) ? prev : [...prev, msg.identity],
            );
          }
        } else if (msg.type === 'REMOVE_PRESENTER') {
          setCopresenterIdentities((prev) => prev.filter((id) => id !== msg.identity));
        } else if (msg.type === 'SET_COHOST') {
          setCohostIdentities((prev) =>
            prev.includes(msg.identity) ? prev : [...prev, msg.identity],
          );
        } else if (msg.type === 'REMOVE_COHOST') {
          setCohostIdentities((prev) => prev.filter((id) => id !== msg.identity));
        } else if (msg.type === 'SET_HOST') {
          // Host transfer: set the override so all clients agree on new host
          if (msg.newHostIdentity && msg.oldHostIdentity) {
            setHostIdentityOverride(msg.newHostIdentity);
            // The old host becomes co-host automatically
            setCohostIdentities((prev) => {
              const without = prev.filter((id) => id !== msg.newHostIdentity);
              if (!without.includes(msg.oldHostIdentity)) {
                return [...without, msg.oldHostIdentity];
              }
              return without;
            });
          }
        } else if (msg.type === 'END_MEETING') {
          // Host/Co-host ended the meeting for everyone — disconnect and redirect
          room.disconnect();
          router.push('/');
        } else if (msg.type === 'RC_REQUEST') {
          // Remote Control: someone is requesting control of our screen
          if (screenShareActive) {
            if (approvedControllerIdentity) {
              // Already have a controller — auto-deny
              sendMeetingMsg({ type: 'RC_DENIED', requesterIdentity: msg.requesterIdentity, requesterName: msg.requesterName });
            } else {
              setRemoteControlRequest({ requesterIdentity: msg.requesterIdentity, requesterName: msg.requesterName });
            }
          }
        } else if (msg.type === 'RC_APPROVED') {
          if (msg.requesterIdentity === room.localParticipant.identity) {
            setRemoteControlPending(false);
            setIsRemoteControlMode(true);
            setIsDrawingMode(false);
          }
        } else if (msg.type === 'RC_DENIED') {
          if (msg.requesterIdentity === room.localParticipant.identity) {
            setRemoteControlPending(false);
          }
        } else if (msg.type === 'RC_REVOKED') {
          if (msg.requesterIdentity === room.localParticipant.identity) {
            setIsRemoteControlMode(false);
            setRemoteControlPending(false);
          }
        } else if (msg.type === 'RC_CANCELLED') {
          if (remoteControlRequest?.requesterIdentity === msg.requesterIdentity) {
            setRemoteControlRequest(null);
          }
        } else if (msg.type === 'HEARTBEAT' && isHost && senderIdentity) {
          // Host receives heartbeat — compare and correct if needed
          const auth = authState.current;
          const guestDoc = (msg as { livedocInstanceId?: string | null }).livedocInstanceId ?? null;
          const authDoc = auth.livedocInstanceId ?? null;
          const livedocMismatch =
            (authDoc !== null && guestDoc !== authDoc) || (authDoc !== null && guestDoc === null);
          if (
            msg.view !== auth.view ||
            msg.presenter !== (auth.presenter || null) ||
            livedocMismatch
          ) {
            sendMeetingMsg(
              {
                type: 'CORRECTION',
                view: auth.view,
                presenter: auth.presenter,
                livedocInstanceId: auth.livedocInstanceId,
              },
              [senderIdentity],
            );
          }
        }
      } catch (e) {
        console.error('Meeting control message error:', e);
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room, isHost, decoder, sendMeetingMsg, screenShareActive, approvedControllerIdentity, remoteControlRequest]);

  // ═══ Remote Control Permission (uses meeting-control topic) ═══

  // Clear all remote control permission state when screen share ends
  React.useEffect(() => {
    if (!hasScreenShare) {
      setRemoteControlPending(false);
      setRemoteControlRequest(null);
      setApprovedControllerIdentity(null);
    }
  }, [hasScreenShare]);

  // Presenter approves a remote control request
  const handleApproveRcRequest = React.useCallback(
    (identity: string) => {
      setApprovedControllerIdentity(identity);
      setRemoteControlRequest(null);
      sendMeetingMsg(
        { type: 'RC_APPROVED', requesterIdentity: identity, requesterName: '' },
      );
    },
    [sendMeetingMsg],
  );

  // Presenter denies a remote control request
  const handleDenyRcRequest = React.useCallback(
    (identity: string) => {
      setRemoteControlRequest(null);
      sendMeetingMsg(
        { type: 'RC_DENIED', requesterIdentity: identity, requesterName: '' },
      );
    },
    [sendMeetingMsg],
  );

  // All participants: send heartbeat every 5s
  React.useEffect(() => {
    if (!room.localParticipant.identity) return;

    // Find host identity (earliest joiner)
    const getHostIdentity = () => {
      let earliestTime = room.localParticipant.joinedAt?.getTime() || Infinity;
      let hostId = room.localParticipant.identity;
      for (const [, p] of room.remoteParticipants) {
        const t = p.joinedAt?.getTime() || Infinity;
        if (t < earliestTime) {
          earliestTime = t;
          hostId = p.identity;
        }
      }
      return hostId;
    };

    const interval = setInterval(() => {
      const hostId = getHostIdentity();
      if (hostId === room.localParticipant.identity) return; // host doesn't heartbeat to itself
      sendMeetingMsg(
        {
          type: 'HEARTBEAT',
          view: activeView,
          presenters: copresenterIdentities,
          identity: room.localParticipant.identity,
          livedocInstanceId,
        },
        [hostId],
      );
    }, 5000);

    return () => clearInterval(interval);
  }, [room, activeView, copresenterIdentities, livedocInstanceId, sendMeetingMsg]);

  // Draggable floating webcam panel state
  const floatingRef = React.useRef<HTMLDivElement>(null);
  const [floatingPos, setFloatingPos] = React.useState({ x: 12, y: 12 });
  const [floatingExpanded, setFloatingExpanded] = React.useState(false);
  const isDragging = React.useRef(false);
  const dragOffset = React.useRef({ x: 0, y: 0 });

  const handleFloatingMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      dragOffset.current = { x: e.clientX - floatingPos.x, y: e.clientY - floatingPos.y };
      e.preventDefault();
    },
    [floatingPos],
  );

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      setFloatingPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
    };
    const handleMouseUp = () => {
      isDragging.current = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Chat + Attendee overlay state
  const [chatOpen, setChatOpen] = React.useState(false);
  const [attendeeOpen, setAttendeeOpen] = React.useState(false);

  // Chat messages — always listening (even when panel is closed)
  const CHAT_TOPIC = 'kloud-chat';
  const chatEncoder = React.useMemo(() => new TextEncoder(), []);
  const chatDecoder = React.useMemo(() => new TextDecoder(), []);
  const [chatMessages, setChatMessages] = React.useState<
    Array<{
      senderIdentity: string;
      senderName: string;
      message: string;
      timestamp: number;
      isLocal: boolean;
    }>
  >([]);

  React.useEffect(() => {
    const handleChatData = (payload: Uint8Array, participant?: any, kind?: any, topic?: string) => {
      if (topic !== CHAT_TOPIC) return;
      try {
        const data = JSON.parse(chatDecoder.decode(payload));
        if (data.type === 'chat') {
          setChatMessages((prev) => [
            ...prev,
            {
              senderIdentity: data.senderIdentity,
              senderName: data.senderName,
              message: data.message,
              timestamp: data.timestamp,
              isLocal: false,
            },
          ]);
        }
      } catch (e) {
        console.error('Chat message parse error:', e);
      }
    };
    room.on(RoomEvent.DataReceived, handleChatData);
    return () => {
      room.off(RoomEvent.DataReceived, handleChatData);
    };
  }, [room, chatDecoder]);

  const sendChatMessage = React.useCallback(
    (text: string) => {
      const now = Date.now();
      setChatMessages((prev) => [
        ...prev,
        {
          senderIdentity: room.localParticipant.identity,
          senderName: room.localParticipant.name || room.localParticipant.identity || 'You',
          message: text,
          timestamp: now,
          isLocal: true,
        },
      ]);
      const payload = chatEncoder.encode(
        JSON.stringify({
          type: 'chat',
          senderIdentity: room.localParticipant.identity,
          senderName: room.localParticipant.name || room.localParticipant.identity || 'You',
          message: text,
          timestamp: now,
        }),
      );
      room.localParticipant
        .publishData(payload, { reliable: true, topic: CHAT_TOPIC })
        .catch(() => {
          room.localParticipant.publishData(payload, { topic: CHAT_TOPIC }).catch(console.error);
        });
    },
    [room, chatEncoder],
  );

  return (
    <div className="lk-room-container" style={{ position: 'relative', height: '100%' }}>
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />

        {/* Remote Control approval dialog — rendered at top level to avoid overflow clipping */}
        {remoteControlRequest && screenShareActive && (
          <div
            id="rc-approval-dialog"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'auto',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,0.35)',
                backdropFilter: 'blur(2px)',
                WebkitBackdropFilter: 'blur(2px)',
              }}
              onClick={() => handleDenyRcRequest(remoteControlRequest.requesterIdentity)}
            />
            <div
              style={{
                position: 'relative',
                zIndex: 1,
                background: 'linear-gradient(145deg, #1e1e2e, #252538)',
                borderRadius: '16px',
                padding: '28px 32px',
                minWidth: '340px',
                maxWidth: '420px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(139,92,246,0.15)',
                border: '1px solid rgba(255,255,255,0.08)',
                fontFamily: "'Inter', sans-serif",
                animation: 'rcPermDialogIn 0.25s ease',
              }}
            >
              <style>{`
                @keyframes rcPermDialogIn {
                  from { opacity: 0; transform: scale(0.92) translateY(8px); }
                  to { opacity: 1; transform: scale(1) translateY(0); }
                }
                @keyframes rcPermPulse {
                  0%, 100% { box-shadow: 0 0 0 0 rgba(139,92,246,0.4); }
                  50% { box-shadow: 0 0 0 8px rgba(139,92,246,0); }
                }
              `}</style>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    animation: 'rcPermPulse 2s ease infinite',
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" width="22" height="22">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zm-7.518-.267A8.25 8.25 0 1120.25 10.5M8.288 14.212A5.25 5.25 0 1117.25 10.5" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#f1f1f4' }}>
                    Remote Control Request
                  </div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                    Screen sharing permission
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '14px', color: '#d1d5db', lineHeight: 1.6, marginBottom: '24px' }}>
                <strong style={{ color: '#c4b5fd' }}>{remoteControlRequest.requesterName || remoteControlRequest.requesterIdentity}</strong>{' '}
                is requesting to control your shared screen.
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => handleDenyRcRequest(remoteControlRequest.requesterIdentity)}
                  style={{
                    padding: '8px 20px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.06)',
                    color: '#d1d5db',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    fontFamily: "'Inter', sans-serif",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(239,68,68,0.15)';
                    e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)';
                    e.currentTarget.style.color = '#fca5a5';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                    e.currentTarget.style.color = '#d1d5db';
                  }}
                >
                  Decline
                </button>
                <button
                  onClick={() => handleApproveRcRequest(remoteControlRequest.requesterIdentity)}
                  style={{
                    padding: '8px 20px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    fontFamily: "'Inter', sans-serif",
                    boxShadow: '0 2px 10px rgba(124,58,237,0.3)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, #6d28d9, #4c1d95)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, #7c3aed, #5b21b6)';
                  }}
                >
                  Allow Control
                </button>
              </div>
            </div>
          </div>
        )}

        {/* View content area */}
        <div
          className="main-meeting-area"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            overflow: 'hidden',
            display: 'flex',
          }}
        >
          {/* Standalone LiveDoc (when user clicks LiveDoc tab, no screen share) */}
          {isPureLiveDoc && !hasScreenShare && (
            <div style={{ flex: 1, position: 'relative', overflow: 'auto' }}>
              <LiveDocView
                meetingRoomName={meetingRoomName}
                participantName={props.userChoices.username}
                livedocInstanceId={livedocInstanceId}
                hostInitError={livedocInitError}
                hostInitInProgress={livedocInitInProgress}
                isHost={isHost}
              />
            </div>
          )}

          {/* VideoConference: always visible when not in pure LiveDoc mode */}
          <div
            className={`sky-meet-video-wrapper ${isWebcamSidebarCollapsed ? 'sidebar-collapsed' : ''} ${screenShareActive ? 'presenter-sharing' : ''} ${isMirrorBlocked ? 'mirror-blocked' : ''}`}
            style={{
              flex: 1,
              position: 'relative',
              display: isPureLiveDoc && !hasScreenShare ? 'none' : 'block',
            }}
          >
            {isToolbarMobile && activeView === 'webcam' && !hasScreenShare ? (
              <MobileVideoLayout />
            ) : (
              <VideoConference
                chatMessageFormatter={formatChatMessageLinks}
                SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
              />
            )}

            {/* Mirror-blocked: overlay LiveDoc on top of the entire screenshare view */}
            {hasScreenShare && isMirrorBlocked && (
              <div
                className="mirror-livedoc-overlay"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 50,
                  overflow: 'auto',
                  background: '#f5f5f5',
                }}
              >
                <LiveDocView
                  meetingRoomName={meetingRoomName}
                  participantName={props.userChoices.username}
                  livedocInstanceId={livedocInstanceId}
                  hostInitError={livedocInitError}
                  hostInitInProgress={livedocInitInProgress}
                  isHost={isHost}
                />
              </div>
            )}

            {/* Safe preview badge (hidden during remote control for clear view) */}
            {hasScreenShare && activeView === 'shareScreen' && !isMirrorBlocked && !isRemoteControlMode && (
              <div className="screenshare-overlay-container">
                <div className="screenshare-overlay-badge">
                  {(() => {
                    if (screenShareActive) return t('toolbar.previewAnotherTab');
                    const sharing = Array.from(room.remoteParticipants.values()).find(p => p.isScreenShareEnabled);
                    const name = sharing?.name || sharing?.identity || 'Attendee';
                    return t('toolbar.viewingAttendeeScreen', { name });
                  })()}
                </div>
              </div>
            )}

            {/* 微信/手机浏览器「点击播放」按钮 —— 自动播放被拒绝时显示 */}
            {needsPlayTap && hasScreenShare && !screenShareActive && isToolbarMobile && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 12000,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0,0,0,0.55)',
                  backdropFilter: 'blur(4px)',
                  WebkitBackdropFilter: 'blur(4px)',
                }}
              >
                <button
                  onClick={() => {
                    // 强制 play 页面上所有视频（需要在用户点击事件内触发，微信才会允许）
                    document.querySelectorAll('video').forEach((v) => {
                      v.play().catch(() => null);
                    });
                    setNeedsPlayTap(false);
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 14,
                    background: 'rgba(255,255,255,0.12)',
                    border: '2px solid rgba(255,255,255,0.55)',
                    borderRadius: 20,
                    padding: '28px 40px',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                    backdropFilter: 'blur(8px)',
                    touchAction: 'manipulation',
                  }}
                >
                  {/* 播放图标 */}
                  <svg viewBox="0 0 24 24" width="56" height="56" fill="none">
                    <circle cx="12" cy="12" r="11" stroke="white" strokeWidth="1.5" fill="rgba(255,255,255,0.15)" />
                    <polygon points="10,8 18,12 10,16" fill="white" />
                  </svg>
                  <span style={{ color: '#fff', fontSize: 16, fontWeight: 600, letterSpacing: 0.3 }}>
                    {t('toolbar.clickToPlay')}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                    {t('toolbar.clickToWatch')}
                  </span>
                </button>
              </div>
            )}

            {hasScreenShare && activeView === 'shareScreen' && (
              <>
                <AnnotationCanvas isDrawingMode={isDrawingMode} />
                <RemoteControlOverlay
                  isActive={isRemoteControlMode}
                  isPresenter={screenShareActive}
                />
              </>
            )}

            {/* Attendee sidebar collapse button (hidden during remote control for unobstructed view) */}
            {hasScreenShare && !screenShareActive && !isRemoteControlMode && (
              <button
                className="webcam-collapse-toggle"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsWebcamSidebarCollapsed(!isWebcamSidebarCollapsed);
                }}
                style={
                  isToolbarMobile
                    ? {
                      position: 'fixed',
                      top: 'max(44px, env(safe-area-inset-top, 0px), 7vh)',
                      left: 'max(10px, env(safe-area-inset-left, 0px))',
                      right: 'auto',
                      transform: 'none',
                      zIndex: 15000,
                      background: 'rgba(30, 41, 59, 0.96)',
                      color: 'rgba(255,255,255,0.86)',
                      border: '1px solid rgba(255,255,255,0.14)',
                      borderRadius: '10px',
                      width: '36px',
                      height: '50px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
                      WebkitTapHighlightColor: 'transparent',
                      touchAction: 'manipulation',
                    }
                    : {
                      position: 'absolute',
                      top: '50%',
                      left: isWebcamSidebarCollapsed ? 0 : 160,
                      right: 'auto',
                      transform: 'translateY(-50%)',
                      zIndex: 2000,
                      background: 'rgba(30, 41, 59, 0.95)',
                      color: 'rgba(255,255,255,0.8)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderLeft: 'none',
                      borderRadius: '0 8px 8px 0',
                      width: '28px',
                      height: '64px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: '4px 0 12px rgba(0,0,0,0.5)',
                    }
                }
                title={isWebcamSidebarCollapsed ? t('toolbar.expandWebcams') : t('toolbar.collapseWebcams')}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  style={{ width: 16, height: 16 }}
                >
                  {isWebcamSidebarCollapsed ? (
                    <polyline points="9 18 15 12 9 6" />
                  ) : (
                    <polyline points="15 18 9 12 15 6" />
                  )}
                </svg>
              </button>
            )}
          </div>

          {/* Floating draggable webcam pill — at main-meeting-area level for LiveDoc + ScreenShare */}
          {activeView !== 'webcam' &&
            (screenShareActive || (activeView === 'liveDoc' && !hasScreenShare)) &&
            (() => {
              const allParticipants = [
                { id: 'local', name: props.userChoices.username || t('toolbar.you') },
                ...Array.from(room.remoteParticipants.values()).map((p) => ({
                  id: p.identity,
                  name: p.name || p.identity || '??',
                })),
              ];
              const sortByJoinTime = (
                a: (typeof allParticipants)[0],
                b: (typeof allParticipants)[0],
              ) => {
                const pA =
                  a.id === 'local' ? room.localParticipant : room.remoteParticipants.get(a.id);
                const pB =
                  b.id === 'local' ? room.localParticipant : room.remoteParticipants.get(b.id);
                return (pA?.joinedAt?.getTime() || 0) - (pB?.joinedAt?.getTime() || 0);
              };
              allParticipants.sort(sortByJoinTime);
              const maxVisible = 5;
              const overflow = allParticipants.length - maxVisible;

              return (
                <div
                  ref={floatingRef}
                  className={`floating-webcam-panel ${floatingExpanded ? 'expanded' : ''}`}
                  onMouseDown={handleFloatingMouseDown}
                  style={{
                    position: 'absolute',
                    top: floatingPos.y,
                    left: floatingPos.x,
                    zIndex: 200,
                    cursor: isDragging.current ? 'grabbing' : 'grab',
                    userSelect: 'none',
                  }}
                >
                  {!floatingExpanded && (
                    <div className="floating-collapsed-row">
                      <div className="floating-stacked-avatars">
                        {allParticipants.slice(0, maxVisible).map((p, i) => (
                          <div
                            key={p.id}
                            className="floating-avatar"
                            title={p.name}
                            style={{ zIndex: maxVisible - i }}
                          >
                            {p.name.slice(0, 2).toUpperCase()}
                          </div>
                        ))}
                        {overflow > 0 && (
                          <div className="floating-avatar overflow-badge" style={{ zIndex: 0 }}>
                            +{overflow}
                          </div>
                        )}
                      </div>
                      <button
                        className="floating-chevron-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFloatingExpanded(true);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        title={t('toolbar.expandWebcams')}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          style={{ width: 14, height: 14 }}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                    </div>
                  )}
                  {floatingExpanded &&
                    (() => {
                      return (
                        <>
                          <div className="floating-expanded-header">
                            <span className="floating-expanded-title">
                              {t('toolbar.nParticipants', { n: allParticipants.length })}
                            </span>
                            <button
                              className="floating-chevron-btn up"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFloatingExpanded(false);
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              title={t('toolbar.collapseWebcams')}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                style={{ width: 14, height: 14 }}
                              >
                                <polyline points="18 15 12 9 6 15" />
                              </svg>
                            </button>
                          </div>
                          <div className="floating-expanded-grid">
                            {allParticipants.map((p) => {
                              const participant =
                                p.id === 'local'
                                  ? room.localParticipant
                                  : room.remoteParticipants.get(p.id);
                              const camPub = participant?.getTrackPublication(Track.Source.Camera);
                              const hasVideo = camPub?.track && !camPub.isMuted;
                              return (
                                <div key={p.id} className="floating-grid-tile">
                                  <div className="floating-grid-video">
                                    {hasVideo && camPub?.track ? (
                                      <VideoTrack
                                        trackRef={{
                                          participant: participant!,
                                          source: Track.Source.Camera,
                                          publication: camPub,
                                        }}
                                      />
                                    ) : (
                                      <div className="floating-grid-avatar">
                                        {p.name.slice(0, 2).toUpperCase()}
                                      </div>
                                    )}
                                  </div>
                                  <span className="floating-grid-name">{p.name}</span>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                </div>
              );
            })()}

          {/* Chat / Attendees：移动端沿用侧栏浮层；桌面端由 KloudMeetToolbar 锚点气泡承载 */}
          {chatOpen && isToolbarMobile && (
            <div className="chat-overlay-panel">
              <div className="chat-overlay-header">
                <span>{t('toolbar.chat')}</span>
                <button className="chat-overlay-close" onClick={() => setChatOpen(false)}>
                  ✕
                </button>
              </div>
              <div className="chat-overlay-body">
                <ChatPanel messages={chatMessages} onSend={sendChatMessage} />
              </div>
            </div>
          )}

          {attendeeOpen && isToolbarMobile && (
            <div className="chat-overlay-panel" style={{ right: chatOpen ? 352 : 16 }}>
              <div className="chat-overlay-header">
                <span>{t('toolbar.participants')}</span>
                <button className="chat-overlay-close" onClick={() => setAttendeeOpen(false)}>
                  ✕
                </button>
              </div>
              <div className="chat-overlay-body">
                <AttendeePanel
                  hostIdentity={hostIdentity}
                  copresenterIdentities={copresenterIdentities}
                  cohostIdentities={cohostIdentities}
                  canManageRoles={isHost || isCohost}
                  localIdentity={room.localParticipant.identity}
                  autoPresenterIdentity={autoPresenterIdentity}
                  onAddCopresenter={(identity) => {
                    setCopresenterIdentities((prev) =>
                      prev.includes(identity) ? prev : [...prev, identity],
                    );
                    sendMeetingMsg({ type: 'SET_PRESENTER', identity });
                  }}
                  onRemoveCopresenter={(identity) => {
                    setCopresenterIdentities((prev) => prev.filter((id) => id !== identity));
                    sendMeetingMsg({ type: 'REMOVE_PRESENTER', identity });
                  }}
                  onSetCohost={(identity) => {
                    setCohostIdentities((prev) => [...prev, identity]);
                    sendMeetingMsg({ type: 'SET_COHOST', identity });
                  }}
                  onRemoveCohost={(identity) => {
                    setCohostIdentities((prev) => prev.filter((id) => id !== identity));
                    sendMeetingMsg({ type: 'REMOVE_COHOST', identity });
                  }}
                  onSetHost={(identity) => {
                    const oldHost = hostIdentity;
                    setHostIdentityOverride(identity);
                    setCohostIdentities((prev) => {
                      const without = prev.filter((id) => id !== identity);
                      if (!without.includes(oldHost)) {
                        return [...without, oldHost];
                      }
                      return without;
                    });
                    sendMeetingMsg({ type: 'SET_HOST', newHostIdentity: identity, oldHostIdentity: oldHost });
                  }}
                />
              </div>
            </div>
          )}

          {/* Dynamic layout injections */}
          <style>{`
            ${hasScreenShare
              ? `
              /* Clean, Native-Friendly Screenshare Layout Overrides */
              
              /* 1. Reset base containment so we can fill the window safely */
              .sky-meet-video-wrapper .lk-video-conference, 
              .sky-meet-video-wrapper .lk-room-container { padding: 0 !important; }
              .sky-meet-video-wrapper .lk-video-conference-inner { 
                padding: 0 !important; 
                margin: 0 !important; 
                display: flex !important; 
                flex-direction: row-reverse !important; /* Forces Carousel cleanly to the LEFT side natively */
                width: 100% !important;
                height: 100vh !important;
              }
              
              /* 2. Screenshare Wrapper cleanly gets all remaining width */
              .sky-meet-video-wrapper .lk-focus-layout-wrapper,
              .sky-meet-video-wrapper .lk-focus-layout {
                flex: 1 !important; 
                display: flex !important;
                width: 100% !important;
                height: 100% !important;
                min-width: 0 !important; 
                background: #000 !important;
                align-items: center !important;
                justify-content: center !important;
              }
              .sky-meet-video-wrapper .lk-focus-layout .lk-participant-tile {
                width: 100% !important;
                height: 100% !important;
                display: flex !important;
              }
              .sky-meet-video-wrapper .lk-focus-layout .lk-participant-tile .lk-video-container {
                width: 100% !important;
                height: 100% !important;
              }
              .sky-meet-video-wrapper .lk-focus-layout .lk-participant-tile video {
                width: 100% !important;
                height: 100% !important;
                object-fit: contain !important;
                pointer-events: none !important; /* CRITICAL: Blocks Firefox/Chrome from spawning native Picture-in-Picture hover overlays! */
              }

              /* 3. The Webcam Panel relies entirely on a CSS parent class for instant toggling without destroying the entire <style> block via React */
              .sky-meet-video-wrapper .lk-carousel { 
                display: flex !important;
                flex-direction: column !important;
                justify-content: flex-start !important; /* Align webcams from top down */
                align-items: center !important;
                width: 160px !important; 
                min-width: 160px !important; 
                max-width: 160px !important;
                height: 100% !important;
                margin: 0 !important;
                flex-shrink: 0 !important; 
                background: #111 !important;
                gap: 12px !important;
                overflow-y: auto !important;
                border-right: 1px solid rgba(255,255,255,0.1) !important;
                padding: 12px 8px !important;
              }
              
              /* This pure CSS toggle prevents the catastrophic Layout Thrashing bug */
              .sky-meet-video-wrapper.sidebar-collapsed .lk-carousel {
                display: none !important;
              }

              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile {
                pointer-events: none !important; /* Absolutely prevents accidental clicks which would swap the webcam into the FocusLayout! */
                flex: 0 0 auto !important; /* CRITICAL: Prevent flexbox from vertically stretching the tile to fill the 100vh sidebar */
                width: 100% !important;
                height: auto !important; /* Allow aspect-ratio to dictate height */
                min-height: 0 !important;
                aspect-ratio: 16 / 9 !important;
                border-radius: 8px !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important;
              }

              /* 4. Hide all redundant LiveKit controls (Maximize, PiP, etc.) from the screenshare tile entirely */
              .sky-meet-video-wrapper .lk-focus-layout > .lk-participant-tile button,
              .sky-meet-video-wrapper .lk-focus-layout > .lk-participant-tile .lk-button,
              .sky-meet-video-wrapper .lk-focus-layout > .lk-participant-tile .lk-focus-toggle-button,
              .sky-meet-video-wrapper .lk-focus-layout > .lk-participant-tile [class*="button"],
              .sky-meet-video-wrapper .lk-focus-layout > .lk-participant-tile [class*="action"],
              .sky-meet-video-wrapper .lk-focus-layout > .lk-participant-tile [class*="lk-pip"],
              .sky-meet-video-wrapper .lk-focus-layout > .lk-participant-tile [class*="focus-toggle"],
              .sky-meet-video-wrapper .lk-focus-layout > .lk-participant-tile [class*="lk-participant-metadata"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
              }

              /* 5. Mobile Responsiveness */
              @media (max-width: 768px) {
                .main-meeting-area {
                  flex-direction: column !important; /* Stack vertically */
                }
                .sky-meet-video-wrapper .lk-video-conference-inner {
                  flex-direction: column !important; /* Stack webcams nicely */
                }
                .sky-meet-video-wrapper .lk-carousel {
                  width: 100% !important;
                  max-width: 100% !important;
                  min-width: 0 !important;
                  height: 120px !important;
                  min-height: 120px !important;
                  flex-direction: row !important; /* Horizontal scrolling on phones */
                  overflow-x: auto !important;
                  overflow-y: hidden !important;
                  border-right: none !important;
                  border-bottom: 1px solid rgba(255,255,255,0.1) !important;
                  padding: 8px !important;
                  gap: 8px !important;
                }
                .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile {
                  height: 100% !important;
                  width: auto !important;
                  aspect-ratio: 16 / 9 !important;
                }
              }

              /* 6. Presenter Sharing: hide webcam sidebar, show floating panel */
              .sky-meet-video-wrapper.presenter-sharing .lk-carousel {
                 display: none !important;
              }
              /* Mirror-block: NUCLEAR — hide ALL video wrapper content, only show LiveDoc overlay */
              .sky-meet-video-wrapper.mirror-blocked {
                 visibility: hidden !important;
              }
              .sky-meet-video-wrapper.mirror-blocked .mirror-livedoc-overlay,
              .sky-meet-video-wrapper.mirror-blocked .mirror-livedoc-overlay * {
                 visibility: visible !important;
              }
              .screenshare-overlay-badge {
                 background: rgba(0,0,0,0.75);
                 color: #fff;
                 padding: 8px 16px;
                 border-radius: 20px;
                 font-size: 14px;
                 font-weight: 500;
                 backdrop-filter: blur(8px);
                 border: 1px solid rgba(255,255,255,0.1);
                 box-shadow: 0 4px 12px rgba(0,0,0,0.5);
              }

            `
              : ''
            }

            /* ═══ Always-available styles (floating panel, chat overlay) ═══ */

            /* Screenshare Overlays */
            .screenshare-overlay-container {
               position: absolute;
               top: 60px;
               left: 0;
               width: 100%;
               pointer-events: none;
               display: flex;
               justify-content: center;
               align-items: flex-start;
               z-index: 100;
            }
            @media (max-width: 768px) {
               .screenshare-overlay-container { width: 100%; left: 0; top: 32px; }
               .sky-meet-video-wrapper.hide-mirror-video { width: 100% !important; min-width: 0 !important; flex: 0 0 120px !important; }
            }

            .floating-webcam-panel {
               background: rgba(15, 23, 42, 0.9);
               backdrop-filter: blur(16px);
               border: 1px solid rgba(255,255,255,0.12);
               border-radius: 20px;
               padding: 6px 8px;
               box-shadow: 0 8px 32px rgba(0,0,0,0.45);
            }
            .floating-webcam-panel.expanded {
               border-radius: 16px;
               padding: 10px 12px;
               min-width: 200px;
            }
            .floating-collapsed-row {
               display: flex;
               align-items: center;
               gap: 6px;
            }
            .floating-stacked-avatars {
               display: flex;
               align-items: center;
            }
            .floating-stacked-avatars .floating-avatar {
               margin-left: -8px;
               transition: transform 0.15s ease;
            }
            .floating-stacked-avatars .floating-avatar:first-child {
               margin-left: 0;
            }
            .floating-stacked-avatars .floating-avatar:hover {
               transform: scale(1.15);
            }
            .floating-avatar {
               width: 30px;
               height: 30px;
               border-radius: 50%;
               background: linear-gradient(135deg, #3b82f6, #6366f1);
               color: #fff;
               font-size: 10px;
               font-weight: 700;
               display: flex;
               align-items: center;
               justify-content: center;
               border: 2px solid rgba(15, 23, 42, 0.9);
               flex-shrink: 0;
               position: relative;
            }
            .floating-avatar.overflow-badge {
               background: rgba(255,255,255,0.15);
               font-size: 10px;
               color: rgba(255,255,255,0.8);
               border-color: rgba(255,255,255,0.2);
            }
            .floating-chevron-btn {
               background: rgba(255,255,255,0.1);
               border: none;
               color: rgba(255,255,255,0.7);
               width: 24px;
               height: 24px;
               border-radius: 50%;
               cursor: pointer;
               display: flex;
               align-items: center;
               justify-content: center;
               transition: all 0.15s ease;
               flex-shrink: 0;
            }
            .floating-chevron-btn:hover {
               background: rgba(255,255,255,0.25);
               color: #fff;
            }
            .floating-expanded-header {
               display: flex;
               align-items: center;
               justify-content: space-between;
               margin-bottom: 8px;
            }
            .floating-expanded-title {
               color: rgba(255,255,255,0.5);
               font-size: 11px;
               font-weight: 600;
               text-transform: uppercase;
               letter-spacing: 0.5px;
            }
            .floating-expanded-grid {
               display: grid;
               grid-template-columns: repeat(3, 1fr);
               gap: 8px;
               max-height: 300px;
               overflow-y: auto;
            }
            .floating-grid-tile {
               display: flex;
               flex-direction: column;
               align-items: center;
               gap: 3px;
            }
            .floating-grid-video {
               width: 64px;
               height: 64px;
               border-radius: 10px;
               overflow: hidden;
               background: #1e293b;
               position: relative;
            }
            .floating-grid-video video {
               width: 100%;
               height: 100%;
               object-fit: cover;
            }
            .floating-grid-avatar {
               width: 100%;
               height: 100%;
               background: linear-gradient(135deg, #3b82f6, #6366f1);
               color: #fff;
               font-size: 16px;
               font-weight: 700;
               display: flex;
               align-items: center;
               justify-content: center;
            }
            .floating-grid-tile:hover .floating-grid-video {
               box-shadow: 0 0 0 2px #3b82f6;
            }
            .floating-grid-name {
               color: rgba(255,255,255,0.6);
               font-size: 9px;
               font-weight: 500;
               max-width: 72px;
               overflow: hidden;
               text-overflow: ellipsis;
               white-space: nowrap;
               text-align: center;
            }

            /* 8. Chat Overlay Panel — always available */
            .chat-overlay-panel {
               position: absolute;
               bottom: 70px;
               right: 16px;
               width: 320px;
               height: 420px;
               background: rgba(15, 23, 42, 0.92);
               backdrop-filter: blur(20px);
               border: 1px solid rgba(255,255,255,0.12);
               border-radius: 16px;
               box-shadow: 0 12px 40px rgba(0,0,0,0.5);
               z-index: 300;
               display: flex;
               flex-direction: column;
               overflow: hidden;
            }
            .chat-overlay-header {
               display: flex;
               align-items: center;
               justify-content: space-between;
               padding: 12px 16px;
               border-bottom: 1px solid rgba(255,255,255,0.08);
               color: #fff;
               font-size: 14px;
               font-weight: 600;
            }
            .chat-overlay-close {
               background: rgba(255,255,255,0.1);
               border: none;
               color: rgba(255,255,255,0.7);
               width: 28px;
               height: 28px;
               border-radius: 50%;
               cursor: pointer;
               font-size: 14px;
               display: flex;
               align-items: center;
               justify-content: center;
               transition: all 0.15s ease;
            }
            .chat-overlay-close:hover {
               background: rgba(255,255,255,0.25);
               color: #fff;
            }
            .chat-overlay-body {
               flex: 1;
               overflow: hidden;
               display: flex;
               flex-direction: column;
            }
            .chat-overlay-body .lk-chat {
               height: 100% !important;
               background: transparent !important;
               border: none !important;
            }
            .chat-overlay-body .lk-chat-messages {
               flex: 1;
               overflow-y: auto;
               padding: 8px;
            }
            .chat-overlay-body .lk-chat-form {
               padding: 8px;
               border-top: 1px solid rgba(255,255,255,0.08);
            }
            .chat-overlay-body .lk-chat-form input {
               background: rgba(255,255,255,0.08) !important;
               border: 1px solid rgba(255,255,255,0.12) !important;
               color: #fff !important;
               border-radius: 8px !important;
            }
            @media (max-width: 768px) {
               .chat-overlay-panel {
                  width: calc(100% - 32px);
                  left: 16px;
                  right: 16px;
                  height: 50vh;
               }
            }

            ${chatAndAttendeeStyles}
          `}</style>
        </div>

        {/* Custom toolbar overlay */}
        <KloudMeetToolbar
          activeView={activeView}
          onViewChange={handleViewChange}
          onExit={handleLeave}
          onEndForAll={handleEndForAll}
          micEnabled={micEnabled}
          camEnabled={camEnabled}
          onToggleMic={handleToggleMic}
          onToggleCam={handleToggleCam}
          onShareScreen={handleShareScreen}
          screenShareActive={screenShareActive}
          canShareScreen={!hasScreenShare || screenShareActive}
          isDrawingMode={isDrawingMode}
          onToggleDrawingMode={() => {
            if (hasScreenShare) {
              setIsDrawingMode((prev) => {
                const next = !prev;
                if (next) setIsRemoteControlMode(false); // mutual exclusion
                return next;
              });
            }
          }}
          isRemoteControlMode={isRemoteControlMode}
          remoteControlPending={remoteControlPending}
          onToggleRemoteControlMode={() => {
            if (!hasScreenShare) return;

            // If I am the presenter (A), no permission needed — toggle directly
            if (screenShareActive) {
              setIsRemoteControlMode((prev) => {
                const next = !prev;
                if (next) setIsDrawingMode(false);
                return next;
              });
              return;
            }

            // I am a viewer (B) — need to request permission from presenter (A)
            if (remoteControlPending) {
              // Cancel the pending request
              setRemoteControlPending(false);
              // Find the presenter's identity to send cancellation
              const presenterTrack = screenShareTracks[0];
              const presenterIdentity = presenterTrack?.participant?.identity;
              if (presenterIdentity) {
                sendMeetingMsg(
                  { type: 'RC_CANCELLED', requesterIdentity: room.localParticipant.identity, requesterName: room.localParticipant.name || room.localParticipant.identity },
                );
              }
              return;
            }

            if (isRemoteControlMode) {
              // Stop controlling
              setIsRemoteControlMode(false);
              setApprovedControllerIdentity(null);
              return;
            }

            // Send permission request to the presenter
            const presenterTrack = screenShareTracks[0];
            const presenterIdentity = presenterTrack?.participant?.identity;
            if (presenterIdentity) {
              setRemoteControlPending(true);
              setIsDrawingMode(false);
              sendMeetingMsg(
                { type: 'RC_REQUEST', requesterIdentity: room.localParticipant.identity, requesterName: room.localParticipant.name || room.localParticipant.identity },
              );
            }
          }}
          hasScreenShare={hasScreenShare}
          isDesktop={isDesktop}
          canSwitchViews={canSwitchViews}
          canEndForAll={isHost || isCohost}
          isRecording={isRecording}
          onOpenRecordPopup={() => setShowRecordPopup(true)}
          onStopRecording={() => handleToggleRecording('stop')}
          onOpenHelp={() => setShowHelp(true)}
          chatOpen={chatOpen}
          onToggleChat={() => {
            setChatOpen((prev) => !prev);
            setAttendeeOpen(false);
          }}
          attendeeOpen={attendeeOpen}
          onToggleAttendee={() => {
            setAttendeeOpen((prev) => !prev);
            setChatOpen(false);
          }}
          onOpenSheet={() => {
            setChatOpen(false);
            setAttendeeOpen(false);
          }}
          chatPanelSlot={
            isToolbarMobile ? undefined : (
              <ChatPanel messages={chatMessages} onSend={sendChatMessage} />
            )
          }
          attendeePanelSlot={
            isToolbarMobile ? undefined : (
              <AttendeePanel
                hostIdentity={hostIdentity}
                copresenterIdentities={copresenterIdentities}
                cohostIdentities={cohostIdentities}
                canManageRoles={isHost || isCohost}
                localIdentity={room.localParticipant.identity}
                autoPresenterIdentity={autoPresenterIdentity}
                onAddCopresenter={(identity) => {
                  setCopresenterIdentities((prev) =>
                    prev.includes(identity) ? prev : [...prev, identity],
                  );
                  sendMeetingMsg({ type: 'SET_PRESENTER', identity });
                }}
                onRemoveCopresenter={(identity) => {
                  setCopresenterIdentities((prev) => prev.filter((id) => id !== identity));
                  sendMeetingMsg({ type: 'REMOVE_PRESENTER', identity });
                }}
                onSetCohost={(identity) => {
                  setCohostIdentities((prev) => [...prev, identity]);
                  sendMeetingMsg({ type: 'SET_COHOST', identity });
                }}
                onRemoveCohost={(identity) => {
                  setCohostIdentities((prev) => prev.filter((id) => id !== identity));
                  sendMeetingMsg({ type: 'REMOVE_COHOST', identity });
                }}
                onSetHost={(identity) => {
                  const oldHost = hostIdentity;
                  setHostIdentityOverride(identity);
                  setCohostIdentities((prev) => {
                    const without = prev.filter((id) => id !== identity);
                    if (!without.includes(oldHost)) {
                      return [...without, oldHost];
                    }
                    return without;
                  });
                  sendMeetingMsg({ type: 'SET_HOST', newHostIdentity: identity, oldHostIdentity: oldHost });
                }}
              />
            )
          }
        />

        {/* --- MODALS --- */}
        {showMeetingReadyModal && (
          <div className="kloud-modal-overlay" onMouseDown={() => setShowMeetingReadyModal(false)}>
            <div className="kloud-modal" onMouseDown={e => e.stopPropagation()}>
              <div className="kloud-modal-header">
                <h3>Your meeting&apos;s ready</h3>
                <button className="kloud-modal-close" onClick={() => setShowMeetingReadyModal(false)}>✕</button>
              </div>
              <div className="kloud-modal-body">
                <button className="kloud-btn-primary" onClick={() => {
                  navigator.clipboard.writeText(buildInviteLinkForClipboard(isDesktop));
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M16 21v-2a4 4 0 00-4-4H5c-1.2 0-2-.8-2-2v-2c0-1.2.8-2 2-2h4a4 4 0 014 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>
                  Add others
                </button>
                <div style={{ margin: '16px 0', fontSize: '13px', color: '#4b5563' }}>
                  Or share this meeting link with others you want in the meeting
                </div>
                <div className="kloud-meeting-link-box">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {typeof window !== 'undefined' ? window.location.href.split('?')[0] : ''}
                  </span>
                  <button onClick={() => {
                    navigator.clipboard.writeText(buildInviteLinkForClipboard(isDesktop));
                  }} title="Copy link">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showRecordPopup && (
          <div className="kloud-modal-overlay" onMouseDown={() => setShowRecordPopup(false)}>
            <div className="kloud-modal kloud-modal-side" onMouseDown={e => e.stopPropagation()}>
              <div className="kloud-modal-header">
                <h3>{t('toolbar.recordingHeader')}</h3>
                <button className="kloud-modal-close" onClick={() => setShowRecordPopup(false)}>✕</button>
              </div>
              <div className="kloud-modal-body" style={{ textAlign: 'center' }}>
                <div style={{ background: '#f3f4f6', borderRadius: '8px', padding: '24px', marginBottom: '24px' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#6d28d9" strokeWidth="1.5" width="64" height="64"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" fill="#ef4444" stroke="none" /></svg>
                  <div style={{ marginTop: '16px', fontWeight: 600, color: '#111827' }}>{t('toolbar.recordVideoCall')}</div>
                  <p style={{ fontSize: '13px', color: '#4b5563', marginTop: '8px' }}>
                    {t('toolbar.recordingDesc')}
                  </p>
                </div>
                <button className="kloud-btn-primary" style={{ width: '100%' }} onClick={() => {
                  setShowRecordPopup(false);
                  setShowRecordingConsent(true);
                }}>
                  {t('toolbar.startRecording')}
                </button>
              </div>
            </div>
          </div>
        )}

        {showRecordingConsent && (
          <div className="kloud-modal-overlay" onMouseDown={() => setShowRecordingConsent(false)}>
            <div className="kloud-modal kloud-modal-center" onMouseDown={e => e.stopPropagation()}>
              <div className="kloud-modal-body">
                <h3 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 600, color: '#111827' }}>{t('toolbar.everyoneReady')}</h3>
                <p style={{ fontSize: '14px', color: '#4b5563', lineHeight: 1.5, margin: '0 0 24px' }}>
                  {t('toolbar.consentNotice')}
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button className="kloud-btn-text" onClick={() => setShowRecordingConsent(false)}>{t('prejoin.cancel')}</button>
                  <button className="kloud-btn-text" style={{ color: '#2563eb', fontWeight: 600 }} onClick={() => {
                    setShowRecordingConsent(false);
                    handleToggleRecording('start');
                  }}>{t('prejoin.startNow')}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        <style>{`
          .kloud-modal-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;
          }
          .kloud-modal {
            background: #fff; border-radius: 8px; width: 400px; max-width: 90vw; color: #111827; font-family: 'Inter', sans-serif; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          }
          .kloud-modal-center { padding: 24px; }
          .kloud-modal-side { position: absolute; right: 24px; top: 24px; bottom: 24px; height: auto; border-radius: 12px; display: flex; flex-direction: column; width: 360px; }
          .kloud-modal-header { padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #f3f4f6; }
          .kloud-modal-header h3 { margin: 0; font-size: 16px; font-weight: 600; color: #111827; }
          .kloud-modal-close { background: none; border: none; font-size: 16px; cursor: pointer; color: #6b7280; padding: 4px; border-radius: 4px; }
          .kloud-modal-close:hover { background: #f3f4f6; color: #111827; }
          .kloud-modal-body { padding: 24px; flex: 1; overflow-y: auto; }
          .kloud-btn-primary { background: #0b57d0; color: #fff; border: none; padding: 10px 24px; border-radius: 100px; font-weight: 600; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
          .kloud-btn-primary:hover { background: #0842a0; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
          .kloud-meeting-link-box { background: #f3f4f6; border-radius: 4px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; color: #111827; }
          .kloud-meeting-link-box button { background: none; border: none; cursor: pointer; color: #4b5563; padding: 4px; border-radius: 4px; display: flex; align-items: center; }
          .kloud-meeting-link-box button:hover { background: #e5e7eb; color: #111827; }
          .kloud-btn-text { background: none; border: none; font-size: 14px; font-weight: 500; color: #4b5563; cursor: pointer; padding: 8px 16px; border-radius: 4px; }
          .kloud-btn-text:hover { background: #f3f4f6; }
        `}</style>

        <DebugMode />
        <RecordingIndicator />
        <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
      </RoomContext.Provider>
    </div>
  );
}
