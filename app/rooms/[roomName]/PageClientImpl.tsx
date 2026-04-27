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
import { useCaptions } from '@/lib/RtasrHelper/useCaptions';
import { CaptionsOverlay } from '@/lib/RtasrHelper/CaptionsOverlay';
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
import { getInitials } from '@/lib/getInitials';

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

  // ── 清理 stale 设备 ID（在 mount 时执行，避免渲染期竞争）
  const [prejoinKey, setPrejoinKey] = React.useState(0); // 用于强制重挂载 PreJoin

  const [prejoinReady, setPrejoinReady] = React.useState(false);

  React.useEffect(() => {
    try {
      const key = 'lk-user-choices';
      const raw = localStorage.getItem(key);
      const base: Record<string, any> = raw ? JSON.parse(raw) : {};

      let username = base.username || '';
      const storedKloud = localStorage.getItem('kloudUser');
      if (storedKloud) {
        const user = JSON.parse(storedKloud);
        if (user && (user.displayName || user.username)) {
          username = user.displayName || user.username;
        }
      }

      // Always reset to system defaults: clear deviceIds, ensure audio on
      localStorage.setItem(key, JSON.stringify({
        ...base,
        username,
        audioEnabled: true,
        audioDeviceId: '',   // let browser pick system default
        videoDeviceId: '',   // let browser pick system default
      }));
    } catch (_) { /* ignore */ }
    setPrejoinReady(true);
  }, []); // runs once on mount, before PreJoin reads localStorage

  const preJoinDefaults = React.useMemo(() => {
    let defaultUsername = '';
    if (typeof window !== 'undefined') {
      try {
        const storedKloud = localStorage.getItem('kloudUser');
        if (storedKloud) {
          const user = JSON.parse(storedKloud);
          if (user && (user.displayName || user.username)) {
            defaultUsername = user.displayName || user.username;
          }
        } else {
          const key = 'lk-user-choices';
          const raw = localStorage.getItem(key);
          const base: Record<string, any> = raw ? JSON.parse(raw) : {};
          if (base.username) {
            defaultUsername = base.username;
          }
        }
      } catch (_) { /* ignore */ }
    }
    return {
      username: defaultUsername,
      videoEnabled: true,
      audioEnabled: true,
      // Do NOT set audioDeviceId / videoDeviceId — let LiveKit pick system default
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
        if (!data.error) {
          setMeetingInfo(data);
          // 供 useCaptions 读取，用于字幕持久化和时间偏移计算
          if (data.id) localStorage.setItem('activeMeetingId', String(data.id));
          if (data.actualStartedAt) localStorage.setItem('activeMeetingStartedAt', data.actualStartedAt);
          else if (data.startedAt) localStorage.setItem('activeMeetingStartedAt', data.startedAt);
        }
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
    console.error('PreJoin device error:', error);
    const msg: string = error?.message || String(error);
    // "Requested device not found" — clear stale IDs and silently remount PreJoin
    // Device preview errors (NotFoundError, OverconstrainedError, NotReadableError)
    // are non-fatal: LiveKit still renders the dropdown and the user can select manually.
    // DO NOT remount — that causes an infinite loop since LiveKit retries preview on mount.
    const DEVICE_ERRORS = [
      'notfounderror', 'requested device', 'device not found',
      'overconstrained', 'notreadableerror', 'could not start',
    ];
    const isDeviceError = DEVICE_ERRORS.some(k => msg.toLowerCase().includes(k));
    if (isDeviceError) {
      // Silently suppress — user can still pick a device from the dropdown
      console.warn('[KloudMeet] Device preview unavailable, user may select manually:', msg);
      return;
    }
    alert(`${t('prejoin.prejoinError', { error: msg })}`);
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

            /* ── Device selection popup — single container only ── */
            .kloud-prejoin-wrapper .lk-media-device-menu {
              background: #ffffff !important;
              border: 1px solid #e2e8f0 !important;
              border-radius: 14px !important;
              box-shadow: 0 8px 32px rgba(17,24,39,0.13) !important;
              padding: 6px !important;
              max-height: 260px !important;
              overflow-y: auto !important;
              overflow-x: hidden !important;
              min-width: 220px !important;
              scrollbar-width: thin;
              scrollbar-color: #c7d2fe transparent;
            }

            /* Strip border/bg from inner ul — avoid double-box */
            .kloud-prejoin-wrapper .lk-media-device-menu ul,
            .kloud-prejoin-wrapper .lk-media-device-menu .lk-list {
              background: transparent !important;
              border: none !important;
              box-shadow: none !important;
              border-radius: 0 !important;
              padding: 0 !important;
              margin: 0 !important;
              max-height: none !important;
              overflow: visible !important;
              list-style: none !important;
            }

            /* Scrollbar webkit */
            .kloud-prejoin-wrapper .lk-media-device-menu::-webkit-scrollbar { width: 4px; }
            .kloud-prejoin-wrapper .lk-media-device-menu::-webkit-scrollbar-track { background: transparent; }
            .kloud-prejoin-wrapper .lk-media-device-menu::-webkit-scrollbar-thumb {
              background: #c7d2fe;
              border-radius: 4px;
            }

            /* List items */
            .kloud-prejoin-wrapper .lk-media-device-menu li {
              padding: 0 !important;
              margin: 2px 0 !important;
              list-style: none !important;
              border-radius: 10px !important;
              overflow: hidden !important;
            }

            /* Item buttons */
            .kloud-prejoin-wrapper .lk-media-device-menu li button,
            .kloud-prejoin-wrapper .lk-media-device-menu button:not([class*="lk-button-group"]) {
              background: transparent !important;
              color: #1e293b !important;
              border-radius: 10px !important;
              padding: 9px 14px 9px 36px !important;
              font-size: 0.88rem !important;
              font-weight: 500 !important;
              text-align: left !important;
              width: 100% !important;
              border: none !important;
              cursor: pointer !important;
              transition: background 0.15s, color 0.15s !important;
              position: relative !important;
              white-space: nowrap !important;
              overflow: hidden !important;
              text-overflow: ellipsis !important;
              display: block !important;
            }

            /* Hover */
            .kloud-prejoin-wrapper .lk-media-device-menu li button:hover {
              background: #eef2ff !important;
              color: #5227D3 !important;
            }

            /* Selected item — #5227D3 background, white text */
            .kloud-prejoin-wrapper .lk-media-device-menu li[aria-selected="true"] button,
            .kloud-prejoin-wrapper .lk-media-device-menu button[aria-selected="true"],
            .kloud-prejoin-wrapper .lk-media-device-menu li button[data-lk-active="true"],
            .kloud-prejoin-wrapper .lk-media-device-menu li.lk-list-item--active button,
            .kloud-prejoin-wrapper .lk-media-device-menu li button.lk-active {
              background: #5227D3 !important;
              color: #ffffff !important;
              font-weight: 600 !important;
            }

            /* White checkmark before selected item via ::before */
            .kloud-prejoin-wrapper .lk-media-device-menu li[aria-selected="true"] button::before,
            .kloud-prejoin-wrapper .lk-media-device-menu button[aria-selected="true"]::before,
            .kloud-prejoin-wrapper .lk-media-device-menu li button[data-lk-active="true"]::before,
            .kloud-prejoin-wrapper .lk-media-device-menu li.lk-list-item--active button::before,
            .kloud-prejoin-wrapper .lk-media-device-menu li button.lk-active::before {
              content: '';
              position: absolute !important;
              left: 12px !important;
              top: 50% !important;
              transform: translateY(-50%) rotate(45deg) !important;
              width: 5px !important;
              height: 9px !important;
              border-right: 2px solid #ffffff !important;
              border-bottom: 2px solid #ffffff !important;
              display: block !important;
            }

            /* Unselected items: placeholder indent (no checkmark) */
            .kloud-prejoin-wrapper .lk-media-device-menu li button:not(.lk-active)::before {
              content: '' !important;
              display: none !important;
            }

            /* ── Microphone & Camera button group: rounded to match input field ── */
            .kloud-prejoin-wrapper .lk-button-group {
              border-radius: 10px !important;
              overflow: hidden !important;
            }
            .kloud-prejoin-wrapper .lk-button-group > button:first-child {
              border-radius: 10px 0 0 10px !important;
            }
            .kloud-prejoin-wrapper .lk-button-group > button:last-child,
            .kloud-prejoin-wrapper .lk-button-group > div:last-child {
              border-radius: 0 10px 10px 0 !important;
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
              <Link href="/" className="kloud-prejoin-logo-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
                <img
                  src="/images/kloud-header-logo.svg"
                  alt="Kloud Meet"
                  height={36}
                  style={{ display: 'block', transform: 'translateY(4px)' }}
                />
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
          {!isBot && prejoinReady && (
            <PreJoin
              key={prejoinKey}
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

// getInitials — 已迁移到 @/lib/getInitials，此处保留空行占位，避免重新定义。
// 在文件顶部通过 import { getInitials } from '@/lib/getInitials' 引入。

/** 根据参与者数量计算最优网格列数 */
function calcGridCols(count: number): number {
  if (count <= 1) return 1;
  if (count <= 2) return 2;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  if (count <= 9) return 3;
  if (count <= 12) return 4;
  return 4; // 13-16
}

const MAX_VISIBLE = 16;

function MobileVideoLayout() {
  const { t } = useI18n();
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );

  const [expanded, setExpanded] = React.useState(false);
  const gridRef = React.useRef<HTMLDivElement>(null);

  const totalCount = tracks.length;
  const isOver = totalCount > MAX_VISIBLE;
  // 收起时只显示 MAX_VISIBLE 个
  const visibleTracks = (!isOver || expanded) ? tracks : tracks.slice(0, MAX_VISIBLE);
  const hiddenCount = totalCount - MAX_VISIBLE;

  const cols = calcGridCols(Math.min(totalCount, MAX_VISIBLE));

  // 注入 data-lk-initials 到每个 placeholder 元素
  React.useEffect(() => {
    const container = gridRef.current;
    if (!container) return;

    const applyInitials = () => {
      container.querySelectorAll<HTMLElement>('.lk-participant-tile').forEach((tile) => {
        const placeholder = tile.querySelector<HTMLElement>('.lk-participant-placeholder');
        if (!placeholder) return;
        // 获取名字：先尝试 data-lk-name，再找 .lk-participant-name 文字
        const name =
          placeholder.getAttribute('data-lk-name') ||
          tile.querySelector('.lk-participant-name')?.textContent ||
          '';
        placeholder.setAttribute('data-lk-initials', getInitials(name));
      });
    };

    applyInitials();
    // MutationObserver 监听 DOM 变化（新人加入/摄像头切换）
    const observer = new MutationObserver(applyInitials);
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-lk-name', 'data-lk-video-muted'] });
    return () => observer.disconnect();
  }, [visibleTracks.length]);

  // 不滚动模式：用 CSS Grid 填满父容器高度
  const gridStyle: React.CSSProperties = isOver && expanded
    ? {
      // 展开后允许滚动
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: '6px',
      padding: '6px',
      overflowY: 'auto',
      height: '100%',
      background: '#0a0a0a',
      boxSizing: 'border-box',
    }
    : {
      // 不超16人 or 收起时：填满高度，不滚动
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridAutoRows: '1fr',
      gap: '6px',
      padding: '6px',
      height: '100%',
      overflow: 'hidden',
      background: '#0a0a0a',
      boxSizing: 'border-box',
    };

  return (
    <div className="lk-mobile-scroll-grid" style={{ flex: 1, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      <div ref={gridRef} style={gridStyle}>
        {visibleTracks.map((track, i) => (
          <div
            key={track.participant?.identity ?? i}
            style={{
              borderRadius: '12px',
              overflow: 'hidden',
              position: 'relative',
              background: '#1e1e2e',
              minHeight: 0,
            }}
          >
            <ParticipantTile
              trackRef={track}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        ))}

        {/* More 按钮 —— 占据一个格子 */}
        {isOver && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            style={{
              borderRadius: '12px',
              border: 'none',
              background: 'rgba(99, 102, 241, 0.25)',
              backdropFilter: 'blur(8px)',
              color: '#fff',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 600,
              fontFamily: 'Inter, sans-serif',
              minHeight: 0,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="28" height="28">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {`+${hiddenCount} ${t('toolbar.moreParticipants')}`}
          </button>
        )}
      </div>

      {/* 展开后收起按钮 */}
      {isOver && expanded && (
        <button
          onClick={() => setExpanded(false)}
          style={{
            flexShrink: 0,
            background: 'rgba(30,30,46,0.95)',
            border: 'none',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.6)',
            padding: '10px',
            fontSize: '0.8rem',
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M18 15l-6-6-6 6" />
          </svg>
          {t('toolbar.showLess')}
        </button>
      )}

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
  // Stores the mic state BEFORE a MUTE_ALL command arrived, so UNMUTE_ALL can restore it.
  const preMuteAllMicRef = React.useRef<boolean | null>(null);
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
  const [showWebcamSidebar, setShowWebcamSidebar] = React.useState(false);
  const [webcamSidebarSettingsOpen, setWebcamSidebarSettingsOpen] = React.useState(false);
  // Screen-share takeover dialog
  const [showShareTakeoverDialog, setShowShareTakeoverDialog] = React.useState(false);

  const handleToggleRecording = async (action: 'start' | 'stop') => {
    // Get user from localStorage → fallback sessionStorage → fallback cookie
    let dbUser: { id?: string } = {};
    try { dbUser = JSON.parse(localStorage.getItem('kloudUser') || '{}'); } catch { }
    if (!dbUser.id) {
      try { dbUser = JSON.parse(sessionStorage.getItem('kloudUser') || '{}'); } catch { }
    }
    if (!dbUser.id) {
      // Try cookie
      const match = document.cookie.match(/(?:^|;\s*)kloudUser=([^;]*)/);
      if (match) { try { dbUser = JSON.parse(decodeURIComponent(match[1])); } catch { } }
    }

    if (!dbUser.id) {
      // Use toolbar toast instead of browser alert
      const toastEl = document.createElement('div');
      toastEl.textContent = t('toolbar.recordLoginRequired') || 'You must be logged in to record';
      toastEl.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(239,68,68,0.95);color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;z-index:99999;pointer-events:none;';
      document.body.appendChild(toastEl);
      setTimeout(() => toastEl.remove(), 3000);
      return;
    }

    try {
      setIsRecording(action === 'start');
      const pageUrlStr = window.location.href;
      const roomSeg = window.location.pathname.split('/').filter(Boolean).pop();

      const res = await fetch(`/api/meetings/${roomSeg}/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, teamMemberId: dbUser.id, pageUrl: pageUrlStr })
      });

      const data = await res.json();
      if (!res.ok) {
        setIsRecording(action === 'stop'); // revert
        const toastEl = document.createElement('div');
        toastEl.textContent = `${t('toolbar.recordingFailed') || 'Recording failed'}: ${data.error}`;
        toastEl.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(239,68,68,0.95);color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:99999;pointer-events:none;max-width:80vw;text-align:center;';
        document.body.appendChild(toastEl);
        setTimeout(() => toastEl.remove(), 4000);
      } else {
        console.log(`Recording ${action} successful`, data);
      }
    } catch (e) {
      console.error(e);
      setIsRecording(action === 'stop');
      const toastEl = document.createElement('div');
      toastEl.textContent = t('toolbar.recordNetworkError') || 'Network error while toggling recording';
      toastEl.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(239,68,68,0.95);color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;z-index:99999;pointer-events:none;';
      document.body.appendChild(toastEl);
      setTimeout(() => toastEl.remove(), 3000);
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
  // Whether the local participant is the one sharing their screen (derived from tracks, not state)
  const isLocalScreenShare = screenShareTracks.some(
    (t) => t.participant?.identity === room.localParticipant.identity,
  );

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
      if (isLocalScreenShare) {
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
        // Presenter: switch to liveDoc so they don't see their own screen share
        setActiveView('liveDoc');
        broadcastViewChangeRef.current?.('shareScreen');
      } else {
        setScreenShareSurface('unknown');
        setSurfaceDetected(false);
        // Other participants: switch to shareScreen to view the shared desktop
        setActiveView('shareScreen');
      }
    } else {
      setScreenShareActive(false);
      setIsDrawingMode(false);
      setIsRemoteControlMode(false);
      setScreenShareSurface('unknown');
      setSurfaceDetected(false);
      setActiveView((prev) => {
        if (prev === 'shareScreen' || prev === 'liveDoc') {
          // Screen share ended: everyone goes back to liveDoc
          broadcastViewChangeRef.current?.('liveDoc');
          return 'liveDoc';
        }
        return prev;
      });
    }
  }, [hasScreenShare, isLocalScreenShare, room.localParticipant]);

  // Ref for broadcast function (defined later in DataChannel sync block)
  const broadcastViewChangeRef = React.useRef<((view: ViewMode) => void) | null>(null);

  const handleViewChange = React.useCallback(
    (view: ViewMode) => {
      if (view !== 'shareScreen') {
        setIsDrawingMode(false);
        setIsRemoteControlMode(false);
        // Stop screen share only if switching to a non-sharing view that's not liveDoc
        // (Presenter stays in liveDoc while sharing — don't stop share for that case)
        if (screenShareActive && view !== 'liveDoc') {
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
              console.error('[KloudMeet] E2EE not supported by browser:', e);
              setConnectError('您的浏览器不支持加密会议，请更新到最新版本后重试。');
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

  const connectAttemptedRef = React.useRef(false);
  const connectRetryCountRef = React.useRef(0);
  const MAX_CONNECT_RETRIES = 3;
  // Tracks the pending retry setTimeout so we can cancel on unmount
  const connectRetryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Connection error state — drives the inline error UI instead of alert()
  const [connectError, setConnectError] = React.useState<string | null>(null);
  // Keeps the retry count visible in the error UI (NOT reset until user dismisses)
  const connectRetryDisplayRef = React.useRef(0);
  // Retry counter for unexpected in-room errors (e.g. "Client initiated disconnect")
  const unexpectedErrorRetryCountRef = React.useRef(0);
  const MAX_UNEXPECTED_RETRIES = 3;

  // ─── isRetryableConnectError ─────────────────────────────────────────────
  // MUST be declared BEFORE the useEffect that references it.
  // Arrow functions are NOT hoisted; placing them after the effect causes
  // "isRetryableConnectError is not a function" at runtime.
  const isRetryableConnectError = React.useCallback((err: Error): boolean => {
    const msg = err.message?.toLowerCase() ?? '';
    return (
      msg.includes('signal connection') ||
      msg.includes('abort handler') ||
      msg.includes('abort') ||
      msg.includes('websocket') ||
      msg.includes('network') ||
      msg.includes('failed to fetch') ||
      msg.includes('timed out') ||
      msg.includes('client initiated disconnect') ||
      err.name === 'AbortError'
    );
  }, []);

  React.useEffect(() => {
    // Always register event listeners (so cleanup always has something to remove)
    room.on(RoomEvent.Disconnected, handleOnLeave);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleError);

    if (e2eeSetupComplete && !connectAttemptedRef.current) {
      // Check if room is already connected or connecting
      if (room.state === ConnectionState.Connected || room.state === ConnectionState.Reconnecting) {
        console.warn('[LiveKit] Room already connected, skipping connect()');
      } else {
        connectAttemptedRef.current = true;

        // ─── doConnect: self-contained recursive retry with exponential backoff ───────
        // All retry rounds go through this single function so the backoff counters
        // are always correct regardless of which attempt fails.
        const doConnect = () => {
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

              // Reset retry counters on success
              connectRetryCountRef.current = 0;
              connectRetryDisplayRef.current = 0;
              setConnectError(null);

              // Enable camera/mic AFTER connection is established.
              // Validate device IDs first — if the selected device has disappeared
              // (unplugged, virtual device gone, stale ID), clear it so the browser
              // falls back to the system default instead of throwing NotFoundError.
              const enableDevices = async () => {
                try {
                  const devices = await navigator.mediaDevices.enumerateDevices();
                  const videoIds = new Set(devices.filter(d => d.kind === 'videoinput').map(d => d.deviceId));
                  const audioIds = new Set(devices.filter(d => d.kind === 'audioinput').map(d => d.deviceId));

                  const wantedVideo = props.userChoices.videoDeviceId;
                  if (wantedVideo && !videoIds.has(wantedVideo)) {
                    console.warn('[KloudMeet] Saved video device not found, falling back to default');
                    room.options.videoCaptureDefaults = {
                      ...room.options.videoCaptureDefaults,
                      deviceId: undefined,
                    };
                  }
                  const wantedAudio = props.userChoices.audioDeviceId;
                  if (wantedAudio && !audioIds.has(wantedAudio)) {
                    console.warn('[KloudMeet] Saved audio device not found, falling back to default');
                    room.options.audioCaptureDefaults = {
                      ...room.options.audioCaptureDefaults,
                      deviceId: undefined,
                    };
                  }
                } catch (e) {
                  console.warn('[KloudMeet] Could not enumerate devices, proceeding with defaults:', e);
                }

                if (props.userChoices.videoEnabled) {
                  room.localParticipant.setCameraEnabled(true).catch(handleError);
                }
                if (props.userChoices.audioEnabled) {
                  room.localParticipant.setMicrophoneEnabled(true).catch(handleError);
                }
              };
              enableDevices();
            })
            .catch((error) => {
              connectAttemptedRef.current = false;

              if (isRetryableConnectError(error)) {
                const attempt = connectRetryCountRef.current + 1;
                if (attempt <= MAX_CONNECT_RETRIES) {
                  const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
                  console.warn(
                    `[KloudMeet] Signal connection failed, attempt ${attempt}/${MAX_CONNECT_RETRIES}, retrying in ${delay}ms…`,
                    error.message,
                  );
                  connectRetryCountRef.current = attempt;
                  connectRetryDisplayRef.current = attempt;
                  connectRetryTimerRef.current = setTimeout(() => {
                    connectRetryTimerRef.current = null;
                    if (room.state === ConnectionState.Disconnected) {
                      connectAttemptedRef.current = true;
                      doConnect(); // ← same function, carries full retry logic
                    }
                  }, delay);
                  return;
                }
                // All retries exhausted — show inline error UI
                console.error('[KloudMeet] All connection retries exhausted:', error);
                connectRetryDisplayRef.current = MAX_CONNECT_RETRIES;
                connectRetryCountRef.current = 0;
                setConnectError(error.message);
              } else {
                handleError(error);
              }
            });
        };

        doConnect();
      }
    }

    return () => {
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
      // Cancel any pending retry
      if (connectRetryTimerRef.current) clearTimeout(connectRetryTimerRef.current);
      // Properly disconnect when component unmounts (fixes StrictMode double-mount)
      if (room.state !== ConnectionState.Disconnected) {
        room.disconnect().catch(console.error);
        connectAttemptedRef.current = false;
      }
    };
    // NOTE: props.userChoices intentionally excluded — it's an unstable object ref
    // whose values are only needed at initial connect time, not for re-connections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e2eeSetupComplete, room, props.connectionDetails, isRetryableConnectError]);

  const lowPowerMode = useLowCPUOptimizer(room);

  const router = useRouter();
  const handleOnLeave = React.useCallback(() => {
    router.push('/');
  }, [router]);

  // Keep a stable ref to connectionDetails so handleError doesn't need it as a
  // useCallback dep (which would cause stale MediaDevicesError listener issues).
  const connectionDetailsRef = React.useRef(props.connectionDetails);
  React.useEffect(() => { connectionDetailsRef.current = props.connectionDetails; }, [props.connectionDetails]);
  const connectOptionsRef = React.useRef(connectOptions);
  React.useEffect(() => { connectOptionsRef.current = connectOptions; }, [connectOptions]);

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
    // Device errors (unplugged, stale ID, busy) are non-fatal — user can
    // switch devices from the in-room settings dropdown.
    const DEVICE_ERRORS = [
      'notfounderror', 'requested device', 'device not found',
      'overconstrained', 'notreadableerror', 'could not start',
    ];
    const msg = error?.message?.toLowerCase() ?? '';
    const name = error?.name?.toLowerCase() ?? '';
    if (DEVICE_ERRORS.some(k => msg.includes(k) || name.includes(k))) {
      console.warn('[KloudMeet] Media device unavailable, user may switch in settings:', error.message);
      return;
    }
    // Signal/network errors & "client initiated disconnect" — auto-retry then inline UI
    if (isRetryableConnectError(error)) {
      const attempt = unexpectedErrorRetryCountRef.current + 1;
      if (attempt <= MAX_UNEXPECTED_RETRIES && room.state === ConnectionState.Disconnected) {
        unexpectedErrorRetryCountRef.current = attempt;
        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        console.warn(
          `[KloudMeet] Unexpected disconnect, auto-retry ${attempt}/${MAX_UNEXPECTED_RETRIES} in ${delay}ms:`,
          error.message,
        );
        setTimeout(() => {
          if (room.state === ConnectionState.Disconnected) {
            const cd = connectionDetailsRef.current;
            const co = connectOptionsRef.current;
            room
              .connect(cd.serverUrl, cd.participantToken, co)
              .then(() => {
                console.log('[KloudMeet] Auto-reconnect succeeded');
                unexpectedErrorRetryCountRef.current = 0;
              })
              .catch((retryErr) => {
                handleError(retryErr); // recurse — counts up until MAX then falls to UI
              });
          }
        }, delay);
        return;
      }
      // All retries exhausted — show inline UI, never alert()
      console.error('[KloudMeet] All unexpected-error retries exhausted:', error);
      connectRetryDisplayRef.current = MAX_UNEXPECTED_RETRIES;
      unexpectedErrorRetryCountRef.current = 0;
      setConnectError(error.message);
      return;
    }
    // Any other error: surface via inline UI instead of alert()
    console.error('[KloudMeet] Unhandled error:', error);
    setConnectError(error.message);
  // room is stable (useMemo []), connectionDetails/connectOptions accessed via refs
  }, [isRetryableConnectError, room]);

  const handleEncryptionError = React.useCallback((error: Error) => {
    // Route encryption errors through the same inline UI — no alert()
    console.error('[KloudMeet] Encryption error:', error);
    setConnectError(`加密错误: ${error.message}`);
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
      const toastEl = document.createElement('div');
      toastEl.textContent = '请使用 Kloud Meet App 进行屏幕共享';
      toastEl.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(239,68,68,0.95);color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;z-index:99999;pointer-events:none;';
      document.body.appendChild(toastEl);
      setTimeout(() => toastEl.remove(), 3000);
      return;
    }

    // If someone else is actively sharing, show takeover confirmation dialog
    if (hasScreenShare && !screenShareActive) {
      setShowShareTakeoverDialog(true);
      return;
    }

    const next = !screenShareActive;
    setScreenShareActive(next);

    if (next) {
      // Immediately switch presenter to liveDoc and broadcast shareScreen to others
      setActiveView('liveDoc');
      broadcastViewChangeRef.current?.('shareScreen');
    }

    room.localParticipant.setScreenShareEnabled(next).catch((e) => {
      setScreenShareActive(false);
      // Revert view to liveDoc if screen share was cancelled/failed
      if (next) {
        setActiveView('liveDoc');
        broadcastViewChangeRef.current?.('liveDoc');
      }
      console.error(e);
    });
  }, [screenShareActive, room, hasScreenShare, isToolbarMobile]);


  // Leave: just disconnect without ending the meeting for everyone
  const handleLeave = React.useCallback(() => {
    room.disconnect();
    router.push('/');
  }, [room, router]);

  // ── Recording-aware exit phase ──
  // null = no overlay | 'saving' = spinner | 'saved' = success tick
  type RecordSavePhase = null | 'saving' | 'saved';
  const [recordSavePhase, setRecordSavePhase] = React.useState<RecordSavePhase>(null);

  /**
   * If recording is active, stops it (with saving overlay), then calls afterFn.
   * If not recording, calls afterFn immediately.
   */
  const stopRecordingAndThen = React.useCallback(
    async (afterFn: () => void) => {
      if (!isRecording) {
        afterFn();
        return;
      }

      setRecordSavePhase('saving');

      // Call the stop-recording API
      try {
        let dbUser: { id?: string } = {};
        try { dbUser = JSON.parse(localStorage.getItem('kloudUser') || '{}'); } catch { }
        if (!dbUser.id) {
          try { dbUser = JSON.parse(sessionStorage.getItem('kloudUser') || '{}'); } catch { }
        }

        const roomSeg = window.location.pathname.split('/').filter(Boolean).pop();
        if (dbUser.id && roomSeg) {
          const pageUrlStr = window.location.href;
          await fetch(`/api/meetings/${roomSeg}/record`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'stop', teamMemberId: dbUser.id, pageUrl: pageUrlStr }),
          }).catch(() => { /* best effort */ });
        }
      } catch { /* best effort */ }

      // Show success for 1.5s then exit
      setRecordSavePhase('saved');
      await new Promise((r) => setTimeout(r, 1500));
      afterFn();
    },
    [isRecording],
  );

  // Wrapped leave: stop recording then leave
  const handleLeaveWithSave = React.useCallback(() => {
    stopRecordingAndThen(() => {
      room.disconnect();
      router.push('/');
    });
  }, [stopRecordingAndThen, room, router]);

  // ── Mute All / Unmute All ──
  // Track whether mute-all is active so the button can show the right state.
  // Participants can still unmute themselves after a mute-all (non-locking).
  const [muteAllActive, setMuteAllActive] = React.useState(false);

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
  const [hostMutedIdentities, setHostMutedIdentities] = React.useState<string[]>([]);
  const [exemptFromMuteAllIdentities, setExemptFromMuteAllIdentities] = React.useState<string[]>([]);
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
    muteAllActive: boolean;
    hostMutedIdentities: string[];
    captionsOn: boolean;
  }>({
    view: activeView,
    presenter: null,
    livedocInstanceId: null,
    muteAllActive: false,
    hostMutedIdentities: [],
    captionsOn: false,
  });

  // Keep authState in sync when host changes view locally
  // Note: when host is the presenter (isLocalScreenShare), their local view is 'liveDoc'
  // but other participants should be in 'shareScreen', so store 'shareScreen' as authoritative.
  React.useEffect(() => {
    if (isHost) {
      authState.current.view = (activeView === 'liveDoc' && isLocalScreenShare)
        ? 'shareScreen'
        : activeView;
    }
  }, [isHost, activeView, isLocalScreenShare]);

  React.useEffect(() => {
    if (isHost) {
      authState.current.livedocInstanceId = livedocInstanceId;
    }
  }, [isHost, livedocInstanceId]);

  // Keep mute state in authState so late-joining participants receive it via CORRECTION
  React.useEffect(() => {
    if (isHost) {
      authState.current.muteAllActive = muteAllActive;
      authState.current.hostMutedIdentities = hostMutedIdentities;
    }
  }, [isHost, muteAllActive, hostMutedIdentities]);

  // Ref bridge: setCaptionsOpen is declared after the message handler useEffect,
  // so we use a ref to allow handleData to call it without block-scope issues.
  const setCaptionsOpenRef = React.useRef<((open: boolean) => Promise<void>) | null>(null);
  const captionsRunningRef = React.useRef<boolean>(false);

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

  // Mute All / Unmute All handlers (defined after sendMeetingMsg)
  // Only remote participants are affected — the local user (host/co-host) keeps their mic as-is.
  const handleMuteAll = React.useCallback(() => {
    sendMeetingMsg({ type: 'MUTE_ALL' });
    setMuteAllActive(true);
    setHostMutedIdentities([]);
    setExemptFromMuteAllIdentities([]);
  }, [sendMeetingMsg]);

  const handleUnmuteAll = React.useCallback(() => {
    sendMeetingMsg({ type: 'UNMUTE_ALL' });
    setMuteAllActive(false);
    setHostMutedIdentities([]);
    setExemptFromMuteAllIdentities([]);
  }, [sendMeetingMsg]);

  // Send a targeted mute/unmute to a single participant (host/co-host only)
  const handleMuteParticipant = React.useCallback(
    (identity: string, mute: boolean) => {
      // Broadcast to ALL participants so everyone can update their hostMutedIdentities
      // and show the correct red/gray color on the mic indicator.
      // The targetIdentity field tells each client which participant is being acted on.
      sendMeetingMsg({ type: mute ? 'MUTE_PARTICIPANT' : 'UNMUTE_PARTICIPANT', targetIdentity: identity });
      // Track this locally so the host sees them as forced-muted (RED)
      setHostMutedIdentities(prev =>
        mute ? (prev.includes(identity) ? prev : [...prev, identity]) : prev.filter(id => id !== identity)
      );
      // Track exemptions if they are individually unmuted during a global Mute All
      setExemptFromMuteAllIdentities(prev =>
        !mute ? (prev.includes(identity) ? prev : [...prev, identity]) : prev.filter(id => id !== identity)
      );
    },
    [sendMeetingMsg],
  );

  // Takeover: force the current presenter to stop their screen share, then start ours
  const handleConfirmShareTakeover = React.useCallback(() => {
    setShowShareTakeoverDialog(false);
    // Tell the current presenter to stop — identify them via screenShareTracks
    const presenterIdentity = screenShareTracks[0]?.participant?.identity;
    if (presenterIdentity && presenterIdentity !== room.localParticipant.identity) {
      sendMeetingMsg(
        { type: 'FORCE_STOP_SHARE', requesterIdentity: room.localParticipant.identity },
        [presenterIdentity],
      );
    }
    // Start sharing ourselves after a brief delay so the previous share can tear down
    setTimeout(() => {
      setScreenShareActive(true);
      setActiveView('liveDoc');
      broadcastViewChangeRef.current?.('shareScreen');
      room.localParticipant.setScreenShareEnabled(true).catch((e) => {
        setScreenShareActive(false);
        setActiveView('liveDoc');
        broadcastViewChangeRef.current?.('liveDoc');
        console.error(e);
      });
    }, 600);
  }, [room, screenShareTracks, sendMeetingMsg]);

  // End for All (host/co-host only): broadcast END_MEETING, mark as ended in DB, then disconnect
  const handleEndForAll = React.useCallback(async () => {
    await stopRecordingAndThen(async () => {
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
    });
  }, [room, router, sendMeetingMsg, stopRecordingAndThen]);

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
      const auth = authState.current;
      // Send full meeting state to new joiner so they immediately adopt the
      // current meeting mode and see correct mute indicators.
      sendMeetingMsg(
        {
          type: 'CORRECTION',
          view: auth.view,
          presenter: auth.presenter,
          livedocInstanceId: auth.livedocInstanceId,
          muteAllActive: auth.muteAllActive,
          hostMutedIdentities: auth.hostMutedIdentities,
          captionsOn: auth.captionsOn,
        },
        [participant.identity],
      );
    };
    room.on(RoomEvent.ParticipantConnected, handler);
    return () => {
      room.off(RoomEvent.ParticipantConnected, handler);
    };
  }, [room, isHost, sendMeetingMsg]);

  // Host/Presenter/Co-host: broadcast VIEW_CHANGE to all participants
  // Always update authState so the latest view is available for late-joining correction.
  const broadcastViewChange = React.useCallback(
    (view: ViewMode) => {
      // All privileged roles update authState so new-joiner CORRECTION has the right view.
      authState.current.view = view;
      sendMeetingMsg({ type: 'VIEW_CHANGE', view });
    },
    [sendMeetingMsg],
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
          // Skip messages from self — presenter broadcasts 'shareScreen' to others
          // but stays in 'liveDoc' themselves
          if (senderIdentity !== room.localParticipant.identity) {
            setActiveView(msg.view as ViewMode);
          }
        } else if (msg.type === 'LIVEDOC_INSTANCE' && typeof msg.livedocInstanceId === 'string') {
          setLivedocInstanceId(msg.livedocInstanceId);
        } else if (msg.type === 'CORRECTION') {
          // Correction from host — update to authoritative state
          // But don't override presenter's liveDoc view (they intentionally diverge)
          if (!(isLocalScreenShare && msg.view === 'shareScreen')) {
            setActiveView(msg.view as ViewMode);
          }
          if (msg.presenter !== undefined) {
            setCopresenterIdentities(Array.isArray(msg.presenter) ? msg.presenter : msg.presenter ? [msg.presenter] : []);
          }
          if (typeof (msg as { livedocInstanceId?: string }).livedocInstanceId === 'string') {
            setLivedocInstanceId((msg as { livedocInstanceId: string }).livedocInstanceId);
          }
          // Restore mute state for late joiners
          if (typeof msg.muteAllActive === 'boolean') {
            setMuteAllActive(msg.muteAllActive);
          }
          if (Array.isArray(msg.hostMutedIdentities)) {
            setHostMutedIdentities(msg.hostMutedIdentities);
          }
          if (typeof (msg as { captionsOn?: boolean }).captionsOn === 'boolean') {
            setCaptionsOpenRef.current?.((msg as { captionsOn: boolean }).captionsOn);
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
        } else if (msg.type === 'MUTE_ALL') {
          // Snapshot current mic state before muting (so UNMUTE_ALL can restore it).
          // micEnabled is the React source of truth for the local mic toggle state.
          preMuteAllMicRef.current = micEnabled;
          room.localParticipant.setMicrophoneEnabled(false).catch(console.error);
          setMicEnabled(false);
          setMuteAllActive(true);
          setHostMutedIdentities([]);
          setExemptFromMuteAllIdentities([]);
        } else if (msg.type === 'UNMUTE_ALL') {
          // Restore to the state the user had BEFORE the mute-all command
          const restoreTo = preMuteAllMicRef.current ?? true;
          preMuteAllMicRef.current = null;
          room.localParticipant.setMicrophoneEnabled(restoreTo).catch(console.error);
          setMicEnabled(restoreTo);
          setMuteAllActive(false);
          setHostMutedIdentities([]);
          setExemptFromMuteAllIdentities([]);
        } else if (msg.type === 'MUTE_PARTICIPANT') {
          // If this is the targeted participant, mute their mic
          if (msg.targetIdentity === room.localParticipant.identity) {
            room.localParticipant.setMicrophoneEnabled(false).catch(console.error);
            setMicEnabled(false);
          }
          // ALL clients track that this participant was force-muted by the host
          // This ensures every viewer sees the red indicator.
          if (msg.targetIdentity) {
            setHostMutedIdentities(prev =>
              prev.includes(msg.targetIdentity) ? prev : [...prev, msg.targetIdentity]
            );
          }
        } else if (msg.type === 'UNMUTE_PARTICIPANT') {
          // If this is the targeted participant, restore their mic
          if (msg.targetIdentity === room.localParticipant.identity) {
            room.localParticipant.setMicrophoneEnabled(true).catch(console.error);
            setMicEnabled(true);
          }
          // ALL clients clear the force-muted state for this identity
          if (msg.targetIdentity) {
            setHostMutedIdentities(prev => prev.filter(id => id !== msg.targetIdentity));
          }
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
        } else if (msg.type === 'FORCE_STOP_SHARE') {
          // Someone is taking over screen share — stop our share and remove presenter role
          if (screenShareActive) {
            setScreenShareActive(false);
            room.localParticipant.setScreenShareEnabled(false).catch(console.error);
            // Revert our own view to liveDoc
            setActiveView('liveDoc');
          }
          // If we were a co-presenter, remove ourselves
          setCopresenterIdentities((prev) => prev.filter((id) => id !== room.localParticipant.identity));
          // Let the host know our presenter role is gone
          if (!isHost) {
            sendMeetingMsg({ type: 'REMOVE_PRESENTER', identity: room.localParticipant.identity });
          }
        } else if (msg.type === 'HEARTBEAT' && isHost && senderIdentity) {
          // Host receives heartbeat — compare and correct if needed
          const auth = authState.current;
          const guestDoc = (msg as { livedocInstanceId?: string | null }).livedocInstanceId ?? null;
          const authDoc = auth.livedocInstanceId ?? null;
          const livedocMismatch =
            (authDoc !== null && guestDoc !== authDoc) || (authDoc !== null && guestDoc === null);
          const guestCaptionsOn = (msg as { captionsOn?: boolean }).captionsOn ?? false;
          const authCaptionsOn = auth.captionsOn;
          const captionsMismatch = guestCaptionsOn !== authCaptionsOn;

          if (
            msg.view !== auth.view ||
            msg.presenter !== (auth.presenter || null) ||
            livedocMismatch ||
            captionsMismatch
          ) {
            sendMeetingMsg(
              {
                type: 'CORRECTION',
                view: auth.view,
                presenter: auth.presenter,
                livedocInstanceId: auth.livedocInstanceId,
                muteAllActive: auth.muteAllActive,
                hostMutedIdentities: auth.hostMutedIdentities,
                captionsOn: auth.captionsOn,
              },
              [senderIdentity],
            );
          }
        } else if (msg.type === 'CAPTIONS_ON') {
          // Host/Co-host 开启了全局字幕 — 本地启动识别
          setCaptionsOpenRef.current?.(true);
        } else if (msg.type === 'CAPTIONS_OFF') {
          // Host/Co-host 关闭了全局字幕 — 本地停止识别
          setCaptionsOpenRef.current?.(false);
        }
      } catch (e) {
        console.error('Meeting control message error:', e);
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room, isHost, decoder, sendMeetingMsg, screenShareActive, approvedControllerIdentity, remoteControlRequest, micEnabled]);

  // ═══ Grid tile click-to-mute (host / co-host only) ═══
  // Event delegation on document (capture phase) so it fires before LiveKit's own handlers.
  // Detects clicks on the mic-indicator region of a remote participant tile,
  // matches the participant by display name, and sends MUTE/UNMUTE_PARTICIPANT.
  React.useEffect(() => {
    if (!room || (!isHost && !isCohost)) return;

    const handleTileMicClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;

      // Only fire if click is on/inside the custom mic indicator
      const micArea = target.closest('.kloud-custom-mic-indicator');
      if (!micArea) return;

      const tile = target.closest('.lk-participant-tile');
      if (!tile) return;
      // Skip local participant's own tile
      if (tile.getAttribute('data-lk-local-participant') === 'true') return;

      // Extract identity from the custom data attribute
      const identity = micArea.getAttribute('data-kloud-identity');
      if (!identity) return;

      const isAudioMuted = micArea.getAttribute('data-kloud-muted') === 'true';

      e.preventDefault();
      e.stopPropagation();
      handleMuteParticipant(identity, !isAudioMuted);
    };

    document.addEventListener('pointerdown', handleTileMicClick, true);
    return () => document.removeEventListener('pointerdown', handleTileMicClick, true);
  }, [room, isHost, isCohost, handleMuteParticipant]);

  // ══════════════════════════════════════════════════════════════════════
  // Custom DOM-injected Microphone Indicator (Bypassing LiveKit default)
  // Ensures the mic indicator is ALWAYS visible and supports 3 states:
  // Green (active), Gray (voluntarily muted), Red (force-muted by host)
  // ══════════════════════════════════════════════════════════════════════
  React.useEffect(() => {
    if (!room) return;

    // SVG templates for the mic icon
    const micSvg = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/></svg>`;
    const micOffSvg = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/><line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>`;

    const updateCustomMics = () => {
      // Find all tiles inside the wrapper
      const tiles = document.querySelectorAll('.lk-grid-layout-wrapper .lk-participant-tile');
      const muteAllApplied = muteAllActive;

      tiles.forEach((tile) => {
        const metadata = tile.querySelector('.lk-participant-metadata');
        if (!metadata) return;

        // Determine participant identity from the tile's data-lk-participant or fallback to name matching
        let identity = tile.getAttribute('data-lk-participant');
        let participant = identity === room.localParticipant.identity ? room.localParticipant : (identity ? room.remoteParticipants.get(identity) : null);

        // Fallback to name matching if data attribute doesn't contain identity
        if (!participant) {
          const nameEl = tile.querySelector('.lk-participant-name');
          const displayName = nameEl?.textContent?.trim();
          const matched = Array.from(room.remoteParticipants.values()).find(p => (p.name || p.identity) === displayName);
          participant = matched || (room.localParticipant.name === displayName ? room.localParticipant : null);
        }
        if (!participant) return;
        identity = participant.identity;

        const isLocal = participant.identity === room.localParticipant.identity;
        const micPub = participant.getTrackPublication(Track.Source.Microphone);
        const isMuted = !micPub?.track || micPub.isMuted;

        // Is this participant force-muted? (Hosts, co-hosts, auto-presenters are exempt)
        const targetIsHost = identity === hostIdentity;
        const targetIsCohost = cohostIdentities.includes(identity);
        const targetIsAutoPresenter = autoPresenterIdentity === identity;
        const targetIsCopresenter = copresenterIdentities.includes(identity);
        const targetIsOperator = targetIsHost || targetIsCohost || targetIsAutoPresenter || targetIsCopresenter;

        // Force muted is true if either muted globally (and not exempt) or by the host explicitly.
        // Note: !isLocal was intentionally removed — the muted participant should see red on their own tile.
        // Operator exemption (!targetIsOperator) already handles preventing hosts/cohosts from being marked red.
        const isForceMuted = ((muteAllApplied && !exemptFromMuteAllIdentities.includes(identity)) || hostMutedIdentities.includes(identity)) && !targetIsOperator && isMuted;
        // Look for our custom icon container, or create it if missing
        let customMic = metadata.querySelector('.kloud-custom-mic-indicator');
        if (!customMic) {
          customMic = document.createElement('div');
          customMic.className = 'kloud-custom-mic-indicator';

          // Place it inside the left-side metadata item, BEFORE the name
          const itemContainer = metadata.querySelector('.lk-participant-metadata-item');
          if (itemContainer) {
            itemContainer.insertBefore(customMic, itemContainer.firstChild);
          } else {
            metadata.insertBefore(customMic, metadata.firstChild);
          }
        }

        // Apply state data attributes (useful for the click handler and CSS)
        customMic.setAttribute('data-kloud-identity', identity);
        customMic.setAttribute('data-kloud-muted', isMuted ? 'true' : 'false');
        customMic.setAttribute('data-kloud-force-muted', isForceMuted ? 'true' : 'false');

        // Apply Icon + Color
        if (!isMuted) {
          customMic.innerHTML = micSvg;
          (customMic as HTMLElement).style.color = '#22c55e'; // Green
        } else if (isForceMuted) {
          customMic.innerHTML = micOffSvg;
          (customMic as HTMLElement).style.color = '#ff2020'; // Red
        } else {
          customMic.innerHTML = micOffSvg;
          (customMic as HTMLElement).style.color = 'rgba(255,255,255,0.75)'; // Gray
        }

        // If I am a host/co-host viewing a remote tile, show pointer and tooltip styles
        if (!isLocal && (isHost || isCohost)) {
          customMic.classList.add('operator-interactive');
          customMic.setAttribute('title', isMuted ? 'Click to unmute' : 'Click to mute');
        } else {
          customMic.classList.remove('operator-interactive');
          customMic.removeAttribute('title');
        }
      });
    };

    // Run the update immediately
    updateCustomMics();

    // Listen to all relevant LiveKit events to update the DOM reactively
    room.on(RoomEvent.TrackMuted, updateCustomMics);
    room.on(RoomEvent.TrackPublished, updateCustomMics);
    room.on(RoomEvent.TrackUnpublished, updateCustomMics);
    room.on(RoomEvent.ParticipantConnected, updateCustomMics);
    room.on(RoomEvent.ParticipantDisconnected, updateCustomMics);

    // Track unmuting by the user to clear host-muted state
    const handleTrackUnmuted = (pub: any, p: any) => {
      updateCustomMics();
      if (pub && pub.source === Track.Source.Microphone && p) {
        setHostMutedIdentities(prev => prev.filter(id => id !== p.identity));
      }
    };
    room.on(RoomEvent.TrackUnmuted, handleTrackUnmuted);

    // Also run on an interval as a fail-safe against delayed DOM renders by LiveKit
    const intervalId = setInterval(updateCustomMics, 500);

    return () => {
      room.off(RoomEvent.TrackMuted, updateCustomMics);
      room.off(RoomEvent.TrackUnmuted, handleTrackUnmuted);
      room.off(RoomEvent.TrackPublished, updateCustomMics);
      room.off(RoomEvent.TrackUnpublished, updateCustomMics);
      room.off(RoomEvent.ParticipantConnected, updateCustomMics);
      room.off(RoomEvent.ParticipantDisconnected, updateCustomMics);
      clearInterval(intervalId);
    };
  }, [room, muteAllActive, hostIdentity, cohostIdentities, autoPresenterIdentity, copresenterIdentities, hostMutedIdentities, exemptFromMuteAllIdentities]);

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
          view: (activeView === 'liveDoc' && isLocalScreenShare) ? 'shareScreen' : activeView,
          presenters: copresenterIdentities,
          identity: room.localParticipant.identity,
          livedocInstanceId,
          captionsOn: captionsRunningRef.current,
        },
        [hostId],
      );
    }, 5000);

    return () => clearInterval(interval);
  }, [room, activeView, isLocalScreenShare, copresenterIdentities, livedocInstanceId, sendMeetingMsg]);

  // Sync participant names into placeholder elements so CSS can display name in the center
  // when camera is off (replaces the default SVG avatar with the participant's initials)
  React.useEffect(() => {
    const syncNames = () => {
      document.querySelectorAll('.lk-participant-tile').forEach((tile) => {
        const nameEl = tile.querySelector('.lk-participant-name');
        const placeholder = tile.querySelector('.lk-participant-placeholder');
        if (nameEl && placeholder) {
          const name = nameEl.textContent?.trim() || '';
          if (placeholder.getAttribute('data-lk-name') !== name) {
            placeholder.setAttribute('data-lk-name', name);
          }
          // Also write initials for the ::after CSS display
          const initials = getInitials(name);
          if (placeholder.getAttribute('data-lk-initials') !== initials) {
            placeholder.setAttribute('data-lk-initials', initials);
          }
        }
      });
    };
    syncNames();
    const interval = setInterval(syncNames, 1000);
    return () => clearInterval(interval);
  }, []);

  // Listen for postMessage to toggle webcam sidebar in LiveDoc mode
  React.useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'Kloud-ShowWebcamView') {
        setShowWebcamSidebar(true);
      } else if (e.data.type === 'Kloud-HideWebcamView') {
        setShowWebcamSidebar(false);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

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

  // ─── Captions (host/co-host only can toggle, all see the overlay) ────────
  const { locale } = useI18n();
  const { captionsInfo, setCaptionsOpen, captionsRunning } = useCaptions({
    room,
    micEnabled,
    languageCode: locale,
  });
  // 赋值给 ref，让上面 handleData 里能访问到
  setCaptionsOpenRef.current = setCaptionsOpen;
  captionsRunningRef.current = captionsRunning;

  React.useEffect(() => {
    if (isHost) {
      authState.current.captionsOn = captionsRunning;
    }
  }, [isHost, captionsRunning]);

  const handleToggleCaptions = React.useCallback(() => {
    const newState = !captionsRunning;
    // 广播给所有参与者：全局开启/关闭字幕
    sendMeetingMsg({ type: newState ? 'CAPTIONS_ON' : 'CAPTIONS_OFF' });
    // 本地也执行
    setCaptionsOpen(newState);
  }, [captionsRunning, setCaptionsOpen, sendMeetingMsg]);

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

        {/* ── Connection Error / Retry Overlay ── */}
        {connectError !== null && (
          <div
            id="connect-error-overlay"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 99998,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(8, 8, 18, 0.82)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            <style>{`
              @keyframes connErrPulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.45; }
              }
              @keyframes connErrIn {
                from { opacity: 0; transform: scale(0.9) translateY(12px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
              }
            `}</style>
            <div
              style={{
                background: 'linear-gradient(145deg, #1a1a2e, #16213e)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '20px',
                padding: '36px 40px',
                maxWidth: '420px',
                width: '90vw',
                boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(239,68,68,0.12)',
                animation: 'connErrIn 0.3s ease',
                textAlign: 'center',
              }}
            >
              {/* Animated signal icon */}
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
                <div style={{
                  width: '56px', height: '56px', borderRadius: '50%',
                  background: 'rgba(239,68,68,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  animation: 'connErrPulse 2s ease infinite',
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.8" width="28" height="28">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 14.212A5.25 5.25 0 0117.25 10.5M5.106 17.394A9 9 0 0117.25 10.5M1.924 20.576A13.5 13.5 0 0117.25 10.5M12 18.75h.008v.008H12v-.008z" />
                  </svg>
                </div>
              </div>

              <div style={{ fontSize: '18px', fontWeight: 700, color: '#f1f5f9', marginBottom: '8px' }}>
                {connectError?.startsWith('加密错误') ? '加密错误' :
                  connectError?.toLowerCase().includes('disconnect') ? '连接已中断' : '连接失败'}
              </div>
              <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '24px', lineHeight: 1.6 }}>
                {connectRetryDisplayRef.current > 0
                  ? `已自动重试 ${connectRetryDisplayRef.current} 次，仍无法恢复连接。请检查网络后手动重试，或退出会议。`
                  : connectError?.toLowerCase().includes('disconnect')
                    ? '网络波动导致连接中断，可以尝试手动重新连接。'
                    : '无法建立信令连接，请检查您的网络后重试。'}
              </div>

              {/* Error detail (collapsible) */}
              <details style={{ marginBottom: '24px', textAlign: 'left' }}>
                <summary style={{ fontSize: '12px', color: '#64748b', cursor: 'pointer', userSelect: 'none' }}>
                  错误详情
                </summary>
                <div style={{
                  marginTop: '8px',
                  padding: '10px 12px',
                  background: 'rgba(239,68,68,0.06)',
                  border: '1px solid rgba(239,68,68,0.15)',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: '#f87171',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                  lineHeight: 1.5,
                }}>
                  {connectError}
                </div>
              </details>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <button
                  onClick={() => {
                    // Go back to dashboard
                    setConnectError(null);
                    connectAttemptedRef.current = false;
                    connectRetryCountRef.current = 0;
                    connectRetryDisplayRef.current = 0;
                    unexpectedErrorRetryCountRef.current = 0;
                    if (connectRetryTimerRef.current) {
                      clearTimeout(connectRetryTimerRef.current);
                      connectRetryTimerRef.current = null;
                    }
                    room.disconnect().catch(console.error);
                    router.push('/');
                  }}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.05)',
                    color: '#94a3b8',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: "'Inter', sans-serif",
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => {
                    // Manual retry — fully reset and re-attempt with fresh retry budget
                    setConnectError(null);
                    connectAttemptedRef.current = false;
                    connectRetryCountRef.current = 0;
                    connectRetryDisplayRef.current = 0;
                    unexpectedErrorRetryCountRef.current = 0;
                    if (connectRetryTimerRef.current) {
                      clearTimeout(connectRetryTimerRef.current);
                      connectRetryTimerRef.current = null;
                    }
                    // Re-connect and give a fresh retry budget via doConnect-equivalent inline
                    if (room.state === ConnectionState.Disconnected) {
                      connectAttemptedRef.current = true;
                      room
                        .connect(
                          props.connectionDetails.serverUrl,
                          props.connectionDetails.participantToken,
                          connectOptions,
                        )
                        .then(() => {
                          connectRetryCountRef.current = 0;
                          connectRetryDisplayRef.current = 0;
                          setConnectError(null);
                          // Validate device IDs before enabling (same as primary connect path)
                          const enableRetryDevices = async () => {
                            try {
                              const devices = await navigator.mediaDevices.enumerateDevices();
                              const videoIds = new Set(devices.filter(d => d.kind === 'videoinput').map(d => d.deviceId));
                              const audioIds = new Set(devices.filter(d => d.kind === 'audioinput').map(d => d.deviceId));
                              const wantedVideo = props.userChoices.videoDeviceId;
                              if (wantedVideo && !videoIds.has(wantedVideo)) {
                                room.options.videoCaptureDefaults = { ...room.options.videoCaptureDefaults, deviceId: undefined };
                              }
                              const wantedAudio = props.userChoices.audioDeviceId;
                              if (wantedAudio && !audioIds.has(wantedAudio)) {
                                room.options.audioCaptureDefaults = { ...room.options.audioCaptureDefaults, deviceId: undefined };
                              }
                            } catch (_) { /* proceed with whatever defaults exist */ }
                            if (props.userChoices.videoEnabled) {
                              room.localParticipant.setCameraEnabled(true).catch(handleError);
                            }
                            if (props.userChoices.audioEnabled) {
                              room.localParticipant.setMicrophoneEnabled(true).catch(handleError);
                            }
                          };
                          enableRetryDevices();
                        })
                        .catch((err) => {
                          connectAttemptedRef.current = false;
                          connectRetryDisplayRef.current = 1;
                          setConnectError(err.message);
                        });
                    }
                  }}
                  style={{
                    padding: '10px 24px',
                    borderRadius: '10px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: "'Inter', sans-serif",
                    transition: 'all 0.15s',
                    boxShadow: '0 2px 10px rgba(59,130,246,0.3)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, #2563eb, #1d4ed8)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)'; }}
                >
                  重新连接
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Recording Save Overlay ── */}
        {recordSavePhase !== null && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 99999,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(10, 10, 20, 0.88)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              fontFamily: "'Inter', sans-serif",
              gap: '20px',
              animation: 'recordSaveOverlayIn 0.25s ease',
            }}
          >
            <style>{`
              @keyframes recordSaveOverlayIn {
                from { opacity: 0; }
                to   { opacity: 1; }
              }
              @keyframes recordSaveSpin {
                to { transform: rotate(360deg); }
              }
              @keyframes recordSaveCheckIn {
                from { opacity: 0; transform: scale(0.6); }
                to   { opacity: 1; transform: scale(1); }
              }
            `}</style>

            {recordSavePhase === 'saving' ? (
              <>
                {/* Spinner */}
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  border: '4px solid rgba(255,255,255,0.12)',
                  borderTopColor: '#a78bfa',
                  animation: 'recordSaveSpin 0.9s linear infinite',
                }} />
                {/* Recording dot pulse */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{
                    display: 'inline-block',
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: '#ef4444',
                  }} />
                  <span style={{ color: '#e2e8f0', fontSize: '16px', fontWeight: 600 }}>
                    {t('toolbar.savingRecording')}
                  </span>
                </div>
                <span style={{ color: '#9ca3af', fontSize: '13px' }}>
                  {t('toolbar.leavingMeeting')}
                </span>
              </>
            ) : (
              /* Saved state */
              <div style={{ animation: 'recordSaveCheckIn 0.3s ease', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                <div style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 28px rgba(34,197,94,0.4)',
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" width="36" height="36">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span style={{ color: '#e2e8f0', fontSize: '17px', fontWeight: 700 }}>
                  {t('toolbar.recordingSaved')}
                </span>
                <span style={{ color: '#9ca3af', fontSize: '13px' }}>
                  {t('toolbar.leavingMeeting')}
                </span>
              </div>
            )}
          </div>
        )}

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

        {/* ── Screen Share Takeover Dialog ── */}
        {showShareTakeoverDialog && (
          <div
            id="share-takeover-dialog"
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
                background: 'rgba(0,0,0,0.45)',
                backdropFilter: 'blur(3px)',
                WebkitBackdropFilter: 'blur(3px)',
              }}
              onClick={() => setShowShareTakeoverDialog(false)}
            />
            <div
              style={{
                position: 'relative',
                zIndex: 1,
                background: 'linear-gradient(145deg, #1e1e2e, #252538)',
                borderRadius: '16px',
                padding: '28px 32px',
                minWidth: '360px',
                maxWidth: '440px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(251,146,60,0.18)',
                border: '1px solid rgba(255,255,255,0.08)',
                fontFamily: "'Inter', sans-serif",
                animation: 'shareDialogIn 0.25s ease',
              }}
            >
              <style>{`
                @keyframes shareDialogIn {
                  from { opacity: 0; transform: scale(0.92) translateY(8px); }
                  to { opacity: 1; transform: scale(1) translateY(0); }
                }
                @keyframes shareDialogPulse {
                  0%, 100% { box-shadow: 0 0 0 0 rgba(251,146,60,0.4); }
                  50% { box-shadow: 0 0 0 8px rgba(251,146,60,0); }
                }
              `}</style>

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #f97316, #ea580c)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    animation: 'shareDialogPulse 2.2s ease infinite',
                  }}
                >
                  {/* Monitor / Share icon */}
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" width="22" height="22">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path strokeLinecap="round" d="M8 21h8M12 17v4" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 9l-3-3-3 3M12 6v6" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#f1f1f4' }}>
                    {t('toolbar.shareConflictTitle')}
                  </div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                    {t('toolbar.shareConflictSubtitle')}
                  </div>
                </div>
              </div>

              {/* Body */}
              <div style={{ fontSize: '14px', color: '#d1d5db', lineHeight: 1.65, marginBottom: '24px' }}>
                {(() => {
                  const presenterName =
                    screenShareTracks[0]?.participant?.name ||
                    screenShareTracks[0]?.participant?.identity ||
                    t('toolbar.shareConflictSomeone');
                  return (
                    <>
                      <strong style={{ color: '#fb923c' }}>{presenterName}</strong>
                      {' '}
                      {t('toolbar.shareConflictBody')}
                    </>
                  );
                })()}
              </div>

              {/* Buttons */}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowShareTakeoverDialog(false)}
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
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleConfirmShareTakeover}
                  style={{
                    padding: '8px 20px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #f97316, #ea580c)',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    fontFamily: "'Inter', sans-serif",
                    boxShadow: '0 2px 10px rgba(249,115,22,0.35)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, #ea580c, #c2410c)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, #f97316, #ea580c)'; }}
                >
                  {t('toolbar.shareConflictConfirm')}
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
          {/* Standalone LiveDoc — always mounted to prevent iframe reload on tab switch.
               Visibility is controlled via CSS display instead of conditional rendering. */}
          <div
            style={{
              display: isPureLiveDoc && (!hasScreenShare || isLocalScreenShare) ? 'flex' : 'none',
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
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
              {/* Right webcam sidebar — triggered by postMessage Kloud-ShowWebcamView */}
              {showWebcamSidebar && (() => {
                const allP = [
                  { id: 'local' as string, name: props.userChoices.username || 'You', participant: room.localParticipant },
                  ...Array.from(room.remoteParticipants.values()).map((p) => ({
                    id: p.identity,
                    name: p.name || p.identity || '??',
                    participant: p as any,
                  })),
                ];

                const switchToFloating = () => {
                  setShowWebcamSidebar(false);
                };

                const handleFileClick = () => {
                  // Switch to floating mode
                  setShowWebcamSidebar(false);
                  // Send message to iframe
                  const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="LiveDoc"]');
                  if (iframe?.contentWindow) {
                    iframe.contentWindow.postMessage({ type: 'Kloud-ShowFilePanel', Show: 1 }, '*');
                  }
                };

                return (
                  <div className="webcam-sidebar-panel">
                    {/* Header: settings (left) + file icon (right) */}
                    <div className="webcam-sidebar-header">
                      <div style={{ position: 'relative' }}>
                        <button
                          className="webcam-sidebar-icon-btn"
                          onClick={() => setWebcamSidebarSettingsOpen(!webcamSidebarSettingsOpen)}
                          title="Settings"
                        >
                          {/* Gear icon */}
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                          </svg>
                        </button>
                        {webcamSidebarSettingsOpen && (
                          <div className="webcam-sidebar-dropdown">
                            <button
                              className="webcam-sidebar-dropdown-item active"
                              onClick={() => setWebcamSidebarSettingsOpen(false)}
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="18" rx="1" /><rect x="14" y="3" width="7" height="18" rx="1" /></svg>
                              Sidebar
                            </button>
                            <button
                              className="webcam-sidebar-dropdown-item"
                              onClick={() => { setWebcamSidebarSettingsOpen(false); switchToFloating(); handleFileClick() }}
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="3" /><rect x="10" y="4" width="10" height="10" rx="2" /></svg>
                              Floating
                            </button>
                          </div>
                        )}
                      </div>
                      <button
                        className="webcam-sidebar-icon-btn file-btn"
                        onClick={handleFileClick}
                        title="Show file panel"
                      >
                        {/* File/document icon */}
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <polyline points="10 9 9 9 8 9" />
                        </svg>
                      </button>
                    </div>
                    <div className="webcam-sidebar-tiles">
                      {allP.map((p) => {
                        const camPub = p.participant?.getTrackPublication(Track.Source.Camera);
                        const micPub = p.participant?.getTrackPublication(Track.Source.Microphone);
                        const hasVideo = camPub?.track && !camPub.isMuted;
                        const micMuted = !micPub?.track || micPub.isMuted;
                        return (
                          <div key={p.id} className="webcam-sidebar-tile">
                            <div className="webcam-sidebar-video">
                              {hasVideo && camPub?.track ? (
                                <VideoTrack
                                  trackRef={{
                                    participant: p.participant,
                                    source: Track.Source.Camera,
                                    publication: camPub,
                                  }}
                                />
                              ) : (
                                <div className="webcam-sidebar-avatar">
                                  {getInitials(p.name || p.id || '?')}
                                </div>
                              )}
                            </div>
                            <div className="webcam-sidebar-meta">
                              {micMuted && (
                                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style={{ opacity: 0.6 }}>
                                  <path d="M12.227 11.52a5.477 5.477 0 0 0 1.246-2.97.5.5 0 0 0-.995-.1 4.478 4.478 0 0 1-.962 2.359l-1.07-1.07C10.794 9.247 11 8.647 11 8V3a3 3 0 0 0-6 0v1.293L1.354.646a.5.5 0 1 0-.708.708l14 14a.5.5 0 0 0 .708-.708zM8 12.5c.683 0 1.33-.152 1.911-.425l.743.743c-.649.359-1.378.59-2.154.66V15h2a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1h2v-1.522a5.502 5.502 0 0 1-4.973-4.929.5.5 0 0 1 .995-.098A4.5 4.5 0 0 0 8 12.5z" />
                                  <path d="M8.743 10.907 5 7.164V8a3 3 0 0 0 3.743 2.907z" />
                                </svg>
                              )}
                              <span className="webcam-sidebar-name">{p.name}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
          </div>

          {/* VideoConference: always visible when not in pure LiveDoc mode */}
          <div
            className={`sky-meet-video-wrapper ${isWebcamSidebarCollapsed ? 'sidebar-collapsed' : ''} ${screenShareActive ? 'presenter-sharing' : ''} ${isMirrorBlocked ? 'mirror-blocked' : ''}`}
            style={{
              flex: 1,
              position: 'relative',
              display: isPureLiveDoc && (!hasScreenShare || isLocalScreenShare) ? 'none' : 'block',
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                  <span className="badge-text">
                    {(() => {
                      if (screenShareActive) return t('toolbar.previewAnotherTab');
                      const sharing = Array.from(room.remoteParticipants.values()).find(p => p.isScreenShareEnabled);
                      const name = sharing?.name || sharing?.identity || 'Attendee';
                      return t('toolbar.viewingAttendeeScreen', { name });
                    })()}
                  </span>
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
          {activeView !== 'webcam' && !showWebcamSidebar &&
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
                            {getInitials(p.name || p.id || '?')}
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
                                        {getInitials(p.name)}
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
                  canMuteAll={isHost || isCohost || isCopresenter || isAutoPresenter}
                  muteAllActive={muteAllActive}
                  onMuteAll={handleMuteAll}
                  onUnmuteAll={handleUnmuteAll}
                  onMuteParticipant={isHost || isCohost ? handleMuteParticipant : undefined}
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
              /* .screenshare-overlay-badge moved to static block for simpler transitions */

            `
              : ''
            }

            /* ═══ Always-available styles (floating panel, chat overlay) ═══ */

            /* Screenshare Overlays */
            .screenshare-overlay-container {
               position: absolute;
               bottom: 80px; /* Above toolbar */
               left: 20px;
               width: auto;
               pointer-events: none;
               display: flex;
               justify-content: flex-start;
               align-items: flex-end;
               z-index: 100;
            }
            .screenshare-overlay-badge {
               pointer-events: auto;
               background: rgba(15, 23, 42, 0.4);
               color: rgba(255, 255, 255, 0.7);
               padding: 6px;
               border-radius: 8px;
               font-size: 13px;
               font-weight: 500;
               backdrop-filter: blur(12px);
               border: 1px solid rgba(255,255,255,0.08);
               box-shadow: 0 2px 8px rgba(0,0,0,0.2);
               transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
               display: flex;
               align-items: center;
               gap: 0;
               cursor: default;
               max-width: 32px;
               overflow: hidden;
               white-space: nowrap;
            }
            .screenshare-overlay-badge svg {
               flex-shrink: 0;
               width: 18px;
               height: 18px;
               opacity: 0.8;
               margin: 0 1px;
               transition: all 0.3s ease;
            }
            .screenshare-overlay-badge .badge-text {
               opacity: 0;
               width: 0;
               overflow: hidden;
               transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            .screenshare-overlay-container:hover .screenshare-overlay-badge,
            .screenshare-overlay-badge:hover,
            .screenshare-overlay-badge:active {
               background: rgba(15, 23, 42, 0.85);
               color: #fff;
               padding: 6px 14px;
               max-width: 300px;
               gap: 8px;
               border-color: rgba(255,255,255,0.15);
               box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            }
            .screenshare-overlay-badge:hover svg,
            .screenshare-overlay-badge:active svg {
               opacity: 1;
               margin: 0;
            }
            .screenshare-overlay-badge:hover .badge-text,
            .screenshare-overlay-badge:active .badge-text {
               opacity: 1;
               width: auto;
            }
            @media (max-width: 768px) {
               .screenshare-overlay-container { bottom: auto; top: 72px; left: 10px; }
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

            /* ── Right webcam sidebar (LiveDoc + postMessage) ─── */
            .webcam-sidebar-panel {
               width: 200px;
               flex-shrink: 0;
               background: #0f172a;
               border-left: 1px solid rgba(255,255,255,0.08);
               display: flex;
               flex-direction: column;
               overflow-y: auto;
               overflow-x: hidden;
            }
            .webcam-sidebar-tiles {
               display: flex;
               flex-direction: column;
               gap: 8px;
               padding: 10px 10px;
            }
            .webcam-sidebar-tile {
               border-radius: 10px;
               overflow: hidden;
               background: #1e293b;
            }
            .webcam-sidebar-video {
               width: 100%;
               aspect-ratio: 16 / 10;
               position: relative;
               background: #0f172a;
            }
            .webcam-sidebar-video video {
               width: 100%;
               height: 100%;
               object-fit: cover;
            }
            .webcam-sidebar-avatar {
               width: 100%;
               height: 100%;
               background: linear-gradient(135deg, #3b82f6, #6366f1);
               color: #fff;
               font-size: 22px;
               font-weight: 700;
               display: flex;
               align-items: center;
               justify-content: center;
            }
            .webcam-sidebar-meta {
               display: flex;
               align-items: center;
               gap: 4px;
               padding: 4px 8px 6px;
               background: rgba(0,0,0,0.45);
               color: rgba(255,255,255,0.8);
               font-size: 11px;
               font-weight: 500;
            }
            .webcam-sidebar-name {
               overflow: hidden;
               text-overflow: ellipsis;
               white-space: nowrap;
            }
            .webcam-sidebar-header {
               display: flex;
               align-items: center;
               justify-content: space-between;
               padding: 8px 10px;
               border-bottom: 1px solid rgba(255,255,255,0.08);
               flex-shrink: 0;
            }
            .webcam-sidebar-icon-btn {
               background: none;
               border: none;
               color: rgba(255,255,255,0.7);
               cursor: pointer;
               padding: 6px;
               border-radius: 6px;
               display: flex;
               align-items: center;
               justify-content: center;
               transition: background 0.15s, color 0.15s;
            }
            .webcam-sidebar-icon-btn:hover {
               background: rgba(255,255,255,0.1);
               color: #fff;
            }
            .webcam-sidebar-dropdown {
               position: absolute;
               top: 100%;
               left: 0;
               margin-top: 4px;
               background: rgba(15, 23, 42, 0.98);
               border: 1px solid rgba(255,255,255,0.12);
               border-radius: 10px;
               padding: 4px;
               min-width: 140px;
               box-shadow: 0 8px 24px rgba(0,0,0,0.5);
               z-index: 100;
            }
            .webcam-sidebar-dropdown-item {
               display: flex;
               align-items: center;
               gap: 8px;
               width: 100%;
               background: none;
               border: none;
               color: rgba(255,255,255,0.75);
               font-size: 12px;
               font-weight: 500;
               padding: 7px 10px;
               border-radius: 7px;
               cursor: pointer;
               transition: background 0.15s;
            }
            .webcam-sidebar-dropdown-item:hover {
               background: rgba(255,255,255,0.08);
               color: #fff;
            }
            .webcam-sidebar-dropdown-item.active {
               background: rgba(124, 58, 237, 0.25);
               color: #a78bfa;
            }
            .webcam-sidebar-icon-btn.file-btn {
               background: rgba(124, 58, 237, 0.3);
               color: #a78bfa;
            }
            .webcam-sidebar-icon-btn.file-btn:hover {
               background: rgba(124, 58, 237, 0.5);
               color: #c4b5fd;
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

            /* ══════════════════════════════════════════════════════
               Custom Microphone Indicator DOM Injection
               Replaces LiveKit's missing "mic on" DOM states
               ══════════════════════════════════════════════════════ */

            /* Completely hide LiveKit's default microphone indicator */
            .lk-grid-layout-wrapper .lk-track-muted-indicator-microphone {
              display: none !important;
            }

            /* Our custom injected microphone indicator styling */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator {
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
              width: 1.15rem;
              height: 1.15rem;
              flex-shrink: 0;
              transition: all 0.2s ease;
            }

            /* Add red drop-shadow pulsing just for the force-muted state */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-force-muted="true"] {
              width: 1.4rem;
              height: 1.4rem;
              filter: drop-shadow(0 0 5px rgba(255, 32, 32, 0.8));
              animation: kloud-mic-alert-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            }

            @keyframes kloud-mic-alert-pulse {
              0%, 100% { opacity: 1; transform: scale(1); }
              50% { opacity: 0.7; transform: scale(0.9); }
            }

            /* Host hover interactions */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator.operator-interactive {
              cursor: pointer;
              border-radius: 50%;
              padding: 4px;          /* larger hit area */
              min-width: 1.6rem;
              min-height: 1.6rem;
              margin: -2px;          /* compensate for extra padding */
            }
            /* SVG inside mic indicator must not steal pointer events */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator svg,
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator svg * {
              pointer-events: none;
            }
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator.operator-interactive:hover {
              background: rgba(255, 255, 255, 0.18);
              transform: scale(1.2);
            }
          `}</style>
        </div>

        {/* Captions overlay — visible to all participants when host enables captions */}
        <CaptionsOverlay captionsInfo={captionsInfo} bottomOffset={90} />

        {/* Custom toolbar overlay */}
        <KloudMeetToolbar
          activeView={activeView}
          onViewChange={handleViewChange}
          onExit={handleLeaveWithSave}
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
          canMuteAll={isHost || isCohost || isCopresenter || isAutoPresenter}
          muteAllActive={muteAllActive}
          onMuteAll={handleMuteAll}
          onUnmuteAll={handleUnmuteAll}
          isMutedByHost={(muteAllActive || hostMutedIdentities.includes(room.localParticipant.identity)) && !micEnabled && !(isHost || isCohost)}
          canToggleCaptions={isHost || isCohost}
          captionsEnabled={captionsRunning}
          onToggleCaptions={handleToggleCaptions}
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
                canMuteAll={isHost || isCohost || isCopresenter || isAutoPresenter}
                muteAllActive={muteAllActive}
                onMuteAll={handleMuteAll}
                onUnmuteAll={handleUnmuteAll}
                onMuteParticipant={isHost || isCohost ? handleMuteParticipant : undefined}
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

        {/* Recording: unified consent dialog — no intermediate page */}
        {showRecordPopup && (
          <div className="kloud-modal-overlay" onMouseDown={() => setShowRecordPopup(false)}>
            <div className="kloud-modal kloud-modal-center" onMouseDown={e => e.stopPropagation()}>
              <div className="kloud-modal-body">
                {/* Icon + title */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#6d28d9" strokeWidth="1.5" width="32" height="32">
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="12" r="3" fill="#ef4444" stroke="none" />
                  </svg>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#111827' }}>{t('toolbar.everyoneReady')}</h3>
                </div>
                <p style={{ fontSize: '13px', color: '#4b5563', lineHeight: 1.6, margin: '0 0 20px' }}>
                  {t('toolbar.consentNotice')}
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button className="kloud-btn-text" onClick={() => setShowRecordPopup(false)}>{t('common.cancel')}</button>
                  <button className="kloud-btn-primary" onClick={() => {
                    setShowRecordPopup(false);
                    handleToggleRecording('start');
                  }}>{t('toolbar.startRecording')}</button>
                </div>
              </div>
            </div>
          </div>
        )}



        <style>{`
          .kloud-modal-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;
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
          /* Mobile: recording/meeting modals go centered, not side-panel */
          @media (max-width: 768px) {
            .kloud-modal-side {
              position: relative !important;
              right: auto !important; top: auto !important; bottom: auto !important;
              width: 90vw !important; max-width: 380px;
              height: auto !important; max-height: 85vh;
              border-radius: 16px !important;
            }
            .kloud-modal-overlay {
              align-items: center !important;
              padding: 16px;
            }
          }
        `}</style>

        <DebugMode />
        <RecordingIndicator />
        <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
      </RoomContext.Provider>
    </div>
  );
}
