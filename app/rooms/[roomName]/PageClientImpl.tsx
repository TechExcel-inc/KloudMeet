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
import { PrejoinParticipantLiveDocSelect } from '@/lib/PrejoinParticipantLiveDocSelect';
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
import { ArrowLeft, Check, ChevronDown, CircleHelp, Globe, Info, Monitor, Moon, Sun } from 'lucide-react';
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
import prejoinStyles from '@/styles/PreJoin.module.css';
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
import {
  LK_USER_CHOICES_KEY,
  normalizeCaptureDeviceId,
  patchStoredUserMediaChoices,
  readStoredUserMediaChoices,
} from '@/lib/userMediaChoices';

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
      const base = readStoredUserMediaChoices();

      let username = typeof base.username === 'string' ? base.username : '';
      const storedKloud = localStorage.getItem('kloudUser');
      if (storedKloud) {
        const user = JSON.parse(storedKloud) as {
          displayName?: unknown;
          username?: unknown;
        };
        if (typeof user.displayName === 'string' && user.displayName) {
          username = user.displayName;
        } else if (typeof user.username === 'string' && user.username) {
          username = user.username;
        }
      }

      // 同步用户名；保留上次 audio/videoEnabled，并使用 LiveKit 的系统默认设备标识。
      patchStoredUserMediaChoices({
        username,
        audioDeviceId: 'default',
        videoDeviceId: 'default',
      });
    } catch {
      /* ignore */
    }
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
  /** 每次打开准备页都从「参会者可分享文档 AI」开始，不读取上场选择。 */
  const [participantLiveDocShow, setParticipantLiveDocShow] = React.useState(true);

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
            const activeRoom = sessionStorage.getItem('activeKloudRoom');
            if (
              activeRoom &&
              activeRoom.toLowerCase() === routeRoomName.toLowerCase()
            ) {
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

  const handleParticipantLiveDocChange = React.useCallback((show: boolean) => {
    setParticipantLiveDocShow(show);
  }, []);

  const preJoinDefaults = React.useMemo(() => {
    let defaultUsername = '';
    let videoEnabled = true;
    // 发起人准备页始终默认开麦；参会者仍沿用本地上次偏好
    let audioEnabled = true;
    if (typeof window !== 'undefined') {
      try {
        const storedChoices = readStoredUserMediaChoices();
        if (typeof storedChoices.username === 'string') {
          defaultUsername = storedChoices.username;
        }
        if (typeof storedChoices.videoEnabled === 'boolean') {
          videoEnabled = storedChoices.videoEnabled;
        }
        if (!isHost && typeof storedChoices.audioEnabled === 'boolean') {
          audioEnabled = storedChoices.audioEnabled;
        }

        const storedKloud = localStorage.getItem('kloudUser');
        if (storedKloud) {
          const user = JSON.parse(storedKloud) as {
            displayName?: unknown;
            username?: unknown;
          };
          if (typeof user.displayName === 'string' && user.displayName) {
            defaultUsername = user.displayName;
          } else if (typeof user.username === 'string' && user.username) {
            defaultUsername = user.username;
          }
        }
      } catch {
        /* ignore */
      }
    }
    return {
      username: defaultUsername,
      videoEnabled,
      audioEnabled: isHost ? true : audioEnabled,
      // Do NOT set audioDeviceId / videoDeviceId — let LiveKit pick system default
    };
  }, [isHost]);

  // 发起人进入准备页时，把开麦写回持久化偏好，避免 LiveKit 读到上次关麦
  React.useEffect(() => {
    if (!isHost || !prejoinReady) return;
    patchStoredUserMediaChoices({ audioEnabled: true });
  }, [isHost, prejoinReady]);

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
    // 同 tab 刷新重连：保持当前会场 URL，勿因个人房偏好切走
    if (isSameTabRefresh) return;
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
    isSameTabRefresh,
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
    if (isHost && !isActive) return t('prejoin.nobodyHereYet');
    if (isHost && isActive) return t('prejoin.alreadyHosting');
    if (meetingInfo?.startedAt) return t('prejoin.inProgress', { time: elapsedTime || '00:00' });
    return t('prejoin.checkDevices');
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
      const audioDeviceId = normalizeCaptureDeviceId(values.audioDeviceId) ?? 'default';
      const videoDeviceId = normalizeCaptureDeviceId(values.videoDeviceId) ?? 'default';
      try {
        localStorage.setItem(
          LK_USER_CHOICES_KEY,
          JSON.stringify({
            ...values,
            audioDeviceId,
            videoDeviceId,
          }),
        );
      } catch {
        /* ignore */
      }

      let roomToJoin =
        isMeetingCreator && personalRoomUrlEnabled && hostPersonalRoomId
          ? hostPersonalRoomId
          : !isMeetingCreator && resolvedLiveRoom
            ? resolvedLiveRoom
            : effectiveRoomName;

      // 刷新重连：始终回到本 tab 上次已加入的会场
      if (isSameTabRefresh && typeof window !== 'undefined') {
        try {
          const activeRoom = sessionStorage.getItem('activeKloudRoom');
          if (activeRoom) roomToJoin = activeRoom;
        } catch {
          /* ignore */
        }
      }

      try {
        setPreJoinChoices(values);
        const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
        url.searchParams.append('roomName', roomToJoin);
        url.searchParams.append('participantName', values.username);
        appendKloudDeviceId(url);
        if (props.region) {
          url.searchParams.append('region', props.region);
        }
        if (isMeetingCreator && !isSameTabRefresh) {
          url.searchParams.append('participantLiveDocAi', participantLiveDocShow ? '1' : '0');
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
          const detail = await connectionDetailsResp.text();
          throw Object.assign(
            new Error(`Server error ${connectionDetailsResp.status}: ${detail}`),
            { status: connectionDetailsResp.status },
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
      } catch (error: unknown) {
        console.error('[PageClientImpl] Failed to get connection details:', error);
        if (isSameTabRefresh) {
          setIsSameTabRefresh(false);
          setPreJoinChoices(undefined);
          try {
            sessionStorage.removeItem('activeKloudRoom');
          } catch {
            /* ignore */
          }
        }
        // Plain-language message for the person joining; the raw server text stays in the console.
        const status = (error as { status?: unknown } | null)?.status;
        const userMessage =
          status === 404
            ? t('prejoin.errorNotFound')
            : status === 403
              ? t('prejoin.errorEnded')
              : typeof status === 'number'
                ? t('prejoin.connectError', { error: String(status) })
                : t('prejoin.errorNetwork');
        alert(userMessage);
      }
    },
    [
      isSameTabRefresh,
      isMeetingCreator,
      personalRoomUrlEnabled,
      hostPersonalRoomId,
      resolvedLiveRoom,
      effectiveRoomName,
      props.region,
      t,
      personalRoomSwitching,
      participantLiveDocShow,
    ],
  );
  // KloudPreJoin shows camera/mic failures (blocked, in use, not found) next to the preview,
  // with a retry, so preview errors are only logged here.
  const handlePreJoinError = React.useCallback((error: unknown) => {
    console.warn('[KloudMeet] Device preview unavailable:', error);
  }, []);

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

  const autoRejoinStartedRef = React.useRef(false);

  // 同 tab 刷新：跳过准备页，用上次设备偏好直接入会
  React.useEffect(() => {
    if (!isSameTabRefresh || isBot) return;
    if (!prejoinReady || !resolveReady || entryLoadError) return;
    if (connectionDetails || preJoinChoices !== undefined) return;
    if (personalRoomSwitching) return;
    if (
      (meetingInfo?.status === 'ENDED' || meetingInfo?.status === 'CANCELED') &&
      !meetingInfo?.isPersonalRoom
    ) {
      return;
    }
    if (autoRejoinStartedRef.current) return;
    autoRejoinStartedRef.current = true;

    let username = '';
    let videoEnabled = true;
    let audioEnabled = true;
    let videoDeviceId = 'default';
    let audioDeviceId = 'default';
    try {
      const base = readStoredUserMediaChoices();
      if (typeof base.username === 'string') username = base.username;
      if (typeof base.videoEnabled === 'boolean') videoEnabled = base.videoEnabled;
      if (typeof base.audioEnabled === 'boolean') audioEnabled = base.audioEnabled;
      videoDeviceId = normalizeCaptureDeviceId(base.videoDeviceId) ?? 'default';
      audioDeviceId = normalizeCaptureDeviceId(base.audioDeviceId) ?? 'default';
      const storedKloud = localStorage.getItem('kloudUser');
      if (storedKloud) {
        const user = JSON.parse(storedKloud) as {
          displayName?: unknown;
          username?: unknown;
        };
        if (typeof user.displayName === 'string' && user.displayName) {
          username = user.displayName;
        } else if (typeof user.username === 'string' && user.username) {
          username = user.username;
        }
      }
    } catch {
      /* ignore */
    }

    void handlePreJoinSubmit({
      username: username || 'Guest',
      videoEnabled,
      audioEnabled,
      videoDeviceId,
      audioDeviceId,
    });
  }, [
    isSameTabRefresh,
    isBot,
    prejoinReady,
    resolveReady,
    entryLoadError,
    connectionDetails,
    preJoinChoices,
    personalRoomSwitching,
    meetingInfo?.status,
    meetingInfo?.isPersonalRoom,
    handlePreJoinSubmit,
  ]);

  const canShowPreJoin = prejoinReady && resolveReady && !entryLoadError;

  const meetingTerminal =
    (meetingInfo?.status === 'ENDED' || meetingInfo?.status === 'CANCELED') &&
    !meetingInfo?.isPersonalRoom;

  React.useEffect(() => {
    if (!meetingTerminal) return;
    try {
      sessionStorage.removeItem('activeKloudRoom');
    } catch {
      /* ignore */
    }
  }, [meetingTerminal]);

  if (meetingTerminal) {
    const meetingEnded = meetingInfo.status === 'ENDED';
    return (
      <div className={prejoinStyles.page}>
        <header className={prejoinStyles.toolbar}>
          <div className={prejoinStyles.toolbarLeft}>
            <Link href="/" className={prejoinStyles.logoLink}>
              <Image
                src={theme === 'dark' ? '/images/kloud-header-logo-white.svg' : '/images/kloud-header-logo.svg'}
                alt="Kloud Meet"
                width={120}
                height={36}
                style={{ display: 'block', transform: 'translateY(4px)' }}
              />
            </Link>
          </div>
        </header>
        <main className={prejoinStyles.centerMain}>
          <section className={prejoinStyles.stateCard}>
            <span
              className={`${prejoinStyles.stateIcon}${meetingEnded ? '' : ` ${prejoinStyles.stateIconDanger}`}`}
              aria-hidden="true"
            >
              {meetingEnded ? (
                <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="16" rx="3" />
                  <path d="M3 10h18M8 3v4M16 3v4M9 15.5l2 2 4-4" />
                </svg>
              ) : (
                <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="16" rx="3" />
                  <path d="M3 10h18M8 3v4M16 3v4M9.5 14l5 5M14.5 14l-5 5" />
                </svg>
              )}
            </span>
            <h1 className={prejoinStyles.stateTitle}>
              {meetingEnded ? t('prejoin.meetingConcluded') : t('prejoin.meetingCanceled')}
            </h1>
            <p className={prejoinStyles.stateText}>
              {meetingEnded ? t('prejoin.meetingEndedDesc') : t('prejoin.meetingCanceledDesc')}
            </p>
            <div className={prejoinStyles.stateActions}>
              <Link href="/" className={prejoinStyles.primaryBtn}>
                {t('prejoin.returnDashboard')}
              </Link>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const languageIcon = (size: number) => <Globe size={size} aria-hidden="true" />;

  return (
    <main style={{ height: '100%' }}>
      {connectionDetails === undefined || preJoinChoices === undefined ? (
        canShowPreJoin && !isSameTabRefresh ? (
        <div
          className={`${prejoinStyles.page}${personalRoomSwitching ? ' kloud-prejoin-room-switching' : ''}`}
          style={{
            display: isBot ? 'none' : undefined,
          }}
        >
          <header className={prejoinStyles.toolbar}>
            <div className={prejoinStyles.toolbarLeft}>
              <Link href="/" className={prejoinStyles.iconBtn} title={t('common.back')} aria-label={t('common.back')}>
                <ArrowLeft size={22} aria-hidden="true" />
              </Link>
              <Link href="/" className={prejoinStyles.logoLink}>
                <Image
                  src={theme === 'dark' ? '/images/kloud-header-logo-white.svg' : '/images/kloud-header-logo.svg'}
                  alt="KloudMeet"
                  width={120}
                  height={36}
                  style={{ display: 'block', transform: 'translateY(4px)' }}
                />
              </Link>
            </div>

            <div className={prejoinStyles.toolbarRight}>
              <button
                type="button"
                className={`${prejoinStyles.iconBtn}${theme === 'dark' ? ` ${prejoinStyles.iconBtnActive}` : ''}`}
                title={theme === 'dark' ? t('nav.switchLightTheme') : t('nav.switchDarkTheme')}
                aria-label={theme === 'dark' ? t('nav.switchLightTheme') : t('nav.switchDarkTheme')}
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
              </button>

              {/* Help Button */}
              <button
                type="button"
                className={prejoinStyles.iconBtn}
                title={t('nav.help')}
                aria-label={t('nav.help')}
                onClick={() => { setShowLangMenu(false); setShowHelp(true); }}
              >
                <CircleHelp size={20} aria-hidden="true" />
              </button>

              {/* Language Pill Button */}
              <div className={prejoinStyles.dropdown}>
                <button
                  type="button"
                  className={`${prejoinStyles.pillBtn}${showLangMenu ? ` ${prejoinStyles.pillBtnActive}` : ''}`}
                  onClick={() => setShowLangMenu(!showLangMenu)}
                  aria-haspopup="menu"
                  aria-expanded={showLangMenu}
                  aria-label={t('nav.selectLanguage')}
                >
                  {languageIcon(16)}
                  <span>{LOCALE_OPTIONS.find(l => l.code === locale)?.shortCode || 'EN'}</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                {showLangMenu && (
                  <div className={prejoinStyles.menu} role="menu">
                    <div className={prejoinStyles.menuHeader}>
                      {languageIcon(14)}
                      {t('nav.selectLanguage')}
                    </div>
                    {LOCALE_OPTIONS.map(opt => (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={locale === opt.code}
                        key={opt.code}
                        className={`${prejoinStyles.menuItem}${locale === opt.code ? ` ${prejoinStyles.menuItemActive}` : ''}`}
                        onClick={() => { setLocale(opt.code); setShowLangMenu(false); }}
                      >
                        {languageIcon(16)}
                        {opt.label}
                        <span className={prejoinStyles.menuCode}>
                          {opt.shortCode}
                          {locale === opt.code && <Check size={14} aria-hidden="true" />}
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
                    email: currentUser.email,
                  }}
                  onOpenProfile={() => setShowProfileModal(true)}
                  onOpenSettings={() => setShowSettingsModal(true)}
                  onOpenDesktopApp={() => openDesktopEntry('prejoin')}
                  onSignOut={handlePrejoinSignOut}
                />
              )}
            </div>
          </header>

          {!isBot && prejoinReady && (
            <KloudPreJoin
              defaults={preJoinDefaults}
              forceAudioEnabled={isHost}
              onSubmit={handlePreJoinSubmit}
              onError={handlePreJoinError}
              joinLabel={preJoinButtonText}
              userLabel={t('prejoin.displayMyNameAs')}
              micLabel={t('prejoin.microphone')}
              camLabel={t('prejoin.webcam')}
              mediaUnavailableLabel={t('prejoin.mediaRequiresSecureContext')}
              joinButtonDisabled={personalRoomSwitching}
              title={preJoinTitle}
              subtitle={preJoinSubtitle}
              subtitleIsNotice={isHost && isActive}
              joinFooter={
                isHost && isActive && !isSameTabRefresh ? (
                  <button
                    type="button"
                    className={prejoinStyles.textLink}
                    onClick={() => { window.location.href = '/'; }}
                  >
                    {t('prejoin.orStartNew')}
                  </button>
                ) : null
              }
              footer={
                <>
                  <PrejoinMeetingShareLink
                    active={prejoinReady && !isBot}
                    roomName={effectiveRoomName}
                  />
                  <div className={prejoinStyles.desktopRow}>
                    <button
                      type="button"
                      className={prejoinStyles.desktopBtn}
                      onClick={() => openDesktopEntry('prejoin')}
                      aria-describedby="kloud-prejoin-desktop-tip"
                    >
                      <Monitor size={16} aria-hidden="true" />
                      {t('toolbar.openDesktop.menuItem')}
                    </button>
                    <span
                      className={prejoinStyles.infoDot}
                      title={t('toolbar.openDesktop.prejoinTip')}
                      aria-hidden="true"
                    >
                      <Info size={16} />
                    </span>
                    <span id="kloud-prejoin-desktop-tip" className={prejoinStyles.srOnly}>
                      {t('toolbar.openDesktop.prejoinTip')}
                    </span>
                  </div>
                </>
              }
            >
              {isHost && (
                <div className={prejoinStyles.hostOptions}>
                  <PrejoinParticipantLiveDocSelect
                    show={participantLiveDocShow}
                    onChange={handleParticipantLiveDocChange}
                  />
                  <PrejoinPersonalRoomCheckbox
                    active
                    syncEnabled={personalRoomUrlEnabled}
                    switching={personalRoomSwitching}
                    onEnabledChange={handlePersonalRoomEnabledChange}
                    onPersonalRoomIdLoaded={handlePersonalRoomIdLoaded}
                  />
                </div>
              )}
            </KloudPreJoin>
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
            meetingTitle={typeof meetingInfo?.title === 'string' ? meetingInfo.title : undefined}
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
