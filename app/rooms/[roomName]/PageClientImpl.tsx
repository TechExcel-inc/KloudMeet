'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { KloudMeetToolbar, ViewMode, buildInviteLinkForClipboard } from '@/lib/KloudMeetToolbar';
import { HelpModal } from '@/lib/HelpModal';
import { UserAvatarMenu } from '@/lib/UserAvatarMenu';
import { SystemSettingsModal } from '@/lib/SystemSettingsModal';
import { MyProfileModal } from '@/lib/MyProfileModal';
import type { AuthUser } from '@/app/home/types';
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
  TrackMutedIndicator,
  useIsSpeaking,
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
  Participant,
  TrackPublishDefaults,
  VideoCaptureOptions,
  ScreenShareCaptureOptions,
  Track,
  DataPacket_Kind,
} from 'livekit-client';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';
import { ChatPanel, AttendeePanel, chatAndAttendeeStyles } from '@/lib/ChatAndAttendeePanel';
import { getInitials } from '@/lib/getInitials';
import { useDesktopAppLaunch } from '@/lib/useDesktopAppLaunch';
import { handleKloudSessionExpired } from '@/lib/handleKloudSessionExpired';
import { VideoConferenceComponent } from './VideoConferenceComponent';
import { connectionDetailsFetchInit, authHeaders } from '@/lib/kloudSession';
import {
  fetchPersonalRoomResolve,
  getResolvedLiveRoomName,
} from '@/lib/personalRoomResolveClient';
import { isCurrentUserMeetingCreator } from '@/lib/meetingOwner';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { RoomEntryLoading } from '@/lib/RoomEntryLoading';
import { PrejoinPersonalRoomCheckbox } from '@/lib/PrejoinPersonalRoomCheckbox';
import { PREJOIN_ORIGINAL_ROOM_SESSION_KEY, cancelAbandonedInstantMeeting } from '@/lib/prejoinPersonalRoom';
import { SCREEN_SHARE_CAPTURE } from './roomConstants';
import { replaceBrowserRoomUrl } from '@/lib/roomUrl';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';

