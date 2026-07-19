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
import { PrejoinMeetingShareLink } from '@/lib/PrejoinMeetingShareLink';
import { PrejoinPersonalRoomCheckbox } from '@/lib/PrejoinPersonalRoomCheckbox';
import { KloudPreJoin } from '@/lib/KloudPreJoin';
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
import Image from 'next/image';
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
import {
  PREJOIN_ORIGINAL_ROOM_SESSION_KEY,
  cancelAbandonedInstantMeeting,
  createInstantMeetingRoom,
  readPrejoinPersonalRoomEnabled,
  readPrejoinPersonalRoomPreference,
} from '@/lib/prejoinPersonalRoom';
import { SCREEN_SHARE_CAPTURE } from './roomConstants';
import { replaceBrowserRoomUrl } from '@/lib/roomUrl';
import { appendKloudDeviceId } from '@/lib/kloudDeviceId';

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
    if (isBot) return;
    const u = new URL(window.location.href);
    if (u.search) {
      replaceBrowserRoomUrl(effectiveRoomName);
    }
  }, [effectiveRoomName, isBot]);

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
  const [theme, setTheme] = React.useState<'light' | 'dark'>('light');
  const [showLangMenu, setShowLangMenu] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);
  const [showSettingsModal, setShowSettingsModal] = React.useState(false);
  const [showProfileModal, setShowProfileModal] = React.useState(false);
  const [personalRoomUrlEnabled, setPersonalRoomUrlEnabled] = React.useState(() =>
    typeof window !== 'undefined' ? readPrejoinPersonalRoomEnabled() : false,
  );
  const [hostPersonalRoomId, setHostPersonalRoomId] = React.useState('');
  const creatingNewMeetingRef = React.useRef(false);
  const personalRoomAutoEnabledRef = React.useRef(false);
  const personalRoomSwitchCountRef = React.useRef(0);
  const [personalRoomSwitching, setPersonalRoomSwitching] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedTheme = window.localStorage.getItem('kloud-theme');
    const nextTheme: 'light' | 'dark' = storedTheme === 'light' ? 'light' : 'dark';
    setTheme(nextTheme);
  }, []);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem('kloud-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const beginPersonalRoomSwitch = React.useCallback(() => {
    personalRoomSwitchCountRef.current += 1;
    setPersonalRoomSwitching(true);
  }, []);

  const endPersonalRoomSwitch = React.useCallback(() => {
    personalRoomSwitchCountRef.current = Math.max(0, personalRoomSwitchCountRef.current - 1);
    if (personalRoomSwitchCountRef.current === 0) {
      setPersonalRoomSwitching(false);
    }
  }, []);

  const handlePersonalRoomIdLoaded = React.useCallback((personalRoomId: string) => {
    setHostPersonalRoomId(personalRoomId);
  }, []);

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

  /** 仅用户手动取消勾选时，从个人房入口切到新建随机会议（页面加载自动勾选不触发）。 */
  const handlePersonalRoomEnabledChange = React.useCallback(
    (enabled: boolean) => {
      setPersonalRoomUrlEnabled(enabled);
      if (enabled || !hostPersonalRoomId || connectionDetails || creatingNewMeetingRef.current) {
        return;
      }

      const personalKey = hostPersonalRoomId.toLowerCase();

      try {
        if (sessionStorage.getItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY)) {
          return;
        }
      } catch {
        /* ignore */
      }

      if (
        routeRoomName.toLowerCase() !== personalKey ||
        effectiveRoomName.toLowerCase() !== personalKey
      ) {
        return;
      }

      creatingNewMeetingRef.current = true;
      beginPersonalRoomSwitch();
      void (async () => {
        try {
          const newRoomId = await createInstantMeetingRoom();
          if (!newRoomId) {
            setPersonalRoomUrlEnabled(true);
            return;
          }
          try {
            sessionStorage.removeItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY);
          } catch {
            /* ignore */
          }
          replaceBrowserRoomUrl(newRoomId);
          setEffectiveRoomName(newRoomId);
          await loadMeetingInfo(newRoomId);
        } finally {
          creatingNewMeetingRef.current = false;
          endPersonalRoomSwitch();
        }
      })();
    },
    [
      hostPersonalRoomId,
      connectionDetails,
      routeRoomName,
      effectiveRoomName,
      loadMeetingInfo,
      beginPersonalRoomSwitch,
      endPersonalRoomSwitch,
    ],
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
  }, [routeRoomName, props.roomName, loadMeetingInfo, resolveEpoch]);

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
    creatingNewMeetingRef.current = false;
    personalRoomAutoEnabledRef.current = false;
    try {
      sessionStorage.removeItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY);
    } catch {
      /* ignore */
    }
    if (!hostPersonalRoomId) return;
    if (routeRoomName.toLowerCase() !== hostPersonalRoomId.toLowerCase()) {
      setPersonalRoomUrlEnabled(readPrejoinPersonalRoomEnabled());
    }
  }, [routeRoomName, hostPersonalRoomId]);

  /** 直接进入个人房 URL 时默认勾选个人会议室（仅首次进入，不覆盖用户手动取消）。 */
  React.useEffect(() => {
    if (!hostPersonalRoomId || connectionDetails || personalRoomAutoEnabledRef.current) {
      return;
    }
    if (routeRoomName.toLowerCase() !== hostPersonalRoomId.toLowerCase()) return;
    if (effectiveRoomName.toLowerCase() !== routeRoomName.toLowerCase()) return;
    personalRoomAutoEnabledRef.current = true;
    if (readPrejoinPersonalRoomPreference() !== false) {
      setPersonalRoomUrlEnabled(true);
    }
  }, [hostPersonalRoomId, routeRoomName, effectiveRoomName, connectionDetails]);

  React.useEffect(() => {
    if (!hostPersonalRoomId || !isHost || connectionDetails) {
      return;
    }

    const personalKey = hostPersonalRoomId.toLowerCase();
    const effectiveKey = effectiveRoomName.toLowerCase();

    if (personalRoomUrlEnabled) {
      if (effectiveKey === personalKey) {
        return;
      }
      try {
        if (!sessionStorage.getItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY)) {
          sessionStorage.setItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY, effectiveRoomName);
        }
      } catch {
        /* ignore */
      }
      beginPersonalRoomSwitch();
      void (async () => {
        try {
          replaceBrowserRoomUrl(hostPersonalRoomId);
          setEffectiveRoomName(hostPersonalRoomId);
          await loadMeetingInfo(hostPersonalRoomId);
        } finally {
          endPersonalRoomSwitch();
        }
      })();
      return;
    }

    try {
      const original = sessionStorage.getItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY);
      if (original) {
        if (effectiveKey === original.toLowerCase()) {
          return;
        }
        // 个人房入口取消勾选后不应把个人房号当作「原始房间」恢复（否则会覆盖新建随机会议 URL）
        if (
          routeRoomName.toLowerCase() === personalKey &&
          original.toLowerCase() === personalKey
        ) {
          sessionStorage.removeItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY);
          return;
        }
        beginPersonalRoomSwitch();
        void (async () => {
          try {
            sessionStorage.removeItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY);
            replaceBrowserRoomUrl(original);
            setEffectiveRoomName(original);
            await loadMeetingInfo(original);
          } finally {
            endPersonalRoomSwitch();
          }
        })();
        return;
      }
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
    beginPersonalRoomSwitch,
    endPersonalRoomSwitch,
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
    if (personalRoomSwitching) return t('common.loading');
    if (isHost && !isActive) return t('prejoin.startNow');
    if (isHost && isActive) return t('prejoin.joinAsHost');
    return t('prejoin.joinNow');
  }, [isHost, isActive, personalRoomSwitching, t]);

  const handlePreJoinSubmit = React.useCallback(
    async (values: LocalUserChoices) => {
      if (personalRoomSwitching) return;
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
        appendKloudDeviceId(url);
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

        const joinedRoomName =
          typeof connectionDetailsData?.roomName === 'string'
            ? connectionDetailsData.roomName
            : roomToJoin;

        if (typeof window !== 'undefined') {
          sessionStorage.setItem('activeKloudRoom', joinedRoomName);
          const abandonedRoom = sessionStorage.getItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY);
          try {
            sessionStorage.removeItem(PREJOIN_ORIGINAL_ROOM_SESSION_KEY);
          } catch {
            /* ignore */
          }
          if (
            abandonedRoom &&
            hostPersonalRoomId &&
            abandonedRoom.toLowerCase() !== joinedRoomName.toLowerCase() &&
            joinedRoomName.toLowerCase() === hostPersonalRoomId.toLowerCase()
          ) {
            void cancelAbandonedInstantMeeting(abandonedRoom);
          }
          replaceBrowserRoomUrl(joinedRoomName);
          setEffectiveRoomName(joinedRoomName);
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
      personalRoomSwitching,
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
      'getusermedia', 'enumeratedevices', 'cannot read properties of undefined', 'mediadevices',
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
        <div
          className={`kloud-prejoin-wrapper${personalRoomSwitching ? ' kloud-prejoin-room-switching' : ''}`}
          style={{
            display: isBot ? 'none' : undefined,
          }}
        >
          <style>{`

            /* Keep toggle controls purple, but not the dropdown list content. */
            .kloud-prejoin-wrapper .lk-button-group {
              background: transparent !important;
            }
            .kloud-prejoin-wrapper .lk-button-group > .lk-button,
            .kloud-prejoin-wrapper .lk-button-group > .lk-button-group-menu > .lk-button-menu {
              background: linear-gradient(135deg, #6d28d9, #7c3aed) !important;
            }
            .kloud-prejoin-wrapper .lk-button-group > .lk-button:hover,
            .kloud-prejoin-wrapper .lk-button-group > .lk-button-group-menu > .lk-button-menu:hover {
              background: linear-gradient(135deg, #5b21b6, #6d28d9) !important;
            }

            /* ── Device selection popup — polished dropdown style ── */
            .kloud-prejoin-wrapper .lk-device-menu {
              background: #ffffff !important;
              border: 1px solid #cbd5e1 !important;
              border-radius: 12px !important;
              box-shadow: 0 18px 36px rgba(15, 23, 42, 0.22) !important;
              padding: 6px !important;
              max-height: 280px !important;
              overflow-y: auto !important;
              overflow-x: hidden !important;
              min-width: 300px !important;
              scrollbar-width: thin;
              scrollbar-color: #94a3b8 transparent;
            }

            .kloud-prejoin-wrapper .lk-device-menu ul,
            .kloud-prejoin-wrapper .lk-device-menu .lk-list {
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

            .kloud-prejoin-wrapper .lk-device-menu::-webkit-scrollbar { width: 6px; }
            .kloud-prejoin-wrapper .lk-device-menu::-webkit-scrollbar-track { background: transparent; }
            .kloud-prejoin-wrapper .lk-device-menu::-webkit-scrollbar-thumb {
              background: #94a3b8;
              border-radius: 8px;
            }

            .kloud-prejoin-wrapper .lk-device-menu li {
              padding: 0 !important;
              margin: 1px 0 !important;
              list-style: none !important;
              border-radius: 8px !important;
              overflow: hidden !important;
            }

            .kloud-prejoin-wrapper .lk-device-menu li button,
            .kloud-prejoin-wrapper .lk-device-menu button:not([class*="lk-button-group"]),
            .kloud-prejoin-wrapper .lk-device-menu .lk-button {
              background: transparent !important;
              background-image: none !important;
              color: #1f2937 !important;
              border-radius: 8px !important;
              padding: 11px 14px 11px 40px !important;
              font-size: 0.92rem !important;
              font-weight: 500 !important;
              text-align: left !important;
              width: 100% !important;
              border: none !important;
              box-shadow: none !important;
              cursor: pointer !important;
              transition: background 0.16s, color 0.16s !important;
              position: relative !important;
              white-space: nowrap !important;
              overflow: hidden !important;
              text-overflow: ellipsis !important;
              display: block !important;
            }

            .kloud-prejoin-wrapper .lk-device-menu li button:hover {
              background: #eff3ff !important;
              color: #1e1b4b !important;
            }

            .kloud-prejoin-wrapper .lk-device-menu li[aria-selected="true"] button,
            .kloud-prejoin-wrapper .lk-device-menu button[aria-selected="true"],
            .kloud-prejoin-wrapper .lk-device-menu li button[data-lk-active="true"],
            .kloud-prejoin-wrapper .lk-device-menu li.lk-list-item--active button,
            .kloud-prejoin-wrapper .lk-device-menu li button.lk-active {
              background: linear-gradient(135deg, #6d28d9, #7c3aed) !important;
              color: #ffffff !important;
              font-weight: 700 !important;
            }

            .kloud-prejoin-wrapper .lk-device-menu li[aria-selected="true"] button::before,
            .kloud-prejoin-wrapper .lk-device-menu button[aria-selected="true"]::before,
            .kloud-prejoin-wrapper .lk-device-menu li button[data-lk-active="true"]::before,
            .kloud-prejoin-wrapper .lk-device-menu li.lk-list-item--active button::before,
            .kloud-prejoin-wrapper .lk-device-menu li button.lk-active::before {
              content: '';
              position: absolute !important;
              left: 15px !important;
              top: 50% !important;
              transform: translateY(-50%) rotate(45deg) !important;
              width: 6px !important;
              height: 11px !important;
              border-right: 2px solid #ffffff !important;
              border-bottom: 2px solid #ffffff !important;
              display: block !important;
            }

            .kloud-prejoin-wrapper .lk-device-menu li button:not(.lk-active)::before {
              content: '' !important;
              display: none !important;
            }

            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu {
              background: #0b1734 !important;
              border-color: #374151 !important;
              box-shadow: 0 24px 46px rgba(2, 6, 23, 0.62) !important;
              scrollbar-color: #475569 transparent;
            }
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu::-webkit-scrollbar-thumb {
              background: #475569;
            }
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu li button,
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu button:not([class*="lk-button-group"]),
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu .lk-button {
              color: #e5e7eb !important;
            }
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu li button:hover {
              background: #1e293b !important;
              color: #f8fafc !important;
            }
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu li[aria-selected="true"] button,
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu button[aria-selected="true"],
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu li button[data-lk-active="true"],
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu li.lk-list-item--active button,
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu li button.lk-active {
              background: linear-gradient(135deg, #6d28d9, #7c3aed) !important;
              color: #ffffff !important;
            }
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu li[aria-selected="true"] button::before,
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu button[aria-selected="true"]::before,
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu li button[data-lk-active="true"]::before,
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu li.lk-list-item--active button::before,
            html[data-theme='dark'] .kloud-prejoin-wrapper .lk-device-menu li button.lk-active::before {
              border-right-color: #ffffff !important;
              border-bottom-color: #ffffff !important;
            }

            /* ── Microphone & Camera button group: rounded to match input field ── */
            .kloud-prejoin-wrapper .lk-button-group {
              border-radius: 10px !important;
              overflow: visible !important;
            }
            .kloud-prejoin-wrapper .lk-button-group > button:first-child {
              border-radius: 10px 0 0 10px !important;
            }
            .kloud-prejoin-wrapper .lk-button-group > button:last-child,
            .kloud-prejoin-wrapper .lk-button-group > div:last-child {
              border-radius: 0 10px 10px 0 !important;
            }
            .kloud-prejoin-wrapper .lk-button-group-menu {
              position: relative;
              z-index: 5;
            }
            .kloud-prejoin-wrapper .lk-device-menu {
              z-index: 40;
            }

            .kloud-prejoin-share-link-block {
              width: 100%;
              margin-top: 10px;
            }
            .kloud-prejoin-share-link-label {
              font-size: 0.88rem;
              font-weight: 600;
              color: #2f3a4d;
              margin: 0 0 10px;
            }
            .kloud-prejoin-share-link-box {
              background: linear-gradient(180deg, #f8f9fc 0%, #f3f4f8 100%);
              border: 1px solid #e4e8f0;
              border-radius: 12px;
              padding: 12px 14px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
              font-size: 0.95rem;
              color: #1f2937;
              width: 100%;
              box-sizing: border-box;
            }
            .kloud-prejoin-share-link-box button {
              background: none;
              border: none;
              cursor: pointer;
              color: #4f5b6d;
              padding: 4px;
              border-radius: 4px;
              display: flex;
              align-items: center;
              flex-shrink: 0;
            }
            .kloud-prejoin-share-link-box button:hover {
              background: #e7ebf2;
              color: #111827;
            }
            html[data-theme='dark'] .kloud-prejoin-share-link-label {
              color: #cbd5e1;
            }
            html[data-theme='dark'] .kloud-prejoin-share-link-box {
              background: linear-gradient(180deg, #1f2937 0%, #111827 100%);
              border-color: #374151;
              color: #e5e7eb;
            }
            html[data-theme='dark'] .kloud-prejoin-share-link-box button {
              color: #94a3b8;
            }
            html[data-theme='dark'] .kloud-prejoin-share-link-box button:hover {
              background: #374151;
              color: #e5e7eb;
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
            .ead-btn-theme-active {
              background: #e0e7ff;
              border-color: #818cf8;
              color: #3730a3;
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

            html[data-theme='dark'] .kloud-prejoin-logo-toolbar {
              color: #e5e7eb;
            }
            html[data-theme='dark'] .ead-btn {
              background: #0f172a;
              border-color: #334155;
              color: #cbd5e1;
            }
            html[data-theme='dark'] .ead-btn:hover {
              background: #1e293b;
              border-color: #475569;
              color: #f8fafc;
            }
            html[data-theme='dark'] .ead-btn-theme-active {
              background: #1e3a8a;
              border-color: #60a5fa;
              color: #dbeafe;
            }
            html[data-theme='dark'] .ead-pill-btn {
              color: #e2e8f0;
            }
            html[data-theme='dark'] .ead-dropdown-menu {
              background: #0f172a;
              border-color: #334155;
              box-shadow: 0 16px 36px rgba(2,6,23,0.6);
            }
            html[data-theme='dark'] .ead-menu-header {
              color: #94a3b8;
              border-bottom-color: #334155;
            }
            html[data-theme='dark'] .ead-menu-item {
              color: #cbd5e1;
            }
            html[data-theme='dark'] .ead-menu-item:hover {
              background: #1e293b;
              color: #f8fafc;
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
                <Image
                  src={theme === 'dark' ? '/images/kloud-header-logo-white.svg' : '/images/kloud-header-logo.svg'}
                  alt="Kloud Meet"
                  width={120}
                  height={36}
                  style={{ display: 'block', transform: 'translateY(4px)' }}
                />
              </Link>
            </div>

            <div className="ead-toolbar-right">
              <button
                className={`ead-btn ead-icon-btn ${theme === 'dark' ? 'ead-btn-theme-active' : ''}`}
                title={theme === 'dark' ? t('nav.switchLightTheme') : t('nav.switchDarkTheme')}
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="19" height="19">
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="12" y1="1" x2="12" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="23"></line>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                    <line x1="1" y1="12" x2="3" y2="12"></line>
                    <line x1="21" y1="12" x2="23" y2="12"></line>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="19" height="19">
                    <path d="M21 12.79A9 9 0 1111.21 3c0 .28-.01.56-.01.84A7 7 0 0021 12.79z"></path>
                  </svg>
                )}
              </button>

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

              {currentUser && (
                <UserAvatarMenu
                  user={{
                    displayName: currentUser.displayName || currentUser.username,
                    avatarUrl: currentUser.avatarUrl,
                  }}
                  onOpenProfile={() => setShowProfileModal(true)}
                  onOpenSettings={() => setShowSettingsModal(true)}
                  onOpenDesktopApp={() => openDesktopEntry('prejoin')}
                  onSignOut={handlePrejoinSignOut}
                />
              )}
            </div>
          </header>

          <div className="kloud-prejoin-header">
            <h2 className="kloud-prejoin-title">{preJoinTitle}</h2>
            <p className="kloud-prejoin-subtitle">{preJoinSubtitle}</p>
          </div>
          {!isBot && prejoinReady && (
            <KloudPreJoin
              defaults={preJoinDefaults}
              onSubmit={handlePreJoinSubmit}
              onError={handlePreJoinError}
              joinLabel={preJoinButtonText}
              userLabel={t('prejoin.displayMyNameAs')}
              micLabel={t('prejoin.microphone')}
              camLabel={t('prejoin.webcam')}
              mediaUnavailableLabel={t('prejoin.mediaRequiresSecureContext')}
              joinButtonDisabled={personalRoomSwitching}
            >
              <PrejoinMeetingShareLink
                active={prejoinReady && !isBot}
                roomName={effectiveRoomName}
              />
              {isHost && (
                <PrejoinPersonalRoomCheckbox
                  active
                  syncEnabled={personalRoomUrlEnabled}
                  switching={personalRoomSwitching}
                  onEnabledChange={handlePersonalRoomEnabledChange}
                  onPersonalRoomIdLoaded={handlePersonalRoomIdLoaded}
                />
              )}
            </KloudPreJoin>
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
                  color: theme === 'dark' ? '#a5b4fc' : '#5b21b6',
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
                  border: theme === 'dark' ? '1px solid #818cf8' : '1px solid #a78bfa',
                  color: theme === 'dark' ? '#c7d2fe' : '#6d28d9',
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