const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
}) {
  const { openDesktopEntry, desktopLaunchModal } = useDesktopAppLaunch();
  const searchParams = useSearchParams();
  const isBot = searchParams?.get('isBot') === 'true';

  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );

  const [prejoinReady, setPrejoinReady] = React.useState(false);
  const [resolveReady, setResolveReady] = React.useState(false);
  const [entryLoadError, setEntryLoadError] = React.useState<string | null>(null);
  const [resolveEpoch, setResolveEpoch] = React.useState(0);
  /** 个人房入口解析出的真实会场；非 null 时访客一次 Join 直连该 room */
  const [resolvedLiveRoom, setResolvedLiveRoom] = React.useState<string | null>(
    null,
  );
  /** 地址栏 / PreJoin 当前生效会议号（replaceState 后与 Next 路由 props.roomName 可能不同）。 */
  const [effectiveRoomName, setEffectiveRoomName] = React.useState(props.roomName);
  const routeRoomName = props.roomName;

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

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const u = new URL(window.location.href);
    if (u.search) {
      replaceBrowserRoomUrl(effectiveRoomName);
    }
  }, [effectiveRoomName]);

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
  const [currentUser, setCurrentUser] = React.useState<AuthUser | null>(null);
  const [isSameTabRefresh, setIsSameTabRefresh] = React.useState(false);
  const [elapsedTime, setElapsedTime] = React.useState('');
  const { t, locale, setLocale } = useI18n();
  const [showLangMenu, setShowLangMenu] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);
  const [showSettingsModal, setShowSettingsModal] = React.useState(false);
  const [showProfileModal, setShowProfileModal] = React.useState(false);
  const [personalRoomUrlEnabled, setPersonalRoomUrlEnabled] = React.useState(false);
  const [hostPersonalRoomId, setHostPersonalRoomId] = React.useState('');

  const applyMeetingInfo = React.useCallback((data: Record<string, unknown>) => {
    if (data.error) return;
    setMeetingInfo(data);
    if (data.id) localStorage.setItem('activeMeetingId', String(data.id));
    if (data.actualStartedAt) {
      localStorage.setItem('activeMeetingStartedAt', String(data.actualStartedAt));
    } else if (data.startedAt) {
      localStorage.setItem('activeMeetingStartedAt', String(data.startedAt));
    }
  }, []);

  const loadMeetingInfo = React.useCallback(
    async (roomName: string) => {
      try {
        const res = await fetchWithTimeout(
          `/api/meetings/${encodeURIComponent(roomName)}`,
          { headers: authHeaders() },
          12_000,
        );
        const data = await res.json();
        applyMeetingInfo(data);
        return data;
      } catch (e) {
        console.error(e);
        return null;
      }
    },
    [applyMeetingInfo],
  );

  const retryEntryLoad = React.useCallback(() => {
    setEntryLoadError(null);
    setResolveReady(false);
    setResolveEpoch((n) => n + 1);
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    setResolveReady(false);
    setResolvedLiveRoom(null);
    setMeetingInfo(null);
    setEntryLoadError(null);

    (async () => {
      try {
        setEntryLoadError(null);

        let kloudUser: { id?: number | string } | null = null;
        if (typeof window !== 'undefined') {
          try {
            const stored = localStorage.getItem('kloudUser');
            if (stored) {
              kloudUser = JSON.parse(stored);
              if (!cancelled) setCurrentUser(kloudUser as AuthUser);
            }
            if (sessionStorage.getItem('activeKloudRoom') === routeRoomName) {
              if (!cancelled) setIsSameTabRefresh(true);
            }
          } catch {
            /* ignore */
          }
        }

        const initialMeeting = await loadMeetingInfo(props.roomName);
        if (cancelled) return;

        // 发起人已在真实会场（如 /rooms/yieg-kgxf）：不调用 resolve，直接按原逻辑入会
        if (isCurrentUserMeetingCreator(initialMeeting, kloudUser)) {
          setResolvedLiveRoom(null);
          return;
        }

        const resolved = await fetchPersonalRoomResolve(props.roomName);
        if (cancelled) return;

        setResolvedLiveRoom(getResolvedLiveRoomName(props.roomName, resolved));
        const infoRoom =
          resolved?.kind === 'join_live'
            ? resolved.effectiveRoomName
            : props.roomName;
        if (
          infoRoom.toLowerCase() !== props.roomName.toLowerCase() ||
          !initialMeeting?.createdByMemberId
        ) {
          await loadMeetingInfo(infoRoom);
        }
      } catch (e) {
        console.error('[PageClientImpl] meeting entry init failed', e);
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setEntryLoadError(msg);
        }
      } finally {
        if (!cancelled) {
          setResolveReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeRoomName, loadMeetingInfo, resolveEpoch]);

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

  const isMeetingCreator = React.useMemo(
    () => isCurrentUserMeetingCreator(meetingInfo, currentUser),
    [meetingInfo, currentUser],
  );

  const isHost = isMeetingCreator;

  const handlePrejoinSignOut = React.useCallback(() => {
    try {
      localStorage.removeItem('kloudUser');
    } catch {
      /* ignore */
    }
    window.location.href = '/';
  }, []);

  React.useEffect(() => {
    setEffectiveRoomName(routeRoomName);
    setPersonalRoomUrlEnabled(false);
    try {
      sessionStorage.removeItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, [routeRoomName]);

  React.useEffect(() => {
    if (!hostPersonalRoomId || !isHost || connectionDetails) {
      return;
    }

    if (personalRoomUrlEnabled) {
      if (effectiveRoomName.toLowerCase() === hostPersonalRoomId.toLowerCase()) {
        return;
      }
      try {
        sessionStorage.setItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY, routeRoomName);
      } catch {
        /* ignore */
      }
      replaceBrowserRoomUrl(hostPersonalRoomId);
      setEffectiveRoomName(hostPersonalRoomId);
      void loadMeetingInfo(hostPersonalRoomId);
      return;
    }

    try {
      const original = sessionStorage.getItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY);
      if (!original) {
        return;
      }
      sessionStorage.removeItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY);
      replaceBrowserRoomUrl(original);
      setEffectiveRoomName(original);
      void loadMeetingInfo(original);
    } catch {
      /* ignore */
    }
  }, [
    hostPersonalRoomId,
    personalRoomUrlEnabled,
    isHost,
    connectionDetails,
    routeRoomName,
    effectiveRoomName,
    loadMeetingInfo,
  ]);

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

  const handlePreJoinSubmit = React.useCallback(
    async (values: LocalUserChoices) => {
      try {
        localStorage.setItem(
          'lk-user-choices',
          JSON.stringify({
            ...values,
            audioDeviceId: values.audioDeviceId ?? '',
            videoDeviceId: values.videoDeviceId ?? '',
          }),
        );
      } catch {
        /* ignore */
      }

      const roomToJoin =
        isMeetingCreator && personalRoomUrlEnabled && hostPersonalRoomId
          ? hostPersonalRoomId
          : !isMeetingCreator && resolvedLiveRoom
            ? resolvedLiveRoom
            : effectiveRoomName;

      try {
        setPreJoinChoices(values);
        const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
        url.searchParams.append('roomName', roomToJoin);
        url.searchParams.append('participantName', values.username);
        if (props.region) {
          url.searchParams.append('region', props.region);
        }
        const connectionDetailsResp = await fetchWithTimeout(
          url.toString(),
          connectionDetailsFetchInit(),
          15_000,
        );
        if (connectionDetailsResp.status === 401) {
          handleKloudSessionExpired();
          return;
        }
        if (!connectionDetailsResp.ok) {
          throw new Error(
            `Server error ${connectionDetailsResp.status}: ${await connectionDetailsResp.text()}`,
          );
        }
        const connectionDetailsData = await connectionDetailsResp.json();
        setConnectionDetails(connectionDetailsData);

        if (typeof window !== 'undefined') {
          sessionStorage.setItem('activeKloudRoom', roomToJoin);
          const abandonedRoom = sessionStorage.getItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY);
          try {
            sessionStorage.removeItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY);
          } catch {
            /* ignore */
          }
          if (
            abandonedRoom &&
            hostPersonalRoomId &&
            abandonedRoom.toLowerCase() !== roomToJoin.toLowerCase() &&
            roomToJoin.toLowerCase() === hostPersonalRoomId.toLowerCase()
          ) {
            void cancelAbandonedInstantMeeting(abandonedRoom);
          }
          replaceBrowserRoomUrl(roomToJoin);
          setEffectiveRoomName(roomToJoin);
        }
      } catch (error: any) {
        console.error('Failed to get connection details:', error);
        alert(`${t('prejoin.connectError', { error: error.message })}`);
      }
    },
    [
      isMeetingCreator,
      personalRoomUrlEnabled,
      hostPersonalRoomId,
      resolvedLiveRoom,
      effectiveRoomName,
      props.region,
      t,
    ],
  );
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

  const canShowPreJoin = prejoinReady && resolveReady && !entryLoadError;

  if (
    (meetingInfo?.status === 'ENDED' || meetingInfo?.status === 'CANCELED') &&
    !meetingInfo?.isPersonalRoom
  ) {
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
        canShowPreJoin ? (
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
            .ead-icon-btn {
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
              .ead-toolbar-right {
                gap: 0.4rem;
              }
              .ead-btn {
                height: 36px;
              }
              .ead-icon-btn {
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
              <button className="ead-btn ead-icon-btn" title={t('nav.help')} onClick={() => { setShowLangMenu(false); setShowHelp(true); }}>
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
                  onClick={() => setShowLangMenu(!showLangMenu)}
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

              <UserAvatarMenu
                user={
                  currentUser
                    ? {
                        displayName: currentUser.displayName || currentUser.username,
                        avatarUrl: currentUser.avatarUrl,
                      }
                    : undefined
                }
                onSignIn={() => { window.location.href = '/'; }}
                onOpenProfile={() => setShowProfileModal(true)}
                onOpenSettings={() => setShowSettingsModal(true)}
                onOpenDesktopApp={() => openDesktopEntry('prejoin')}
                onSignOut={handlePrejoinSignOut}
                mobileOrgLabel={
                  currentUser
                    ? `${currentUser.displayName || currentUser.username}@Kloud Corp`
                    : undefined
                }
              />
            </div>
          </header>

          <div className="kloud-prejoin-header">
            <h2 className="kloud-prejoin-title">{preJoinTitle}</h2>
            <p className="kloud-prejoin-subtitle">{preJoinSubtitle}</p>
          </div>
          {!isBot && prejoinReady && (
            <>
              <PreJoin
                defaults={preJoinDefaults}
                onSubmit={handlePreJoinSubmit}
                onError={handlePreJoinError}
              />
              {isHost && (
                <PrejoinPersonalRoomCheckbox
                  active
                  routeRoomName={routeRoomName}
                  syncEnabled={personalRoomUrlEnabled}
                  onEnabledChange={setPersonalRoomUrlEnabled}
                  onPersonalRoomIdLoaded={setHostPersonalRoomId}
                />
              )}
            </>
          )}
          {!isBot && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: '0.4rem',
                maxWidth: '560px',
                margin: '0.6rem auto 0',
                zIndex: 2,
              }}
            >
              <button
                type="button"
                onClick={() => openDesktopEntry('prejoin')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#5b21b6',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textUnderlineOffset: '2px',
                  padding: 0,
                }}
              >
                {t('toolbar.openDesktop.menuItem')}
              </button>
              <span
                title={t('toolbar.openDesktop.prejoinTip')}
                aria-label={t('toolbar.openDesktop.prejoinTip')}
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  border: '1px solid #a78bfa',
                  color: '#6d28d9',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'help',
                  userSelect: 'none',
                  lineHeight: 1,
                }}
              >
                i
              </span>
            </div>
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
          <RoomEntryLoading
            error={entryLoadError}
            onRetry={entryLoadError ? retryEntryLoad : undefined}
          />
        )
      ) : (
        <div data-lk-theme="default" style={{ height: '100%' }}>
          <VideoConferenceComponent
            connectionDetails={connectionDetails}
            userChoices={preJoinChoices}
            meetingOwnerMemberId={
              meetingInfo?.createdByMemberId != null
                ? String(meetingInfo.createdByMemberId)
                : null
            }
            region={props.region}
            options={{ codec: props.codec, hq: props.hq }}
          />
        </div>
      )}

      {showSettingsModal && (
        <SystemSettingsModal
          onClose={() => setShowSettingsModal(false)}
          onSave={() => setShowSettingsModal(false)}
        />
      )}
      {showProfileModal && currentUser && (
        <MyProfileModal
          user={currentUser}
          onClose={() => setShowProfileModal(false)}
          onSave={({ avatarUrl: newAvatar, displayName: newName }) => {
            if (newAvatar || newName) {
              const updated = {
                ...currentUser,
                ...(newAvatar ? { avatarUrl: newAvatar } : {}),
                ...(newName ? { displayName: newName } : {}),
              };
              try {
                localStorage.setItem('kloudUser', JSON.stringify(updated));
              } catch {
                /* ignore */
              }
              setCurrentUser(updated);
            }
          }}
        />
      )}

      {/* Help Modal — always available (pre-join + in-meeting) */}
      {desktopLaunchModal}
      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </main>
  );
}
