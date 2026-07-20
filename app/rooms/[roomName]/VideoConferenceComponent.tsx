'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { VideoConferenceErrorBoundary } from '@/lib/VideoConferenceErrorBoundary';
import { KloudMeetToolbar, ViewMode, buildInviteLinkForClipboard } from '@/lib/KloudMeetToolbar';
import { HelpModal } from '@/lib/HelpModal';
import {
  createLivedocInstance,
  createOrUpdateInstantAccount,
  keepLivedocInstanceActive,
  resolveJitsiInstanceId,
  resolveLiveDocEmbedRole,
} from '@/lib/livedoc/client';
import { AnnotationCanvas } from '@/lib/AnnotationCanvas';
import { RemoteControlOverlay, RemoteControlRequest } from '@/lib/RemoteControlOverlay';
import { useCaptions } from '@/lib/RtasrHelper/useCaptions';
import { CaptionsOverlay } from '@/lib/RtasrHelper/CaptionsOverlay';
import { useIsDesktop } from '@/lib/useIsDesktop';
import {
  isToolbarMobileUserAgent,
  postKloudShowFilePanelToIframe,
  postLivedocRoleToIframe,
  useToolbarIsMobile,
} from '@/lib/useToolbarIsMobile';
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
  RemoteTrack,
  RemoteTrackPublication,
  TrackPublishDefaults,
  VideoCaptureOptions,
  ScreenShareCaptureOptions,
  Track,
  DataPacket_Kind,
  DisconnectReason,
} from 'livekit-client';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';
import {
  ChatPanel,
  AttendeePanel,
  chatAndAttendeeStyles,
  type ChatMsg,
} from '@/lib/ChatAndAttendeePanel';
import { getInitials } from '@/lib/getInitials';
import {
  ParticipantRoleMenuProvider,
  participantRoleMenuBridge,
  KLoud_TILE_MORE_BTN_SVG,
  type ParticipantRoleActionsConfig,
} from '@/lib/ParticipantRoleMenu';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { useDesktopAppLaunch } from '@/lib/useDesktopAppLaunch';
import { handleKloudSessionExpired } from '@/lib/handleKloudSessionExpired';
import {
  LiveDocFloatingCollapsedAvatar,
  LiveDocFloatingExpandedParticipantLayout,
  LiveDocFloatingGridTile,
  type KloudTileMediaRestrictionProps,
  KloudMobileRoomAudioRenderer,
  LiveDocWebcamSidebarTile,
  MAX_VISIBLE,
  MobileVideoLayout,
  parseKloudMemberIdFromMetadata,
} from './roomVideoLayouts';
import { isDbMeetingOwner } from '@/lib/meetingOwner';
import { replaceBrowserRoomUrl } from '@/lib/roomUrl';
import { appendKloudDeviceId } from '@/lib/kloudDeviceId';
import { authHeaders, connectionDetailsFetchInit } from '@/lib/kloudSession';
import {
  isMeetingEnded,
  setMeetingClosedNotice,
} from '@/lib/meetingClosedNotice';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';
const HOST_MIC_LOCK_MS = 5000;
import dynamic from 'next/dynamic';

const LiveDocView = dynamic(
  () => import('@/lib/LiveDocView').then((mod) => mod.LiveDocView),
  { ssr: false },
);
import {
  FLOATING_WEBCAM_BOTTOM_GAP,
  FLOATING_WEBCAM_BOTTOM_TOOLBAR_FALLBACK,
  FLOATING_WEBCAM_DEFAULT_GAP_FROM_LIVEDOC_PANEL,
  FLOATING_WEBCAM_RIGHT_DRAG_CLAMP_MARGIN,
  FLOATING_WEBCAM_RIGHT_INSET,
  FLOATING_WEBCAM_TOP_INSET,
  LIVEDOC_FILE_PANEL_COLLAPSED_WIDTH,
  LIVEDOC_FILE_PANEL_EXPANDED_WIDTH,
  SCREEN_SHARE_CAPTURE,
} from './roomConstants';

interface ChatWireMessage {
  type: 'chat';
  clientMessageId?: string;
  senderIdentity: string;
  senderName: string;
  message: string;
  timestamp: number;
}

interface PersistedChatMessage {
  clientMessageId: string;
  senderIdentity: string;
  senderName: string;
  message: string;
  timestamp: number;
}

interface ChatHistoryResponse {
  messages?: unknown;
}

function isChatWireMessage(value: unknown): value is ChatWireMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === 'chat' &&
    (candidate.clientMessageId === undefined || typeof candidate.clientMessageId === 'string') &&
    typeof candidate.senderIdentity === 'string' &&
    typeof candidate.senderName === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.timestamp === 'number' &&
    Number.isFinite(candidate.timestamp)
  );
}

function isPersistedChatMessage(value: unknown): value is PersistedChatMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.clientMessageId === 'string' &&
    typeof candidate.senderIdentity === 'string' &&
    typeof candidate.senderName === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.timestamp === 'number' &&
    Number.isFinite(candidate.timestamp)
  );
}

function getChatMessageId(message: ChatWireMessage): string {
  return message.clientMessageId ??
    `legacy:${message.senderIdentity}:${message.timestamp}:${message.message}`;
}

function mergeChatMessages(current: ChatMsg[], incoming: ChatMsg[]): ChatMsg[] {
  const byId = new Map(current.map((message) => [message.clientMessageId, message]));
  for (const message of incoming) {
    byId.set(message.clientMessageId, message);
  }
  return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function createChatMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  /** DB `Meeting.createdByMemberId` — when set, that member (via token metadata) stays in-room host after reconnect. */
  meetingOwnerMemberId?: string | null;
  region?: string;
  options: {
    hq: boolean;
    codec: VideoCodec;
  };
}) {
  const { openDesktopEntry, desktopLaunchModal } = useDesktopAppLaunch();
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const keyProvider = React.useMemo(() => new ExternalE2EEKeyProvider(), []);
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);
  const isRecorderBot = searchParams?.get('isBot') === 'true';

  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);
  const [activeView, setActiveView] = React.useState<ViewMode>('webcam');
  const [micEnabled, setMicEnabled] = React.useState(props.userChoices.audioEnabled);
  // Stores the mic state BEFORE a MUTE_ALL command arrived, so UNMUTE_ALL can restore it.
  const preMuteAllMicRef = React.useRef<boolean | null>(null);
  const [camEnabled, setCamEnabled] = React.useState(props.userChoices.videoEnabled);
  const [screenShareActive, setScreenShareActive] = React.useState(false);
  const [isWebcamSidebarCollapsed, setIsWebcamSidebarCollapsed] = React.useState(false);
  const [isDrawingMode, setIsDrawingMode] = React.useState(false);
  const localMicRestrictedRef = React.useRef(false);
  const localCamRestrictedRef = React.useRef(false);
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
  const [canPlaybackAudio, setCanPlaybackAudio] = React.useState(() =>
    typeof window !== 'undefined' ? !isToolbarMobileUserAgent() : true,
  );

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
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action, pageUrl: pageUrlStr }),
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
    // 同步 UA：Room 在首屏创建，不能等 useToolbarIsMobile 的 effect
    const isMobileClient = isToolbarMobileUserAgent();
    // 手机默认 h264（Safari/微信更稳）；桌面仍默认 vp9。URL ?codec= 优先。
    let videoCodec: VideoCodec | undefined = props.options.codec
      ? props.options.codec
      : isMobileClient
        ? 'h264'
        : 'vp9';
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
      videoCodec = undefined;
    }
    // 手机忽略 hq，避免 4K 采集把低端机打挂
    const useHq = Boolean(props.options.hq) && !isMobileClient;
    const videoCaptureDefaults: VideoCaptureOptions = {
      deviceId: props.userChoices.videoDeviceId ?? undefined,
      resolution: useHq
        ? VideoPresets.h2160
        : isMobileClient
          ? VideoPresets.h360
          : VideoPresets.h720,
      ...(isMobileClient && !props.userChoices.videoDeviceId
        ? { facingMode: 'user' as const }
        : {}),
    };
    const publishDefaults: TrackPublishDefaults = {
      // 手机开 dtx，静音时段少发包，弱网更稳
      dtx: isMobileClient,
      videoSimulcastLayers: useHq
        ? [VideoPresets.h1080, VideoPresets.h720]
        : isMobileClient
          ? [VideoPresets.h180]
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
      // 手机切后台常见 pagehide/freeze；不断连，靠现有 visibility 恢复音频
      disconnectOnPageLeave: !isMobileClient,
      e2ee: keyProvider && worker && e2eeEnabled ? { keyProvider, worker } : undefined,
      singlePeerConnection: true,
    };
  }, [props.userChoices, props.options.hq, props.options.codec, e2eeEnabled, keyProvider, worker]);

  const room = React.useMemo(() => new Room(roomOptions), [roomOptions]);

  // Check for any active screen share tracks in the room
  const screenShareTracks = useTracks([Track.Source.ScreenShare], { room });
  const hasScreenShare = screenShareTracks.length > 0;
  // Whether the local participant is the one sharing their screen (derived from tracks, not state)
  const isLocalScreenShare = screenShareTracks.some(
    (t) => t.participant?.identity === room.localParticipant.identity,
  );

  // 屏幕共享时默认收起左侧参会者列表，优先展示共享画面
  React.useEffect(() => {
    if (hasScreenShare) {
      setIsWebcamSidebarCollapsed(true);
    }
  }, [hasScreenShare]);

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
  // Only host / co-host / presenter roles may broadcast view changes to the room
  const canBroadcastViewChangeRef = React.useRef(false);

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
      if (canBroadcastViewChangeRef.current) {
        broadcastViewChangeRef.current?.(view);
      }
    },
    [screenShareActive, room],
  );

  React.useEffect(() => {
    if (!e2eeEnabled) {
      setE2eeSetupComplete(true);
      return;
    }

    let cancelled = false;
    keyProvider
      .setKey(decodePassphrase(e2eePassphrase))
      .then(() =>
        room.setE2EEEnabled(true).catch((e) => {
          if (e instanceof DeviceUnsupportedError) {
            console.error('[KloudMeet] E2EE not supported by browser:', e);
            setConnectError('您的浏览器不支持加密会议，请更新到最新版本后重试。');
            return;
          }
          throw e;
        }),
      )
      .catch((e) => {
        console.error('[KloudMeet] E2EE setup failed, continuing without E2EE:', e);
      })
      .finally(() => {
        if (!cancelled) {
          setE2eeSetupComplete(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [e2eeEnabled, room, e2eePassphrase, keyProvider]);

  const connectOptions = React.useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  const connectAttemptedRef = React.useRef(false);
  const connectRetryCountRef = React.useRef(0);
  const MAX_CONNECT_RETRIES = 6;
  // Tracks the pending retry setTimeout so we can cancel on unmount
  const connectRetryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalDisconnectRef = React.useRef(false);
  const hasConnectedOnceRef = React.useRef(false);
  const connectionDetailsRef = React.useRef(props.connectionDetails);
  React.useEffect(() => { connectionDetailsRef.current = props.connectionDetails; }, [props.connectionDetails]);
  const connectOptionsRef = React.useRef(connectOptions);
  React.useEffect(() => { connectOptionsRef.current = connectOptions; }, [connectOptions]);
  // Connection error state — drives the inline error UI instead of alert()
  const [connectError, setConnectError] = React.useState<string | null>(null);
  const [meetingEndedByHost, setMeetingEndedByHost] = React.useState(false);
  const [evictedByDuplicateSession, setEvictedByDuplicateSession] = React.useState(false);
  const duplicateSessionHandledRef = React.useRef(false);
  const hostEndedHandledRef = React.useRef(false);
  const hostEndedRedirectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keeps the retry count visible in the error UI (NOT reset until user dismisses)
  const connectRetryDisplayRef = React.useRef(0);
  // Retry counter for unexpected in-room errors (e.g. "Client initiated disconnect")
  const unexpectedErrorRetryCountRef = React.useRef(0);
  const MAX_UNEXPECTED_RETRIES = 6;

  const refreshConnectionDetails = React.useCallback(async (): Promise<ConnectionDetails> => {
    const participantName =
      connectionDetailsRef.current.participantName || props.userChoices.username || 'Guest';
    const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
    url.searchParams.append('roomName', connectionDetailsRef.current.roomName);
    url.searchParams.append('participantName', participantName);
    appendKloudDeviceId(url);
    if (props.region) {
      url.searchParams.append('region', props.region);
    }

    const response = await fetch(url.toString(), connectionDetailsFetchInit({ cache: 'no-store' }));
    if (response.status === 401) {
      handleKloudSessionExpired();
      throw new Error('Session expired');
    }
    if (!response.ok) {
      throw new Error(`重新获取连接信息失败 ${response.status}: ${await response.text()}`);
    }

    const fresh = (await response.json()) as ConnectionDetails;
    connectionDetailsRef.current = fresh;
    return fresh;
  }, [props.region, props.userChoices.username]);

  const connectWithFreshDetails = React.useCallback(async () => {
    const cd = await refreshConnectionDetails();
    return room.connect(cd.serverUrl, cd.participantToken, connectOptionsRef.current);
  }, [refreshConnectionDetails, room]);

  const markIntentionalDisconnect = React.useCallback(() => {
    intentionalDisconnectRef.current = true;
    if (connectRetryTimerRef.current) {
      clearTimeout(connectRetryTimerRef.current);
      connectRetryTimerRef.current = null;
    }
    if (hostEndedRedirectTimerRef.current) {
      clearTimeout(hostEndedRedirectTimerRef.current);
      hostEndedRedirectTimerRef.current = null;
    }
  }, []);

  const handleClosedByHostExit = React.useCallback(() => {
    if (hostEndedHandledRef.current) return;
    // 仅参会者展示「主持人已结束会议」；主持人/有权限结束会议的角色不弹窗
    if (
      isDbMeetingOwner(
        props.meetingOwnerMemberId,
        room.localParticipant.metadata,
      )
    ) {
      hostEndedHandledRef.current = true;
      intentionalDisconnectRef.current = true;
      return;
    }
    hostEndedHandledRef.current = true;
    intentionalDisconnectRef.current = true;

    if (connectRetryTimerRef.current) {
      clearTimeout(connectRetryTimerRef.current);
      connectRetryTimerRef.current = null;
    }
    setConnectError(null);
    connectRetryCountRef.current = 0;
    connectRetryDisplayRef.current = 0;
    unexpectedErrorRetryCountRef.current = 0;

    setMeetingClosedNotice(t('meeting.closedByHostToast'));
    setMeetingEndedByHost(true);
    try {
      localStorage.removeItem('activeMeetingId');
      localStorage.removeItem('activeMeetingStartedAt');
    } catch {
      /* ignore */
    }

    if (room.state !== ConnectionState.Disconnected) {
      room.disconnect().catch(console.error);
    }

    if (hostEndedRedirectTimerRef.current) {
      clearTimeout(hostEndedRedirectTimerRef.current);
    }
    hostEndedRedirectTimerRef.current = setTimeout(() => {
      router.push('/');
    }, 2200);
  }, [room, router, t, props.meetingOwnerMemberId]);

  // Compute exponential backoff capped at 8s so 6 retries finish in ~30s instead of ~63s.
  const computeBackoffMs = React.useCallback((attempt: number): number => {
    return Math.min(8000, Math.pow(2, attempt - 1) * 1000);
  }, []);

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
      msg.includes('disconnect') ||
      msg.includes('disconnected') ||
      msg.includes('client initiated disconnect') ||
      err.name === 'AbortError'
    );
  }, []);

  React.useEffect(() => {
    // Always register event listeners (so cleanup always has something to remove)
    const handleUnexpectedDisconnected = (reason?: DisconnectReason) => {
      console.log('[KloudMeet] Disconnected event received. reason=', reason, 'intentional=', intentionalDisconnectRef.current, 'duplicateHandled=', duplicateSessionHandledRef.current);
      // During reconnection or voluntary disconnect, ignore all disconnect events
      if (intentionalDisconnectRef.current) return;
      // Server evicted this session because the same user joined elsewhere
      if (reason === DisconnectReason.PARTICIPANT_REMOVED ||
          reason === DisconnectReason.DUPLICATE_IDENTITY) {
        duplicateSessionHandledRef.current = true;
        intentionalDisconnectRef.current = true;
        try {
          localStorage.removeItem('activeMeetingId');
          localStorage.removeItem('activeMeetingStartedAt');
        } catch { /* ignore */ }
        setEvictedByDuplicateSession(true);
        setTimeout(() => router.push('/'), 2500);
        return;
      }
      if (intentionalDisconnectRef.current) return;
      if (!hasConnectedOnceRef.current) return;
      if (hostEndedHandledRef.current) return;

      const roomName = connectionDetailsRef.current?.roomName;
      if (!roomName) {
        handleError(new Error('LiveKit connection disconnected unexpectedly'));
        return;
      }

      intentionalDisconnectRef.current = true;
      void (async () => {
        const ended = await isMeetingEnded(roomName);
        if (ended) {
          if (
            isDbMeetingOwner(
              props.meetingOwnerMemberId,
              room.localParticipant.metadata,
            )
          ) {
            hostEndedHandledRef.current = true;
            intentionalDisconnectRef.current = false;
            handleError(new Error('LiveKit connection disconnected unexpectedly'));
            return;
          }
          handleClosedByHostExit();
          return;
        }
        intentionalDisconnectRef.current = false;
        handleError(new Error('LiveKit connection disconnected unexpectedly'));
      })();
    };
    room.on(RoomEvent.Disconnected, handleUnexpectedDisconnected);
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
          const cd = connectionDetailsRef.current;
          room
            .connect(
              cd.serverUrl,
              cd.participantToken,
              connectOptions,
            )
            .then(() => {
              hasConnectedOnceRef.current = true;
              intentionalDisconnectRef.current = false;
              const rn = props.connectionDetails.roomName;
              replaceBrowserRoomUrl(rn);

              const isMeetingOwner = isDbMeetingOwner(
                props.meetingOwnerMemberId,
                room.localParticipant.metadata,
              );
              const wasRefresh =
                typeof window !== 'undefined' &&
                sessionStorage.getItem('activeKloudRoom') ===
                  window.location.pathname.split('/').filter(Boolean).pop();
              if (isMeetingOwner && !wasRefresh) {
                setShowMeetingReadyModal(true);
              }

              const canAutoCopyMeetingUrl =
                typeof window !== 'undefined' &&
                typeof document !== 'undefined' &&
                typeof navigator !== 'undefined' &&
                !!navigator.clipboard &&
                document.hasFocus();
              if (canAutoCopyMeetingUrl) {
                navigator.clipboard
                  .writeText(window.location.href)
                  .then(() => {
                    console.log('Meeting URL auto-copied to clipboard!');
                  })
                  .catch((error) => {
                    // Ignore expected focus-related clipboard rejections.
                    if (error?.name !== 'NotAllowedError') {
                      console.warn('Failed to auto-copy meeting URL:', error);
                    }
                  });
              }

              // Fallback: only DB meeting owner may update (matches PUT /api/meetings auth).
              if (isMeetingOwner) {
                fetch(`/api/meetings/${rn}`, {
                  method: 'PUT',
                  headers: authHeaders({ 'Content-Type': 'application/json' }),
                  body: JSON.stringify({ actualStartedAt: new Date().toISOString() }),
                }).catch((e) => console.warn('[meeting start fallback] failed', e));
              }

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

                if (isToolbarMobile) {
                  room.startAudio().catch(() => null);
                }
              };
              enableDevices();
            })
            .catch((error) => {
              connectAttemptedRef.current = false;

              if (isRetryableConnectError(error)) {
                const attempt = connectRetryCountRef.current + 1;
                if (attempt <= MAX_CONNECT_RETRIES) {
                  const delay = computeBackoffMs(attempt);
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
      room.off(RoomEvent.Disconnected, handleUnexpectedDisconnected);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
      // Cancel any pending retry
      if (connectRetryTimerRef.current) clearTimeout(connectRetryTimerRef.current);
      if (hostEndedRedirectTimerRef.current) clearTimeout(hostEndedRedirectTimerRef.current);
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
      'getusermedia', 'enumeratedevices', 'mediadevices', 'cannot read properties of undefined',
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
        const delay = computeBackoffMs(attempt);
        console.warn(
          `[KloudMeet] Unexpected disconnect, auto-retry ${attempt}/${MAX_UNEXPECTED_RETRIES} in ${delay}ms:`,
          error.message,
        );
        connectRetryTimerRef.current = setTimeout(() => {
          connectRetryTimerRef.current = null;
          if (room.state === ConnectionState.Disconnected) {
            connectWithFreshDetails()
              .then(() => {
                console.log('[KloudMeet] Auto-reconnect succeeded');
                unexpectedErrorRetryCountRef.current = 0;
                hasConnectedOnceRef.current = true;
                intentionalDisconnectRef.current = false;
                setConnectError(null);
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
  }, [computeBackoffMs, connectWithFreshDetails, isRetryableConnectError, room]);

  const handleEncryptionError = React.useCallback((error: Error) => {
    // Route encryption errors through the same inline UI — no alert()
    console.error('[KloudMeet] Encryption error:', error);
    setConnectError(`加密错误: ${error.message}`);
  }, []);

  // ── Network/visibility-driven recovery ──
  // When the device regains connectivity or the tab becomes visible again
  // (e.g. after laptop sleep / phone backgrounding), proactively recover the
  // LiveKit session instead of waiting for the next exponential-backoff tick.
  // This also rescues the user from the "All retries exhausted" error UI when
  // the network comes back later.
  React.useEffect(() => {
    const recover = (reason: string) => {
      if (duplicateSessionHandledRef.current) return;
      if (intentionalDisconnectRef.current) return;
      if (!hasConnectedOnceRef.current) return;
      if (
        room.state === ConnectionState.Connected ||
        room.state === ConnectionState.Reconnecting ||
        room.state === ConnectionState.Connecting
      ) {
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      console.log(`[KloudMeet] Recovery triggered (${reason})`);

      if (connectRetryTimerRef.current) {
        clearTimeout(connectRetryTimerRef.current);
        connectRetryTimerRef.current = null;
      }
      // Give the user a fresh retry budget — they actively did something
      // (network came back, tab became visible) so we should try hard again.
      connectRetryCountRef.current = 0;
      unexpectedErrorRetryCountRef.current = 0;
      connectAttemptedRef.current = true;

      connectWithFreshDetails()
        .then(() => {
          hasConnectedOnceRef.current = true;
          intentionalDisconnectRef.current = false;
          connectRetryDisplayRef.current = 0;
          setConnectError(null);
        })
        .catch((err) => {
          connectAttemptedRef.current = false;
          console.warn('[KloudMeet] Recovery reconnect failed, falling back to backoff:', err?.message);
          handleError(err as Error);
        });
    };

    const handleOnline = () => recover('online');
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      recover('visibility');
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [room, connectWithFreshDetails, handleError]);

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

  // ── 移动端远程音频：与 Web 端 RoomAudioRenderer 对齐，但单独挂载并主动 startAudio ──
  // iOS/微信等在他人入会或轨道订阅后常需再次 startAudio，否则听不到对方声音。
  React.useEffect(() => {
    if (!isToolbarMobile) return;

    setCanPlaybackAudio(room.canPlaybackAudio);

    const recoverRemoteAudio = () => {
      room.startAudio()
        .then(() => setCanPlaybackAudio(true))
        .catch(() => setCanPlaybackAudio(room.canPlaybackAudio));
    };

    const handleTrackSubscribed = (
      _track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (publication.kind === Track.Kind.Audio && participant.identity !== room.localParticipant.identity) {
        recoverRemoteAudio();
      }
    };

    const handleParticipantConnected = () => {
      room.remoteParticipants.forEach((participant) => {
        participant.audioTrackPublications.forEach((publication) => {
          if (
            publication.source === Track.Source.Microphone ||
            publication.source === Track.Source.ScreenShareAudio
          ) {
            if (!publication.isSubscribed) {
              publication.setSubscribed(true);
            }
          }
        });
      });
      recoverRemoteAudio();
    };

    const handleAudioPlaybackStatusChanged = (allowed: boolean) => {
      setCanPlaybackAudio(allowed);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        recoverRemoteAudio();
      }
    };

    recoverRemoteAudio();
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.Reconnected, recoverRemoteAudio);
    room.on(RoomEvent.AudioPlaybackStatusChanged, handleAudioPlaybackStatusChanged);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.Reconnected, recoverRemoteAudio);
      room.off(RoomEvent.AudioPlaybackStatusChanged, handleAudioPlaybackStatusChanged);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isToolbarMobile, room]);

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

  const canUseRealtimeMediaControls =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!navigator.mediaDevices?.enumerateDevices;

  const showMediaUnavailableToast = React.useCallback(() => {
    const toastEl = document.createElement('div');
    toastEl.textContent = t('prejoin.mediaRequiresSecureContext');
    toastEl.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(239,68,68,0.95);color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:99999;pointer-events:none;max-width:82vw;text-align:center;';
    document.body.appendChild(toastEl);
    setTimeout(() => toastEl.remove(), 2800);
  }, [t]);

  const handleToggleMic = React.useCallback(() => {
    if (!canUseRealtimeMediaControls) {
      showMediaUnavailableToast();
      return;
    }
    const next = !micEnabled;
    if (next && localMicRestrictedRef.current) {
      setMicEnabled(false);
      room.localParticipant.setMicrophoneEnabled(false).catch(handleError);
      return;
    }
    setMicEnabled(next);
    try {
      Promise.resolve(room.localParticipant.setMicrophoneEnabled(next)).catch(handleError);
    } catch (error) {
      handleError(error as Error);
    }
  }, [canUseRealtimeMediaControls, micEnabled, room, handleError, showMediaUnavailableToast]);

  const handleToggleCam = React.useCallback(() => {
    if (!canUseRealtimeMediaControls) {
      showMediaUnavailableToast();
      return;
    }
    const next = !camEnabled;
    if (next && localCamRestrictedRef.current) {
      setCamEnabled(false);
      room.localParticipant.setCameraEnabled(false).catch(handleError);
      return;
    }
    setCamEnabled(next);
    try {
      Promise.resolve(room.localParticipant.setCameraEnabled(next)).catch(handleError);
    } catch (error) {
      handleError(error as Error);
    }
  }, [canUseRealtimeMediaControls, camEnabled, room, handleError, showMediaUnavailableToast]);

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

    room.localParticipant
      .setScreenShareEnabled(next, next ? SCREEN_SHARE_CAPTURE : undefined)
      .catch((e) => {
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
    markIntentionalDisconnect();
    room.disconnect();
    router.push('/');
  }, [markIntentionalDisconnect, room, router]);

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
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ action: 'stop', pageUrl: pageUrlStr }),
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
      markIntentionalDisconnect();
      room.disconnect();
      router.push('/');
    });
  }, [stopRecordingAndThen, markIntentionalDisconnect, room, router]);

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

  // Recompute host: DB meeting owner (logged-in metadata) > earliest joiner
  React.useEffect(() => {
    const ownerKey = props.meetingOwnerMemberId;

    const recompute = () => {
      // Prefer meeting creator when they're in the room and we can match token metadata (logged-in).
      if (ownerKey) {
        const localMid = parseKloudMemberIdFromMetadata(room.localParticipant.metadata);
        if (localMid === ownerKey) {
          setHostIdentityFromJoin(room.localParticipant.identity);
          return;
        }
        for (const [, p] of room.remoteParticipants) {
          if (parseKloudMemberIdFromMetadata(p.metadata) === ownerKey) {
            setHostIdentityFromJoin(p.identity);
            return;
          }
        }
      }

      // Only one person in the meeting? They're the host, period.
      if (room.remoteParticipants.size === 0) {
        setHostIdentityFromJoin(room.localParticipant.identity);
        return;
      }
      // Multiple participants, no in-room DB owner match: earliest joiner is host (guest / legacy).
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
  }, [room, props.meetingOwnerMemberId]);

  const hostIdentity = hostIdentityOverride || hostIdentityFromJoin;
  const isHost = hostIdentity === room.localParticipant.identity;
  const [copresenterIdentities, setCopresenterIdentities] = React.useState<string[]>([]);
  const isCopresenter = copresenterIdentities.includes(room.localParticipant.identity);
  const [cohostIdentities, setCohostIdentities] = React.useState<string[]>([]);
  const [hostMutedIdentities, setHostMutedIdentities] = React.useState<string[]>([]);
  const [hostMutedUntilByIdentity, setHostMutedUntilByIdentity] = React.useState<Record<string, number>>({});
  const [muteAllLockUntil, setMuteAllLockUntil] = React.useState<number | null>(null);
  const [hostDisabledVideoIdentities, setHostDisabledVideoIdentities] = React.useState<string[]>([]);
  const [hostDisabledVideoUntilByIdentity, setHostDisabledVideoUntilByIdentity] = React.useState<Record<string, number>>({});
  const [exemptFromMuteAllIdentities, setExemptFromMuteAllIdentities] = React.useState<string[]>([]);
  const hostMutedIdentitiesRef = React.useRef(hostMutedIdentities);
  const hostDisabledVideoIdentitiesRef = React.useRef(hostDisabledVideoIdentities);
  const muteAllActiveRef = React.useRef(muteAllActive);
  const exemptFromMuteAllIdentitiesRef = React.useRef(exemptFromMuteAllIdentities);
  const updateCustomMicsRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => {
    hostMutedIdentitiesRef.current = hostMutedIdentities;
    hostDisabledVideoIdentitiesRef.current = hostDisabledVideoIdentities;
    muteAllActiveRef.current = muteAllActive;
    exemptFromMuteAllIdentitiesRef.current = exemptFromMuteAllIdentities;
  }, [hostMutedIdentities, hostDisabledVideoIdentities, muteAllActive, exemptFromMuteAllIdentities]);

  React.useEffect(() => {
    const refreshTimedMicLocks = () => {
      const now = Date.now();
      const activeEntries = Object.entries(hostMutedUntilByIdentity).filter(([, until]) => until > now);
      const activeIdentities = activeEntries.map(([identity]) => identity);

      setHostMutedIdentities((prev) =>
        prev.length === activeIdentities.length && prev.every((id, index) => id === activeIdentities[index])
          ? prev
          : activeIdentities,
      );

      if (activeEntries.length !== Object.keys(hostMutedUntilByIdentity).length) {
        setHostMutedUntilByIdentity(Object.fromEntries(activeEntries));
      }

      if (muteAllLockUntil !== null && muteAllLockUntil <= now) {
        setMuteAllActive(false);
        setMuteAllLockUntil(null);
        preMuteAllMicRef.current = null;
        setExemptFromMuteAllIdentities([]);
      }

      const activeVideoEntries = Object.entries(hostDisabledVideoUntilByIdentity).filter(([, until]) => until > now);
      const activeVideoIdentities = activeVideoEntries.map(([identity]) => identity);

      setHostDisabledVideoIdentities((prev) =>
        prev.length === activeVideoIdentities.length && prev.every((id, index) => id === activeVideoIdentities[index])
          ? prev
          : activeVideoIdentities,
      );

      if (activeVideoEntries.length !== Object.keys(hostDisabledVideoUntilByIdentity).length) {
        setHostDisabledVideoUntilByIdentity(Object.fromEntries(activeVideoEntries));
      }
    };

    refreshTimedMicLocks();

    const nextIdentityExpiry = Object.values(hostMutedUntilByIdentity)
      .filter((until) => until > Date.now())
      .sort((a, b) => a - b)[0];
    const nextVideoExpiry = Object.values(hostDisabledVideoUntilByIdentity)
      .filter((until) => until > Date.now())
      .sort((a, b) => a - b)[0];
    const candidates = [nextIdentityExpiry, nextVideoExpiry, muteAllLockUntil].filter(
      (until): until is number => typeof until === 'number' && until > Date.now(),
    );
    if (candidates.length === 0) return;

    const nextExpiry = Math.min(...candidates);
    const timeout = window.setTimeout(refreshTimedMicLocks, Math.max(0, nextExpiry - Date.now()) + 50);
    return () => window.clearTimeout(timeout);
  }, [hostMutedUntilByIdentity, hostDisabledVideoUntilByIdentity, muteAllLockUntil]);

  const isCohost = cohostIdentities.includes(room.localParticipant.identity);
  // Auto-assign Presenter: whoever owns the active screen share track
  const autoPresenterIdentity = screenShareTracks.length > 0
    ? (screenShareTracks[0].participant?.identity ?? null)
    : null;
  const isAutoPresenter = autoPresenterIdentity === room.localParticipant.identity;
  const isLocalControlOperator = isHost || isCohost || isCopresenter || isAutoPresenter;
  /** LiveDoc 批注：仅 host / co-host / presenter(含 co-presenter、屏幕共享 presenter) */
  const livedocEmbedRole = resolveLiveDocEmbedRole({
    isHost,
    isCohost,
    isPresenter: isCopresenter || isAutoPresenter,
  });

  // 身份实时变化时，由会议层直接推送到插件（不依赖 LiveDocView 内部 effect）
  React.useEffect(() => {
    postLivedocRoleToIframe(livedocEmbedRole);
    // 插件可能稍晚才挂上 listener，短延迟再推一次
    const t1 = window.setTimeout(() => postLivedocRoleToIframe(livedocEmbedRole), 300);
    const t2 = window.setTimeout(() => postLivedocRoleToIframe(livedocEmbedRole), 1200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [livedocEmbedRole]);

  const localIdentity = room.localParticipant.identity;
  const isLocalMicRestricted =
    !isLocalControlOperator &&
    (hostMutedIdentities.includes(localIdentity) ||
      (muteAllActive && !exemptFromMuteAllIdentities.includes(localIdentity)));
  const isLocalCamRestricted =
    !isLocalControlOperator && hostDisabledVideoIdentities.includes(localIdentity);
  // Interactive meetings: everyone can switch views locally; only privileged roles sync to the room
  const canSwitchViews = true;
  const canBroadcastViewChange =
    isHost || isCohost || isCopresenter || isAutoPresenter;
  canBroadcastViewChangeRef.current = canBroadcastViewChange;

  React.useEffect(() => {
    localMicRestrictedRef.current = isLocalMicRestricted;

    const enforceHostMute = () => {
      if (!localMicRestrictedRef.current) return;
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const micIsLive = !!micPub?.track && !micPub.isMuted;
      if (micEnabled || micIsLive) {
        setMicEnabled(false);
        room.localParticipant.setMicrophoneEnabled(false).catch(handleError);
      }
    };

    enforceHostMute();
    room.on(RoomEvent.LocalTrackPublished, enforceHostMute);
    room.on(RoomEvent.TrackUnmuted, enforceHostMute);
    room.on(RoomEvent.TrackMuted, enforceHostMute);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, enforceHostMute);
      room.off(RoomEvent.TrackUnmuted, enforceHostMute);
      room.off(RoomEvent.TrackMuted, enforceHostMute);
    };
  }, [isLocalMicRestricted, micEnabled, room, handleError]);

  React.useEffect(() => {
    localCamRestrictedRef.current = isLocalCamRestricted;

    const enforceHostCameraDisable = () => {
      if (!localCamRestrictedRef.current) return;
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const camIsLive = !!camPub?.track && !camPub.isMuted;
      if (camEnabled || camIsLive) {
        setCamEnabled(false);
        room.localParticipant.setCameraEnabled(false).catch(handleError);
      }
    };

    enforceHostCameraDisable();
    room.on(RoomEvent.LocalTrackPublished, enforceHostCameraDisable);
    room.on(RoomEvent.TrackUnmuted, enforceHostCameraDisable);
    room.on(RoomEvent.TrackMuted, enforceHostCameraDisable);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, enforceHostCameraDisable);
      room.off(RoomEvent.TrackUnmuted, enforceHostCameraDisable);
      room.off(RoomEvent.TrackMuted, enforceHostCameraDisable);
    };
  }, [isLocalCamRestricted, camEnabled, room, handleError]);

  const meetingRoomName = props.connectionDetails.roomName;
  const jitsiInstanceId = resolveJitsiInstanceId({
    roomName: meetingRoomName,
    meetingId: props.connectionDetails.meetingId,
    isPersonalRoom: props.connectionDetails.isPersonalRoom,
  });
  const [livedocInstanceId, setLivedocInstanceId] = React.useState<string | null>(null);
  const [livedocInitError, setLivedocInitError] = React.useState<string | null>(null);
  const [livedocInitInProgress, setLivedocInitInProgress] = React.useState(false);
  const shouldDisplayLiveDoc = isPureLiveDoc && (!hasScreenShare || isLocalScreenShare);
  const [livedocHasBeenActivated, setLivedocHasBeenActivated] = React.useState(false);
  const shouldMountLiveDoc = livedocHasBeenActivated || shouldDisplayLiveDoc || isMirrorBlocked;
  const [livekitConnected, setLivekitConnected] = React.useState(false);
  const livedocHostBootstrappedRef = React.useRef(false);

  React.useEffect(() => {
    if (shouldDisplayLiveDoc || isMirrorBlocked) {
      setLivedocHasBeenActivated(true);
    }
  }, [shouldDisplayLiveDoc, isMirrorBlocked]);

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
    presenter: string[];
    livedocInstanceId: string | null;
    muteAllActive: boolean;
    muteAllLockUntil: number | null;
    hostMutedIdentities: string[];
    hostMutedUntilByIdentity: Record<string, number>;
    exemptFromMuteAllIdentities: string[];
    hostDisabledVideoIdentities: string[];
    hostDisabledVideoUntilByIdentity: Record<string, number>;
    captionsOn: boolean;
  }>({
    view: activeView,
    presenter: [],
    livedocInstanceId: null,
    muteAllActive: false,
    muteAllLockUntil: null,
    hostMutedIdentities: [],
    hostMutedUntilByIdentity: {},
    exemptFromMuteAllIdentities: [],
    hostDisabledVideoIdentities: [],
    hostDisabledVideoUntilByIdentity: {},
    captionsOn: false,
  });

  const presenterListsEqual = React.useCallback(
    (a: string[] | null | undefined, b: string[] | null | undefined) => {
      const left = a ?? [];
      const right = b ?? [];
      if (left.length !== right.length) return false;
      return left.every((id, index) => id === right[index]);
    },
    [],
  );

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

  React.useEffect(() => {
    if (isHost) {
      authState.current.presenter = copresenterIdentities;
    }
  }, [isHost, copresenterIdentities]);

  // Keep mute state in authState so late-joining participants receive it via CORRECTION
  React.useEffect(() => {
    if (isHost) {
      authState.current.muteAllActive = muteAllActive;
      authState.current.muteAllLockUntil = muteAllLockUntil;
      authState.current.hostMutedIdentities = hostMutedIdentities;
      authState.current.hostMutedUntilByIdentity = hostMutedUntilByIdentity;
      authState.current.exemptFromMuteAllIdentities = exemptFromMuteAllIdentities;
      authState.current.hostDisabledVideoIdentities = hostDisabledVideoIdentities;
      authState.current.hostDisabledVideoUntilByIdentity = hostDisabledVideoUntilByIdentity;
    }
  }, [
    isHost,
    muteAllActive,
    muteAllLockUntil,
    hostMutedIdentities,
    hostMutedUntilByIdentity,
    exemptFromMuteAllIdentities,
    hostDisabledVideoIdentities,
    hostDisabledVideoUntilByIdentity,
  ]);

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
    const lockUntil = Date.now() + HOST_MIC_LOCK_MS;
    sendMeetingMsg({ type: 'MUTE_ALL', lockUntil });
    setMuteAllActive(true);
    setMuteAllLockUntil(lockUntil);
    setHostMutedIdentities([]);
    setHostMutedUntilByIdentity({});
    setExemptFromMuteAllIdentities([]);
  }, [sendMeetingMsg]);

  const handleUnmuteAll = React.useCallback(() => {
    sendMeetingMsg({ type: 'UNMUTE_ALL' });
    setMuteAllActive(false);
    setMuteAllLockUntil(null);
    setHostMutedIdentities([]);
    setHostMutedUntilByIdentity({});
    setExemptFromMuteAllIdentities([]);
  }, [sendMeetingMsg]);

  // Send a targeted mute to a single participant, or cancel the host restriction (host/co-host only).
  // Canceling restriction does NOT turn the participant's mic back on.
  const handleMuteParticipant = React.useCallback(
    (identity: string, disable: boolean) => {
      const lockUntil = Date.now() + HOST_MIC_LOCK_MS;
      sendMeetingMsg({
        type: disable ? 'MUTE_PARTICIPANT' : 'UNMUTE_PARTICIPANT',
        targetIdentity: identity,
        ...(disable ? { lockUntil } : {}),
      });
      if (disable) {
        setHostMutedUntilByIdentity((prev) => {
          return { ...prev, [identity]: lockUntil };
        });
      } else {
        setHostMutedUntilByIdentity((prev) => {
          const next = { ...prev };
          delete next[identity];
          return next;
        });
        setHostMutedIdentities((prev) => prev.filter((id) => id !== identity));
      }
      setExemptFromMuteAllIdentities(prev =>
        !disable
          ? (prev.includes(identity) ? prev : [...prev, identity])
          : prev.filter(id => id !== identity)
      );
    },
    [sendMeetingMsg],
  );

  // Disable a participant's camera, or cancel the host restriction (host/co-host only).
  // Canceling restriction does NOT turn the participant's camera back on.
  const handleDisableParticipantVideo = React.useCallback(
    (identity: string, disable: boolean) => {
      const lockUntil = Date.now() + HOST_MIC_LOCK_MS;
      sendMeetingMsg({
        type: disable ? 'DISABLE_VIDEO_PARTICIPANT' : 'ENABLE_VIDEO_PARTICIPANT',
        targetIdentity: identity,
        ...(disable ? { lockUntil } : {}),
      });
      if (disable) {
        setHostDisabledVideoUntilByIdentity((prev) => {
          return { ...prev, [identity]: lockUntil };
        });
      } else {
        setHostDisabledVideoUntilByIdentity((prev) => {
          const next = { ...prev };
          delete next[identity];
          return next;
        });
        setHostDisabledVideoIdentities((prev) => prev.filter((id) => id !== identity));
      }
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
      room.localParticipant.setScreenShareEnabled(true, SCREEN_SHARE_CAPTURE).catch((e) => {
        setScreenShareActive(false);
        setActiveView('liveDoc');
        broadcastViewChangeRef.current?.('liveDoc');
        console.error(e);
      });
    }, 600);
  }, [room, screenShareTracks, sendMeetingMsg]);

  // End for All (host/co-host only): notify room, delete LiveKit room + ENDED in DB, then leave UI
  const handleEndForAll = React.useCallback(async () => {
    await stopRecordingAndThen(async () => {
      const rn = window.location.pathname.split('/').filter(Boolean).pop() || '';
      const isOwner = isDbMeetingOwner(
        props.meetingOwnerMemberId,
        room.localParticipant.metadata,
      );

      hostEndedHandledRef.current = true;
      markIntentionalDisconnect();
      sendMeetingMsg({ type: 'END_MEETING' });

      if (isOwner && rn) {
        try {
          await fetch(`/api/meetings/${rn}/end`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
          });
        } catch (e) {
          console.warn('[meeting end] delete room / mark ended failed', e);
        }
      }

      await new Promise((r) => setTimeout(r, 300));
      room.disconnect();
      router.push('/');
    });
  }, [
    markIntentionalDisconnect,
    props.meetingOwnerMemberId,
    room,
    router,
    sendMeetingMsg,
    stopRecordingAndThen,
  ]);

  // Host: anonymous token + LiveDoc instance, then broadcast id to the room
  React.useEffect(() => {
    if (!shouldMountLiveDoc) return;
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
          jitsiInstanceId,
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
  }, [
    shouldMountLiveDoc,
    livekitConnected,
    isHost,
    jitsiInstanceId,
    props.userChoices.username,
    sendMeetingMsg,
  ]);

  React.useEffect(() => {
    if (!livekitConnected || meetingEndedByHost || !livedocInstanceId) return;

    let cancelled = false;
    let inFlight = false;

    const keepAlive = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const userToken = await createOrUpdateInstantAccount(props.userChoices.username);
        const id = await keepLivedocInstanceActive({
          userToken,
          jitsiInstanceId,
          livedocInstanceId,
        });
        if (!cancelled && id && id !== livedocInstanceId) {
          setLivedocInstanceId(id);
          if (isHost) {
            authState.current.livedocInstanceId = id;
            sendMeetingMsg({ type: 'LIVEDOC_INSTANCE', livedocInstanceId: id });
          }
        }
      } catch (error) {
        console.warn('[LiveDoc keepalive] failed:', error);
      } finally {
        inFlight = false;
      }
    };

    const LIVEDOC_KEEPALIVE_INTERVAL_MS = 15000;
    keepAlive();
    const interval = setInterval(keepAlive, LIVEDOC_KEEPALIVE_INTERVAL_MS);
    const keepAliveOnResume = () => {
      if (document.hidden) return;
      keepAlive();
    };
    window.addEventListener('online', keepAlive);
    document.addEventListener('visibilitychange', keepAliveOnResume);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('online', keepAlive);
      document.removeEventListener('visibilitychange', keepAliveOnResume);
    };
  }, [
    livekitConnected,
    meetingEndedByHost,
    livedocInstanceId,
    jitsiInstanceId,
    props.userChoices.username,
    isHost,
    sendMeetingMsg,
  ]);

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
          muteAllLockUntil: auth.muteAllLockUntil,
          hostMutedIdentities: auth.hostMutedIdentities,
          hostMutedUntilByIdentity: auth.hostMutedUntilByIdentity,
          exemptFromMuteAllIdentities: auth.exemptFromMuteAllIdentities,
          hostDisabledVideoIdentities: auth.hostDisabledVideoIdentities,
          hostDisabledVideoUntilByIdentity: auth.hostDisabledVideoUntilByIdentity,
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
  const broadcastViewChange = React.useCallback(
    (view: ViewMode) => {
      if (isHost) {
        authState.current.view = view;
        const auth = authState.current;
        sendMeetingMsg({
          type: 'CORRECTION',
          view: auth.view,
          presenter: auth.presenter,
          livedocInstanceId: auth.livedocInstanceId,
          muteAllActive: auth.muteAllActive,
          muteAllLockUntil: auth.muteAllLockUntil,
          hostMutedIdentities: auth.hostMutedIdentities,
          hostMutedUntilByIdentity: auth.hostMutedUntilByIdentity,
          exemptFromMuteAllIdentities: auth.exemptFromMuteAllIdentities,
          hostDisabledVideoIdentities: auth.hostDisabledVideoIdentities,
          hostDisabledVideoUntilByIdentity: auth.hostDisabledVideoUntilByIdentity,
          captionsOn: auth.captionsOn,
        });
      }
      sendMeetingMsg({ type: 'VIEW_CHANGE', view });
    },
    [sendMeetingMsg, isHost],
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
          if (typeof msg.muteAllLockUntil === 'number') {
            setMuteAllLockUntil(msg.muteAllLockUntil > Date.now() ? msg.muteAllLockUntil : null);
          } else if (msg.muteAllActive === false) {
            setMuteAllLockUntil(null);
          }
          if (Array.isArray(msg.hostMutedIdentities)) {
            setHostMutedIdentities(msg.hostMutedIdentities);
          }
          if (msg.hostMutedUntilByIdentity && typeof msg.hostMutedUntilByIdentity === 'object') {
            const now = Date.now();
            const activeLocks = Object.fromEntries(
              Object.entries(msg.hostMutedUntilByIdentity as Record<string, number>).filter(
                ([, until]) => typeof until === 'number' && until > now,
              ),
            );
            setHostMutedUntilByIdentity(activeLocks);
          }
          if (Array.isArray(msg.exemptFromMuteAllIdentities)) {
            setExemptFromMuteAllIdentities(msg.exemptFromMuteAllIdentities);
          }
          if (Array.isArray(msg.hostDisabledVideoIdentities)) {
            setHostDisabledVideoIdentities(msg.hostDisabledVideoIdentities);
          }
          if (msg.hostDisabledVideoUntilByIdentity && typeof msg.hostDisabledVideoUntilByIdentity === 'object') {
            const now = Date.now();
            const activeVideoLocks = Object.fromEntries(
              Object.entries(msg.hostDisabledVideoUntilByIdentity as Record<string, number>).filter(
                ([, until]) => typeof until === 'number' && until > now,
              ),
            );
            setHostDisabledVideoUntilByIdentity(activeVideoLocks);
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
          // 仅参会者提示；结束方（主持人/联席）不弹窗
          if (senderIdentity === room.localParticipant.identity) return;
          if (
            isDbMeetingOwner(
              props.meetingOwnerMemberId,
              room.localParticipant.metadata,
            ) ||
            isHost ||
            isCohost
          ) {
            return;
          }
          handleClosedByHostExit();
        } else if (msg.type === 'MUTE_ALL') {
          const lockUntil =
            typeof msg.lockUntil === 'number' && msg.lockUntil > Date.now()
              ? msg.lockUntil
              : Date.now() + HOST_MIC_LOCK_MS;
          setMuteAllActive(true);
          setMuteAllLockUntil(lockUntil);
          setHostMutedIdentities([]);
          setHostMutedUntilByIdentity({});
          setExemptFromMuteAllIdentities([]);
          if (!isLocalControlOperator) {
            // Snapshot only when we actually force-mute this client; UNMUTE_ALL
            // must not turn on a mic that was already off or never snapshotted.
            if (preMuteAllMicRef.current === null) {
              preMuteAllMicRef.current = micEnabled;
            }
            room.localParticipant.setMicrophoneEnabled(false).catch(console.error);
            setMicEnabled(false);
          }
        } else if (msg.type === 'UNMUTE_ALL') {
          // Restore only if MUTE_ALL previously captured this client's mic state.
          const restoreTo = preMuteAllMicRef.current;
          preMuteAllMicRef.current = null;
          setMuteAllActive(false);
          setMuteAllLockUntil(null);
          setHostMutedIdentities([]);
          setHostMutedUntilByIdentity({});
          setExemptFromMuteAllIdentities([]);
          if (restoreTo !== null) {
            room.localParticipant.setMicrophoneEnabled(restoreTo).catch(console.error);
            setMicEnabled(restoreTo);
          }
        } else if (msg.type === 'MUTE_PARTICIPANT') {
          const lockUntil =
            typeof msg.lockUntil === 'number' && msg.lockUntil > Date.now()
              ? msg.lockUntil
              : Date.now() + HOST_MIC_LOCK_MS;
          // If this is the targeted participant, mute their mic
          if (msg.targetIdentity === room.localParticipant.identity) {
            room.localParticipant.setMicrophoneEnabled(false).catch(console.error);
            setMicEnabled(false);
          }
          // ALL clients track that this participant was force-muted by the host
          // This ensures every viewer sees the red indicator.
          if (msg.targetIdentity) {
            setHostMutedUntilByIdentity((prev) => {
              return { ...prev, [msg.targetIdentity]: lockUntil };
            });
            setHostMutedIdentities(prev =>
              prev.includes(msg.targetIdentity) ? prev : [...prev, msg.targetIdentity]
            );
            setExemptFromMuteAllIdentities(prev => prev.filter(id => id !== msg.targetIdentity));
          }
        } else if (msg.type === 'UNMUTE_PARTICIPANT') {
          // Cancel host mic restriction only — do NOT turn on the participant's microphone
          if (msg.targetIdentity) {
            setHostMutedUntilByIdentity((prev) => {
              const next = { ...prev };
              delete next[msg.targetIdentity];
              return next;
            });
            setHostMutedIdentities(prev => prev.filter(id => id !== msg.targetIdentity));
            setExemptFromMuteAllIdentities(prev =>
              prev.includes(msg.targetIdentity) ? prev : [...prev, msg.targetIdentity]
            );
          }
        } else if (msg.type === 'DISABLE_VIDEO_PARTICIPANT') {
          const lockUntil =
            typeof msg.lockUntil === 'number' && msg.lockUntil > Date.now()
              ? msg.lockUntil
              : Date.now() + HOST_MIC_LOCK_MS;
          if (msg.targetIdentity === room.localParticipant.identity) {
            room.localParticipant.setCameraEnabled(false).catch(console.error);
            setCamEnabled(false);
          }
          if (msg.targetIdentity) {
            setHostDisabledVideoUntilByIdentity((prev) => {
              return { ...prev, [msg.targetIdentity]: lockUntil };
            });
            setHostDisabledVideoIdentities(prev =>
              prev.includes(msg.targetIdentity) ? prev : [...prev, msg.targetIdentity]
            );
          }
        } else if (msg.type === 'ENABLE_VIDEO_PARTICIPANT') {
          if (msg.targetIdentity) {
            setHostDisabledVideoUntilByIdentity((prev) => {
              const next = { ...prev };
              delete next[msg.targetIdentity];
              return next;
            });
            setHostDisabledVideoIdentities(prev => prev.filter(id => id !== msg.targetIdentity));
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

          const guestPresenters = Array.isArray(msg.presenter)
            ? msg.presenter
            : msg.presenter
              ? [msg.presenter]
              : [];
          const guestMuteAllActive =
            typeof msg.muteAllActive === 'boolean' ? msg.muteAllActive : false;
          const guestMuteAllLockUntil =
            typeof msg.muteAllLockUntil === 'number' ? msg.muteAllLockUntil : null;
          const guestHostMuted = Array.isArray(msg.hostMutedIdentities)
            ? msg.hostMutedIdentities
            : [];
          const guestHostMutedUntil =
            msg.hostMutedUntilByIdentity && typeof msg.hostMutedUntilByIdentity === 'object'
              ? (msg.hostMutedUntilByIdentity as Record<string, number>)
              : {};
          const guestMuteAllExemptions = Array.isArray(msg.exemptFromMuteAllIdentities)
            ? msg.exemptFromMuteAllIdentities
            : [];
          const guestHostDisabledVideo = Array.isArray(msg.hostDisabledVideoIdentities)
            ? msg.hostDisabledVideoIdentities
            : [];
          const guestHostDisabledVideoUntil =
            msg.hostDisabledVideoUntilByIdentity && typeof msg.hostDisabledVideoUntilByIdentity === 'object'
              ? (msg.hostDisabledVideoUntilByIdentity as Record<string, number>)
              : {};
          if (
            msg.view !== auth.view ||
            !presenterListsEqual(guestPresenters, auth.presenter) ||
            guestMuteAllActive !== auth.muteAllActive ||
            guestMuteAllLockUntil !== auth.muteAllLockUntil ||
            !presenterListsEqual(guestHostMuted, auth.hostMutedIdentities) ||
            JSON.stringify(guestHostMutedUntil) !== JSON.stringify(auth.hostMutedUntilByIdentity) ||
            !presenterListsEqual(guestMuteAllExemptions, auth.exemptFromMuteAllIdentities) ||
            !presenterListsEqual(guestHostDisabledVideo, auth.hostDisabledVideoIdentities) ||
            JSON.stringify(guestHostDisabledVideoUntil) !== JSON.stringify(auth.hostDisabledVideoUntilByIdentity) ||
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
                muteAllLockUntil: auth.muteAllLockUntil,
                hostMutedIdentities: auth.hostMutedIdentities,
                hostMutedUntilByIdentity: auth.hostMutedUntilByIdentity,
                exemptFromMuteAllIdentities: auth.exemptFromMuteAllIdentities,
                hostDisabledVideoIdentities: auth.hostDisabledVideoIdentities,
                hostDisabledVideoUntilByIdentity: auth.hostDisabledVideoUntilByIdentity,
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
  }, [
    room,
    isHost,
    isCohost,
    decoder,
    sendMeetingMsg,
    screenShareActive,
    approvedControllerIdentity,
    remoteControlRequest,
    micEnabled,
    camEnabled,
    props.meetingOwnerMemberId,
    handleClosedByHostExit,
    presenterListsEqual,
    isLocalScreenShare,
    isLocalControlOperator,
  ]);

  // When this client becomes host (e.g. meeting owner joins after guests), push state to everyone already in the room.
  const wasHostRef = React.useRef(false);
  React.useEffect(() => {
    if (!livekitConnected) return;
    if (isHost && !wasHostRef.current) {
      const auth = authState.current;
      auth.view =
        activeView === 'liveDoc' && isLocalScreenShare ? 'shareScreen' : activeView;
      auth.presenter = copresenterIdentities;
      auth.livedocInstanceId = livedocInstanceId;
      for (const [, participant] of room.remoteParticipants) {
        sendMeetingMsg(
          {
            type: 'CORRECTION',
            view: auth.view,
            presenter: auth.presenter,
            livedocInstanceId: auth.livedocInstanceId,
            muteAllActive: auth.muteAllActive,
            muteAllLockUntil: auth.muteAllLockUntil,
            hostMutedIdentities: auth.hostMutedIdentities,
            hostMutedUntilByIdentity: auth.hostMutedUntilByIdentity,
            exemptFromMuteAllIdentities: auth.exemptFromMuteAllIdentities,
            hostDisabledVideoIdentities: auth.hostDisabledVideoIdentities,
            hostDisabledVideoUntilByIdentity: auth.hostDisabledVideoUntilByIdentity,
            captionsOn: auth.captionsOn,
          },
          [participant.identity],
        );
      }
    }
    wasHostRef.current = isHost;
  }, [
    isHost,
    livekitConnected,
    activeView,
    isLocalScreenShare,
    copresenterIdentities,
    livedocInstanceId,
    room,
    sendMeetingMsg,
  ]);

  // All participants: send heartbeat every 5s to the authoritative host identity
  React.useEffect(() => {
    if (!room.localParticipant.identity) return;

    const interval = setInterval(() => {
      if (hostIdentity === room.localParticipant.identity) return;
      sendMeetingMsg(
        {
          type: 'HEARTBEAT',
          view: (activeView === 'liveDoc' && isLocalScreenShare) ? 'shareScreen' : activeView,
          presenter: copresenterIdentities,
          identity: room.localParticipant.identity,
          livedocInstanceId,
          muteAllActive,
          muteAllLockUntil,
          hostMutedIdentities,
          hostMutedUntilByIdentity,
          exemptFromMuteAllIdentities,
          hostDisabledVideoIdentities,
          hostDisabledVideoUntilByIdentity,
          captionsOn: captionsRunningRef.current,
        },
        [hostIdentity],
      );
    }, 5000);

    return () => clearInterval(interval);
  }, [
    room,
    hostIdentity,
    activeView,
    isLocalScreenShare,
    copresenterIdentities,
    livedocInstanceId,
    muteAllActive,
    muteAllLockUntil,
    hostMutedIdentities,
    hostMutedUntilByIdentity,
    exemptFromMuteAllIdentities,
    hostDisabledVideoIdentities,
    hostDisabledVideoUntilByIdentity,
    sendMeetingMsg,
  ]);

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
      const identity = micArea.getAttribute('data-kloud-identity');
      if (!identity || identity === room.localParticipant.identity) return;

      const isHostRestricted = micArea.getAttribute('data-kloud-host-restricted') === 'true';

      e.preventDefault();
      e.stopPropagation();
      handleMuteParticipant(identity, !isHostRestricted);
    };

    document.addEventListener('pointerdown', handleTileMicClick, true);
    return () => document.removeEventListener('pointerdown', handleTileMicClick, true);
  }, [room, isHost, isCohost, handleMuteParticipant]);

  // Grid tile click-to-disable camera (host / co-host only)
  React.useEffect(() => {
    if (!room || (!isHost && !isCohost)) return;

    const handleTileCamClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;

      const camArea = target.closest('.kloud-custom-cam-indicator');
      if (!camArea) return;

      const tile = target.closest('.lk-participant-tile');
      if (!tile) return;
      const identity = camArea.getAttribute('data-kloud-identity');
      if (!identity || identity === room.localParticipant.identity) return;

      const isHostRestricted = camArea.getAttribute('data-kloud-host-restricted') === 'true';

      e.preventDefault();
      e.stopPropagation();
      handleDisableParticipantVideo(identity, !isHostRestricted);
    };

    document.addEventListener('pointerdown', handleTileCamClick, true);
    return () => document.removeEventListener('pointerdown', handleTileCamClick, true);
  }, [room, isHost, isCohost, handleDisableParticipantVideo]);

  // Tile click to toggle own mic/cam (floating panel, carousel, webcam sidebar).
  React.useEffect(() => {
    if (!room) return;

    const handleSelfMicClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      const micArea = target.closest('.kloud-custom-mic-indicator.self-interactive');
      if (!micArea) return;
      const identity = micArea.getAttribute('data-kloud-identity');
      if (!identity || identity !== room.localParticipant.identity) return;
      e.preventDefault();
      e.stopPropagation();
      handleToggleMic();
    };

    document.addEventListener('pointerdown', handleSelfMicClick, true);
    return () => document.removeEventListener('pointerdown', handleSelfMicClick, true);
  }, [room, handleToggleMic]);

  React.useEffect(() => {
    if (!room) return;

    const handleSelfCamClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      const camArea = target.closest('.kloud-custom-cam-indicator.self-interactive');
      if (!camArea) return;
      const identity = camArea.getAttribute('data-kloud-identity');
      if (!identity || identity !== room.localParticipant.identity) return;
      e.preventDefault();
      e.stopPropagation();
      handleToggleCam();
    };

    document.addEventListener('pointerdown', handleSelfCamClick, true);
    return () => document.removeEventListener('pointerdown', handleSelfCamClick, true);
  }, [room, handleToggleCam]);

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
    const camSvg = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>`;
    const camOffSvg = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/><line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>`;

    const applyKloudIndicatorColor = (el: HTMLElement, color: string) => {
      el.style.setProperty('color', color, 'important');
      el.querySelectorAll('svg').forEach((svg) => {
        (svg as SVGElement).style.setProperty('fill', color, 'important');
        svg.querySelectorAll('path').forEach((path) => {
          (path as SVGElement).style.setProperty('fill', color, 'important');
        });
        svg.querySelectorAll('line').forEach((line) => {
          (line as SVGElement).style.setProperty('stroke', color, 'important');
        });
      });
    };

    const updateCustomMics = () => {
      // 主网格 + 活文档右侧栏 + 屏幕共享左侧 carousel（浮窗由 React 组件渲染麦/摄像头图标）
      const tiles = document.querySelectorAll(
        '.lk-grid-layout-wrapper .lk-participant-tile, .lk-mobile-scroll-grid .lk-participant-tile, .webcam-sidebar-panel .webcam-sidebar-tile.lk-participant-tile, .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile',
      );
      const muteAllApplied = muteAllActiveRef.current;
      const restrictedMicIdentities = hostMutedIdentitiesRef.current;
      const restrictedVideoIdentities = hostDisabledVideoIdentitiesRef.current;
      const exemptIdentities = exemptFromMuteAllIdentitiesRef.current;

      tiles.forEach((tile) => {
        const inCarousel = !!tile.closest('.lk-carousel');
        const inWebcamSidebar = !!tile.closest('.webcam-sidebar-panel');
        const inFloating = !!tile.closest('.floating-webcam-panel');
        const inGrid =
          !!tile.closest('.lk-grid-layout-wrapper') || !!tile.closest('.lk-mobile-scroll-grid');

        // Determine participant identity from the tile's data-lk-participant or fallback to name matching
        let identity = tile.getAttribute('data-lk-participant');
        let participant = identity === room.localParticipant.identity ? room.localParticipant : (identity ? room.remoteParticipants.get(identity) : null);

        // Fallback to name matching if data attribute doesn't contain identity
        if (!participant) {
          const nameEl = tile.querySelector(
            '.lk-participant-name, .floating-grid-name, .webcam-sidebar-name',
          );
          const displayName = nameEl?.textContent?.trim();
          const matched = Array.from(room.remoteParticipants.values()).find(p => (p.name || p.identity) === displayName);
          participant = matched || (room.localParticipant.name === displayName ? room.localParticipant : null);
        }
        if (!participant) return;
        identity = participant.identity;
        const isLocal = participant.identity === room.localParticipant.identity;
        tile.setAttribute('data-lk-participant', identity);
        tile.setAttribute('data-lk-local-participant', isLocal ? 'true' : 'false');

        let metadata = tile.querySelector('.lk-participant-metadata');
        if (!metadata && inCarousel) {
          metadata = document.createElement('div');
          metadata.className = 'lk-participant-metadata';
          const itemContainer = document.createElement('div');
          itemContainer.className = 'lk-participant-metadata-item';
          const nameSpan = document.createElement('span');
          nameSpan.className = 'lk-participant-name';
          nameSpan.textContent = participant.name || participant.identity;
          itemContainer.appendChild(nameSpan);
          metadata.appendChild(itemContainer);
          tile.appendChild(metadata);
        }
        if (!metadata) return;

        let itemContainer = metadata.querySelector('.lk-participant-metadata-item');
        if (!itemContainer) {
          itemContainer = document.createElement('div');
          itemContainer.className = 'lk-participant-metadata-item';
          metadata.appendChild(itemContainer);
        }
        // 仅 screenshare aside（carousel）补 LiveKit 风格名字；浮窗/侧栏已有专用 name 节点，禁止重复注入
        if (inCarousel && !itemContainer.querySelector('.lk-participant-name')) {
          const nameSpan = document.createElement('span');
          nameSpan.className = 'lk-participant-name';
          nameSpan.textContent = participant.name || participant.identity;
          itemContainer.appendChild(nameSpan);
        } else if (!inCarousel) {
          const builtInName = itemContainer.querySelector('.floating-grid-name, .webcam-sidebar-name');
          if (builtInName) {
            itemContainer.querySelectorAll('.lk-participant-name').forEach((el) => el.remove());
          }
        }

        const micPub = participant.getTrackPublication(Track.Source.Microphone);
        const isMuted = !micPub?.track || micPub.isMuted;

        // Is this participant force-muted? (Hosts, co-hosts, auto-presenters are exempt)
        const targetIsHost = identity === hostIdentity;
        const targetIsCohost = cohostIdentities.includes(identity);
        const targetIsAutoPresenter = autoPresenterIdentity === identity;
        const targetIsCopresenter = copresenterIdentities.includes(identity);
        const targetIsOperator = targetIsHost || targetIsCohost || targetIsAutoPresenter || targetIsCopresenter;

        // Force muted: mute-all batch (red when actually muted); individual host ban uses data-kloud-host-restricted
        const isHostMicRestricted = restrictedMicIdentities.includes(identity) && !targetIsOperator;
        const isMuteAllForced =
          muteAllApplied && !exemptIdentities.includes(identity) && !targetIsOperator && isMuted;
        const isForceMuted = isMuteAllForced;
        tile.setAttribute('data-kloud-force-muted', isForceMuted ? 'true' : 'false');

        // Look for our custom icon container, or create it if missing
        let customMic = metadata.querySelector('.kloud-custom-mic-indicator');
        if (!customMic) {
          customMic = document.createElement('div');
          customMic.className = 'kloud-custom-mic-indicator';
          const nameAnchor =
            itemContainer.querySelector('.floating-grid-name') ||
            itemContainer.querySelector('.webcam-sidebar-name') ||
            itemContainer.querySelector('.lk-participant-name');
          if (nameAnchor) {
            itemContainer.insertBefore(customMic, nameAnchor);
          } else {
            itemContainer.insertBefore(customMic, itemContainer.firstChild);
          }
        }

        const customMicEl = customMic as HTMLElement;
        customMicEl.setAttribute('data-kloud-identity', identity);
        customMicEl.setAttribute('data-kloud-muted', isMuted ? 'true' : 'false');
        customMicEl.setAttribute('data-kloud-host-restricted', isHostMicRestricted ? 'true' : 'false');
        customMicEl.setAttribute('data-kloud-force-muted', isForceMuted ? 'true' : 'false');
        customMicEl.classList.toggle('kloud-custom-mic--force-muted', isHostMicRestricted || isForceMuted);
        customMicEl.innerHTML = isMuted ? micOffSvg : micSvg;
        if (isHostMicRestricted || isForceMuted) {
          applyKloudIndicatorColor(customMicEl, '#ff2020');
        } else if (isMuted) {
          applyKloudIndicatorColor(customMicEl, 'rgba(255, 255, 255, 0.75)');
        } else {
          applyKloudIndicatorColor(customMicEl, '#22c55e');
        }

        customMic.classList.remove('operator-interactive', 'self-interactive');
        if (isLocal) {
          if (!isHostMicRestricted && !isForceMuted) {
            customMic.classList.add('self-interactive');
            customMic.setAttribute('title', isMuted ? 'Turn on microphone' : 'Turn off microphone');
          } else {
            customMic.removeAttribute('title');
          }
        } else if (isHost || isCohost) {
          customMic.classList.add('operator-interactive');
          customMic.setAttribute(
            'title',
            isHostMicRestricted ? 'Cancel disable (does not turn on mic)' : 'Disable microphone',
          );
        } else {
          customMic.removeAttribute('title');
        }

        const camPub = participant.getTrackPublication(Track.Source.Camera);
        const isVideoDisabled = !camPub?.track || camPub.isMuted;
        const isHostVideoRestricted = restrictedVideoIdentities.includes(identity) && !targetIsOperator;

        let customCam = metadata.querySelector('.kloud-custom-cam-indicator');
        if (!customCam) {
          customCam = document.createElement('div');
          customCam.className = 'kloud-custom-cam-indicator';
          customMic.insertAdjacentElement('afterend', customCam);
        }

        const customCamEl = customCam as HTMLElement;
        customCamEl.setAttribute('data-kloud-identity', identity);
        customCamEl.setAttribute('data-kloud-video-disabled', isVideoDisabled ? 'true' : 'false');
        customCamEl.setAttribute('data-kloud-host-restricted', isHostVideoRestricted ? 'true' : 'false');
        customCamEl.classList.toggle('kloud-custom-cam--force-disabled', isHostVideoRestricted);
        customCamEl.innerHTML = isVideoDisabled ? camOffSvg : camSvg;
        if (isHostVideoRestricted) {
          applyKloudIndicatorColor(customCamEl, '#ff2020');
        } else if (isVideoDisabled) {
          applyKloudIndicatorColor(customCamEl, 'rgba(255, 255, 255, 0.75)');
        } else {
          applyKloudIndicatorColor(customCamEl, '#22c55e');
        }

        customCam.classList.remove('operator-interactive', 'self-interactive');
        if (isLocal) {
          if (!isHostVideoRestricted) {
            customCam.classList.add('self-interactive');
            customCam.setAttribute('title', isVideoDisabled ? 'Turn on camera' : 'Turn off camera');
          } else {
            customCam.removeAttribute('title');
          }
        } else if (isHost || isCohost) {
          customCam.classList.add('operator-interactive');
          customCam.setAttribute(
            'title',
            isHostVideoRestricted ? 'Cancel disable (does not turn on camera)' : 'Disable camera',
          );
        } else {
          customCam.removeAttribute('title');
        }

        const tileSource = tile.getAttribute('data-lk-source') || '';
        const isCameraTile =
          !tileSource || tileSource === 'camera' || tileSource === String(Track.Source.Camera);
        const shouldInjectDomMoreMenu =
          isCameraTile && (inCarousel || (inGrid && !inWebcamSidebar && !inFloating));

        if (shouldInjectDomMoreMenu) {
          const roleConfig = participantRoleMenuBridge.current?.getConfig();
          const canManageRoles = roleConfig?.canManageRoles ?? (isHost || isCohost);
          const isThisHost = identity === hostIdentity;
          const showMoreMenu = canManageRoles && (isThisHost || (!isLocal && !isThisHost));

          let moreWrap = tile.querySelector('.kloud-tile-more-menu-wrap') as HTMLElement | null;
          if (!showMoreMenu) {
            moreWrap?.remove();
          } else {
            if (!moreWrap) {
              moreWrap = document.createElement('div');
              moreWrap.className = 'kloud-tile-more-menu-wrap kloud-more-menu-anchor kloud-tile-more-menu-wrap--inline';
              const moreBtn = document.createElement('button');
              moreBtn.type = 'button';
              moreBtn.className = 'kloud-role-icon-btn kloud-tile-more-menu-btn';
              moreBtn.title = 'More options';
              moreBtn.innerHTML = KLoud_TILE_MORE_BTN_SVG;
              moreBtn.addEventListener('mousedown', (e) => e.stopPropagation());
              moreBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wrap = (e.currentTarget as HTMLElement).closest('.kloud-tile-more-menu-wrap') as HTMLElement | null;
                const id = wrap?.getAttribute('data-kloud-identity');
                if (wrap && id) {
                  participantRoleMenuBridge.current?.toggleMenu(id, wrap);
                }
              });
              moreWrap.appendChild(moreBtn);
            }
            if (inCarousel) {
              moreWrap.classList.remove('kloud-tile-more-menu-wrap--inline');
              if (moreWrap.parentElement !== tile) {
                tile.appendChild(moreWrap);
              }
            } else {
              moreWrap.classList.add('kloud-tile-more-menu-wrap--inline');
              const camIndicator = itemContainer.querySelector('.kloud-custom-cam-indicator');
              const nameAnchor =
                itemContainer.querySelector('.floating-grid-name') ||
                itemContainer.querySelector('.webcam-sidebar-name') ||
                itemContainer.querySelector('.lk-participant-name');
              if (camIndicator) {
                camIndicator.insertAdjacentElement('afterend', moreWrap);
              } else if (nameAnchor) {
                itemContainer.insertBefore(moreWrap, nameAnchor);
              } else if (moreWrap.parentElement !== itemContainer) {
                itemContainer.appendChild(moreWrap);
              }
            }
          }
          if (moreWrap) {
            moreWrap.setAttribute('data-kloud-identity', identity);
          }
        }
      });
    };

    updateCustomMicsRef.current = updateCustomMics;

    // Run the update immediately
    updateCustomMics();

    // Listen to all relevant LiveKit events to update the DOM reactively
    room.on(RoomEvent.TrackMuted, updateCustomMics);
    room.on(RoomEvent.TrackPublished, updateCustomMics);
    room.on(RoomEvent.TrackUnpublished, updateCustomMics);
    room.on(RoomEvent.ParticipantConnected, updateCustomMics);
    room.on(RoomEvent.ParticipantDisconnected, updateCustomMics);

    // Track unmuting by the user — refresh indicators only; host restrictions are cleared by the host
    const handleTrackUnmuted = () => {
      updateCustomMics();
    };
    room.on(RoomEvent.TrackUnmuted, handleTrackUnmuted);

    // Fail-safe refresh (avoid tight loops — MutationObserver + DOM writes caused screen-share freeze)
    const intervalId = setInterval(updateCustomMics, 500);

    return () => {
      updateCustomMicsRef.current = null;
      room.off(RoomEvent.TrackMuted, updateCustomMics);
      room.off(RoomEvent.TrackUnmuted, handleTrackUnmuted);
      room.off(RoomEvent.TrackPublished, updateCustomMics);
      room.off(RoomEvent.TrackUnpublished, updateCustomMics);
      room.off(RoomEvent.ParticipantConnected, updateCustomMics);
      room.off(RoomEvent.ParticipantDisconnected, updateCustomMics);
      clearInterval(intervalId);
    };
  }, [
    room,
    muteAllActive,
    hostIdentity,
    cohostIdentities,
    autoPresenterIdentity,
    copresenterIdentities,
    hostMutedIdentities,
    hostDisabledVideoIdentities,
    exemptFromMuteAllIdentities,
    isHost,
    isCohost,
    hasScreenShare,
    isWebcamSidebarCollapsed,
  ]);

  // 主持禁音/禁视频 / 切换 Webcam 视图后立即刷新 tile 图标与 ⋯ 菜单
  React.useEffect(() => {
    updateCustomMicsRef.current?.();
  }, [hostMutedIdentities, hostDisabledVideoIdentities, muteAllActive, hasScreenShare, activeView]);

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

  // Sync login/display names into placeholder so camera-off tiles show the name (not initials)
  React.useEffect(() => {
    const syncNames = () => {
      document.querySelectorAll('.lk-participant-tile').forEach((tile) => {
        const nameEl = tile.querySelector('.lk-participant-name');
        const placeholder = tile.querySelector('.lk-participant-placeholder');
        if (!placeholder) return;

        const identity = tile.getAttribute('data-lk-participant') || '';
        const participant = identity
          ? identity === room.localParticipant.identity
            ? room.localParticipant
            : room.remoteParticipants.get(identity)
          : null;
        const name = (
          participant?.name ||
          participant?.identity ||
          nameEl?.textContent ||
          ''
        ).trim();
        if (!name) return;

        if (placeholder.getAttribute('data-lk-name') !== name) {
          placeholder.setAttribute('data-lk-name', name);
        }
        // Keep initials attribute for leftover consumers; UI uses login name via data-lk-name
        const initials = getInitials(name);
        if (placeholder.getAttribute('data-lk-initials') !== initials) {
          placeholder.setAttribute('data-lk-initials', initials);
        }
        if (nameEl && nameEl.textContent?.trim() !== name) {
          nameEl.textContent = name;
        }
      });
    };
    syncNames();
    const interval = setInterval(syncNames, 1000);
    return () => clearInterval(interval);
  }, [room]);

  const [liveDocFilePanelVisible, setLiveDocFilePanelVisible] = React.useState(false);
  const [liveDocFilePanelWidth, setLiveDocFilePanelWidth] = React.useState(
    LIVEDOC_FILE_PANEL_EXPANDED_WIDTH,
  );
  /** 浮窗拖拽中：供 LiveDoc postMessage 守卫使用（须早于 message effect） */
  const isDragging = React.useRef(false);
  const clearFloatingDragListenersRef = React.useRef<() => void>(() => {});

  // Listen for postMessage to toggle webcam sidebar in LiveDoc mode
  React.useEffect(() => {
    const getPanelVisibility = (data: {
      Show?: unknown;
      show?: unknown;
      visible?: unknown;
      isVisible?: unknown;
      IsVisible?: unknown;
      IsShow?: unknown;
      expanded?: unknown;
      isExpanded?: unknown;
      data?: {
        Show?: unknown;
        show?: unknown;
        visible?: unknown;
        isVisible?: unknown;
        IsVisible?: unknown;
        IsShow?: unknown;
        expanded?: unknown;
        isExpanded?: unknown;
        panel?: {
          Show?: unknown;
          show?: unknown;
          visible?: unknown;
          isVisible?: unknown;
          IsVisible?: unknown;
          IsShow?: unknown;
          expanded?: unknown;
          isExpanded?: unknown;
        };
      };
      panel?: {
        Show?: unknown;
        show?: unknown;
        visible?: unknown;
        isVisible?: unknown;
        IsVisible?: unknown;
        IsShow?: unknown;
        expanded?: unknown;
        isExpanded?: unknown;
      };
    }) => {
      const value =
        data.data?.panel?.show ??
        data.data?.panel?.Show ??
        data.data?.panel?.visible ??
        data.data?.panel?.isVisible ??
        data.data?.panel?.IsVisible ??
        data.data?.panel?.IsShow ??
        data.data?.panel?.expanded ??
        data.data?.panel?.isExpanded ??
        data.data?.show ??
        data.data?.Show ??
        data.data?.visible ??
        data.data?.isVisible ??
        data.data?.IsVisible ??
        data.data?.IsShow ??
        data.data?.expanded ??
        data.data?.isExpanded ??
        data.panel?.show ??
        data.panel?.Show ??
        data.panel?.visible ??
        data.panel?.isVisible ??
        data.panel?.IsVisible ??
        data.panel?.IsShow ??
        data.panel?.expanded ??
        data.panel?.isExpanded ??
        data.show ??
        data.Show ??
        data.visible ??
        data.isVisible ??
        data.IsVisible ??
        data.IsShow ??
        data.expanded ??
        data.isExpanded;

      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value === 1;
      if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
      return null;
    };

    const getPanelWidth = (data: {
      width?: unknown;
      panelWidth?: unknown;
      filePanelWidth?: unknown;
      sidebarWidth?: unknown;
      rightPanelWidth?: unknown;
      Width?: unknown;
      panel?: {
        width?: unknown;
        Width?: unknown;
        panelWidth?: unknown;
        filePanelWidth?: unknown;
        sidebarWidth?: unknown;
        rightPanelWidth?: unknown;
      };
      data?: {
        width?: unknown;
        panelWidth?: unknown;
        filePanelWidth?: unknown;
        sidebarWidth?: unknown;
        rightPanelWidth?: unknown;
        Width?: unknown;
        panel?: {
          width?: unknown;
          Width?: unknown;
          panelWidth?: unknown;
          filePanelWidth?: unknown;
          sidebarWidth?: unknown;
          rightPanelWidth?: unknown;
        };
      };
    }) => {
      const candidate =
        data.data?.panel?.filePanelWidth ??
        data.data?.panel?.panelWidth ??
        data.data?.panel?.rightPanelWidth ??
        data.data?.panel?.sidebarWidth ??
        data.data?.panel?.width ??
        data.data?.panel?.Width ??
        data.data?.filePanelWidth ??
        data.data?.panelWidth ??
        data.data?.rightPanelWidth ??
        data.data?.sidebarWidth ??
        data.data?.width ??
        data.data?.Width ??
        data.panel?.filePanelWidth ??
        data.panel?.panelWidth ??
        data.panel?.rightPanelWidth ??
        data.panel?.sidebarWidth ??
        data.panel?.width ??
        data.panel?.Width ??
        data.filePanelWidth ??
        data.panelWidth ??
        data.rightPanelWidth ??
        data.sidebarWidth ??
        data.width ??
        data.Width;

      const width =
        typeof candidate === 'number'
          ? candidate
          : typeof candidate === 'string'
            ? Number(candidate)
            : NaN;

      if (!Number.isFinite(width)) return null;
      // Guardrail: LiveDoc right panel should be in a sane range.
      return Math.max(LIVEDOC_FILE_PANEL_COLLAPSED_WIDTH, Math.min(480, width));
    };

    const handler = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;
      const data = e.data as {
        type?: string;
        Show?: unknown;
        show?: unknown;
        visible?: unknown;
        isVisible?: unknown;
        IsVisible?: unknown;
        IsShow?: unknown;
        expanded?: unknown;
        isExpanded?: unknown;
        width?: unknown;
        panelWidth?: unknown;
        filePanelWidth?: unknown;
        sidebarWidth?: unknown;
        rightPanelWidth?: unknown;
        Width?: unknown;
        panel?: {
          Show?: unknown;
          show?: unknown;
          visible?: unknown;
          isVisible?: unknown;
          IsVisible?: unknown;
          IsShow?: unknown;
          expanded?: unknown;
          isExpanded?: unknown;
          width?: unknown;
          Width?: unknown;
          panelWidth?: unknown;
          filePanelWidth?: unknown;
          sidebarWidth?: unknown;
          rightPanelWidth?: unknown;
        };
        data?: {
          Show?: unknown;
          show?: unknown;
          visible?: unknown;
          isVisible?: unknown;
          IsVisible?: unknown;
          IsShow?: unknown;
          expanded?: unknown;
          isExpanded?: unknown;
          width?: unknown;
          panelWidth?: unknown;
          filePanelWidth?: unknown;
          sidebarWidth?: unknown;
          rightPanelWidth?: unknown;
          Width?: unknown;
          panel?: {
            Show?: unknown;
            show?: unknown;
            visible?: unknown;
            isVisible?: unknown;
            IsVisible?: unknown;
            IsShow?: unknown;
            expanded?: unknown;
            isExpanded?: unknown;
            width?: unknown;
            Width?: unknown;
            panelWidth?: unknown;
            filePanelWidth?: unknown;
            sidebarWidth?: unknown;
            rightPanelWidth?: unknown;
          };
        };
      };
      if (
        process.env.NODE_ENV === 'development' &&
        typeof data.type === 'string' &&
        (data.type.toLowerCase().includes('kloud') || data.type.toLowerCase().includes('file'))
      ) {
        console.debug('[LiveDoc postMessage]', data);
      }
      if (e.data.type === 'Kloud-ShowWebcamView') {
        setShowWebcamSidebar(true);
        setLiveDocFilePanelVisible(false);
      } else if (e.data.type === 'Kloud-HideWebcamView') {
        setShowWebcamSidebar(false);
      } else if (data.type === 'onkloudloaded') {
        // ② 文档加载完成：再释放一次，并恢复 iframe 可点
        clearFloatingDragListenersRef.current();
        setShowWebcamSidebar(false);
        setLiveDocFilePanelVisible(false);
        setLiveDocFilePanelWidth(LIVEDOC_FILE_PANEL_COLLAPSED_WIDTH);
      } else if (
        data.type === 'onKloudFilePanelVisibleChange' ||
        data.type === 'Kloud-FilePanelVisibleChange' ||
        data.type === 'Kloud-ShowFilePanel' ||
        !!data.type?.toLowerCase().includes('filepanel')
      ) {
        if (isDragging.current) return;
        const visible = getPanelVisibility(data);
        if (visible !== null) {
          setLiveDocFilePanelVisible(visible);
        }
        const panelWidth = getPanelWidth(data);
        if (panelWidth !== null) {
          setLiveDocFilePanelWidth(panelWidth);
        } else if (visible !== null) {
          // Fallback if plugin message omits width.
          setLiveDocFilePanelWidth(
            visible ? LIVEDOC_FILE_PANEL_EXPANDED_WIDTH : LIVEDOC_FILE_PANEL_COLLAPSED_WIDTH,
          );
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // LiveDoc 主区域显示时：右侧面板已改为居中弹窗模态（LiveDoc Popup Modal），
  // 不再常驻右侧，因此 KloudMeet 侧也不再预留面板宽度。
  React.useEffect(() => {
    if (shouldDisplayLiveDoc) {
      setShowWebcamSidebar(false);
      setLiveDocFilePanelVisible(false);
      setLiveDocFilePanelWidth(LIVEDOC_FILE_PANEL_COLLAPSED_WIDTH);
      postKloudShowFilePanelToIframe(0);
    } else {
      setShowWebcamSidebar(false);
      setLiveDocFilePanelVisible(false);
      setLiveDocFilePanelWidth(LIVEDOC_FILE_PANEL_COLLAPSED_WIDTH);
    }
  }, [shouldDisplayLiveDoc, isToolbarMobile]);

  // Draggable floating webcam panel state（默认用 right 贴距右侧，拖拽后改为 left/top 坐标）
  const floatingRef = React.useRef<HTMLDivElement>(null);
  const [floatingPos, setFloatingPos] = React.useState({ x: 12, y: 12 });
  const [floatingPosLayout, setFloatingPosLayout] = React.useState<'right-inset' | 'coordinates'>(
    'right-inset',
  );
  const [floatingExpanded, setFloatingExpanded] = React.useState(true);
  const [floatingCollapsedPreviewId, setFloatingCollapsedPreviewId] = React.useState<string | null>(null);
  const [isFloatingDragging, setIsFloatingDragging] = React.useState(false);
  const dragOffset = React.useRef({ x: 0, y: 0 });
  const floatingPosRef = React.useRef(floatingPos);
  const floatingPosLayoutRef = React.useRef(floatingPosLayout);
  /** 文件栏完全隐藏时不占位，避免仍按「折叠宽度」把浮窗拦在距右缘 56px+ 处 */
  const effectiveLiveDocPanelWidth = liveDocFilePanelVisible ? liveDocFilePanelWidth : 0;
  const floatingRightInset =
    activeView === 'liveDoc' && !hasScreenShare
      ? effectiveLiveDocPanelWidth +
        FLOATING_WEBCAM_DEFAULT_GAP_FROM_LIVEDOC_PANEL
      : FLOATING_WEBCAM_RIGHT_INSET;
  const floatingRightBoundaryInset = FLOATING_WEBCAM_RIGHT_DRAG_CLAMP_MARGIN;
  /** 共享方 LiveDoc / 纯 LiveDoc / 非共享方且左侧栏已折叠时显示浮窗 */
  const shouldShowFloatingWebcamPanel =
    !isRecorderBot &&
    activeView !== 'webcam' &&
    !showWebcamSidebar &&
    (screenShareActive ||
      (activeView === 'liveDoc' && !hasScreenShare) ||
      (hasScreenShare && !screenShareActive && isWebcamSidebarCollapsed));

  const floatingMediaRestrictions = React.useMemo<KloudTileMediaRestrictionProps>(
    () => ({
      hostMutedIdentities,
      hostDisabledVideoIdentities,
      muteAllActive,
      exemptFromMuteAllIdentities,
      hostIdentity,
      cohostIdentities,
      autoPresenterIdentity,
      copresenterIdentities,
      roomLocalIdentity: room.localParticipant.identity,
      isHost,
      isCohost,
    }),
    [
      hostMutedIdentities,
      hostDisabledVideoIdentities,
      muteAllActive,
      exemptFromMuteAllIdentities,
      hostIdentity,
      cohostIdentities,
      autoPresenterIdentity,
      copresenterIdentities,
      room.localParticipant.identity,
      isHost,
      isCohost,
    ],
  );

  const participantRoleActions = React.useMemo<ParticipantRoleActionsConfig>(
    () => ({
      hostIdentity,
      copresenterIdentities,
      cohostIdentities,
      canManageRoles: isHost || isCohost,
      localIdentity: room.localParticipant.identity,
      autoPresenterIdentity,
      onAddCopresenter: (identity) => {
        setCopresenterIdentities((prev) => (prev.includes(identity) ? prev : [...prev, identity]));
        sendMeetingMsg({ type: 'SET_PRESENTER', identity });
      },
      onRemoveCopresenter: (identity) => {
        setCopresenterIdentities((prev) => prev.filter((id) => id !== identity));
        sendMeetingMsg({ type: 'REMOVE_PRESENTER', identity });
      },
      onSetCohost: (identity) => {
        setCohostIdentities((prev) => [...prev, identity]);
        sendMeetingMsg({ type: 'SET_COHOST', identity });
      },
      onRemoveCohost: (identity) => {
        setCohostIdentities((prev) => prev.filter((id) => id !== identity));
        sendMeetingMsg({ type: 'REMOVE_COHOST', identity });
      },
      onSetHost: (identity) => {
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
      },
    }),
    [
      hostIdentity,
      copresenterIdentities,
      cohostIdentities,
      isHost,
      isCohost,
      room.localParticipant.identity,
      autoPresenterIdentity,
      sendMeetingMsg,
    ],
  );

  const getFloatingBottomInset = React.useCallback((parent: HTMLElement) => {
    const toolbar = document.querySelector<HTMLElement>('[data-skymeet-toolbar="true"]');
    if (!toolbar) {
      return FLOATING_WEBCAM_BOTTOM_TOOLBAR_FALLBACK + FLOATING_WEBCAM_BOTTOM_GAP;
    }
    const parentRect = parent.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    // 底栏已滑出视口（hidden）时允许贴近父容器底边
    if (toolbarRect.top >= window.innerHeight - 2) {
      return FLOATING_WEBCAM_BOTTOM_GAP;
    }
    const overlap = parentRect.bottom - toolbarRect.top;
    if (overlap <= 0) {
      return FLOATING_WEBCAM_BOTTOM_GAP;
    }
    return Math.max(FLOATING_WEBCAM_BOTTOM_GAP, overlap + FLOATING_WEBCAM_BOTTOM_GAP);
  }, []);

  const clampFloatingPosition = React.useCallback(
    (x: number, y: number) => {
      const el = floatingRef.current;
      const parent = el?.offsetParent as HTMLElement | null;
      if (!el || !parent) return { x, y };

      const minY = activeView === 'liveDoc' && !hasScreenShare ? FLOATING_WEBCAM_TOP_INSET : 0;
      const maxX = Math.max(0, parent.clientWidth - el.offsetWidth - floatingRightBoundaryInset);
      const bottomInset = getFloatingBottomInset(parent);
      const maxY = Math.max(minY, parent.clientHeight - el.offsetHeight - bottomInset);
      return {
        x: Math.min(Math.max(0, x), maxX),
        y: Math.min(Math.max(minY, y), maxY),
      };
    },
    [activeView, floatingRightBoundaryInset, getFloatingBottomInset, hasScreenShare],
  );

  const clampFloatingPositionRef = React.useRef(clampFloatingPosition);
  clampFloatingPositionRef.current = clampFloatingPosition;

  React.useEffect(() => {
    floatingPosRef.current = floatingPos;
  }, [floatingPos]);
  floatingPosLayoutRef.current = floatingPosLayout;

  // 修复历史残留：曾用 iframe.style.pointerEvents='none' 导致整页点不了
  const restoreLiveDocIframePointerEvents = React.useCallback(() => {
    document.querySelectorAll<HTMLIFrameElement>('iframe[title="LiveDoc"]').forEach((iframe) => {
      iframe.style.pointerEvents = '';
    });
  }, []);

  const setLiveDocIframePointerEventsEnabled = React.useCallback((enabled: boolean) => {
    document.querySelectorAll<HTMLIFrameElement>('iframe[title="LiveDoc"]').forEach((iframe) => {
      iframe.style.pointerEvents = enabled ? '' : 'none';
    });
  }, []);

  React.useEffect(() => {
    restoreLiveDocIframePointerEvents();
  }, [restoreLiveDocIframePointerEvents]);

  /** 仅真正控件忽略拖拽；头像允许「按住拖动 / 轻点预览」 */
  const shouldIgnoreFloatingDragTarget = (target: Element) =>
    Boolean(
      target.closest('.kloud-custom-mic-indicator') ||
        target.closest('.kloud-custom-cam-indicator') ||
        target.closest('.floating-chevron-btn') ||
        target.closest('.floating-collapsed-preview') ||
        target.closest('button'),
    );

  const handleCollapsedAvatarClick = React.useCallback((participantId: string) => {
    setFloatingCollapsedPreviewId((prev) => (prev === participantId ? null : participantId));
  }, []);

  const shouldKeepFloatingCollapsedPreview = React.useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest('.floating-stacked-avatars') ||
        target.closest('.floating-collapsed-preview') ||
        target.closest('.floating-chevron-btn'),
    );
  }, []);

  // 收起态预览：点击空白处关闭（pointerdown capture + LiveDoc iframe 点击消息）
  React.useEffect(() => {
    if (!floatingCollapsedPreviewId || floatingExpanded) return;

    const close = () => setFloatingCollapsedPreviewId(null);

    const onOutsidePointerDown = (e: PointerEvent) => {
      if (shouldKeepFloatingCollapsedPreview(e.target)) return;
      close();
    };

    const onLiveDocClick = (e: MessageEvent) => {
      const payload = e.data;
      const msgType =
        typeof payload === 'object' && payload !== null && 'type' in payload
          ? String((payload as { type?: unknown }).type ?? '')
          : '';
      if (msgType === 'Kloud-onMouseClick') {
        close();
      }
    };

    document.addEventListener('pointerdown', onOutsidePointerDown, true);
    window.addEventListener('message', onLiveDocClick);
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
      window.removeEventListener('message', onLiveDocClick);
    };
  }, [floatingCollapsedPreviewId, floatingExpanded, shouldKeepFloatingCollapsedPreview]);

  React.useEffect(() => {
    if (!floatingCollapsedPreviewId) return;
    if (floatingCollapsedPreviewId === 'local') return;
    if (!room.remoteParticipants.has(floatingCollapsedPreviewId)) {
      setFloatingCollapsedPreviewId(null);
    }
  }, [room.remoteParticipants, floatingCollapsedPreviewId]);

  const FLOATING_DRAG_THRESHOLD_PX = 8;
  const suppressFloatingAvatarClickRef = React.useRef(false);
  const floatingDragCleanupRef = React.useRef<(() => void) | null>(null);

  const clearFloatingDragListeners = React.useCallback(() => {
    floatingDragCleanupRef.current?.();
    floatingDragCleanupRef.current = null;
    isDragging.current = false;
    setIsFloatingDragging(false);
    // 拖拽结束必须恢复 iframe，否则 LiveDoc 全屏区域全部点不了
    restoreLiveDocIframePointerEvents();
  }, [restoreLiveDocIframePointerEvents]);
  clearFloatingDragListenersRef.current = clearFloatingDragListeners;

  // 组件卸载时务必收尾
  React.useEffect(() => () => clearFloatingDragListeners(), [clearFloatingDragListeners]);

  // ① 切入 LiveDoc 模式时释放一次浮窗手势
  const prevActiveViewForFloatingDragRef = React.useRef(activeView);
  React.useEffect(() => {
    const prev = prevActiveViewForFloatingDragRef.current;
    prevActiveViewForFloatingDragRef.current = activeView;
    if (activeView === 'liveDoc' && prev !== 'liveDoc') {
      clearFloatingDragListeners();
    }
  }, [activeView, clearFloatingDragListeners]);

  // 切后台时兜底恢复，防止 iframe pointer-events 残留
  React.useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') clearFloatingDragListeners();
    };
    const onPageHide = () => clearFloatingDragListeners();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [clearFloatingDragListeners]);

  const handleFloatingPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (!(e.target instanceof Element)) return;
      if (shouldIgnoreFloatingDragTarget(e.target)) return;

      clearFloatingDragListeners();

      const panelEl = e.currentTarget;
      const pointerId = e.pointerId;
      const originX = e.clientX;
      const originY = e.clientY;
      let moved = false;
      let dragActive = false;
      let watchdogTimer: number | null = null;
      const latestPos = { x: floatingPosRef.current.x, y: floatingPosRef.current.y };

      const applyDomPosition = (x: number, y: number) => {
        latestPos.x = x;
        latestPos.y = y;
        panelEl.style.left = `${x}px`;
        panelEl.style.top = `${y}px`;
        panelEl.style.right = 'auto';
        panelEl.style.transition = 'none';
      };

      const clientToParentPos = (clientX: number, clientY: number) => {
        const parent = panelEl.offsetParent as HTMLElement | null;
        if (!parent) {
          return {
            x: clientX - dragOffset.current.x,
            y: clientY - dragOffset.current.y,
          };
        }
        const pRect = parent.getBoundingClientRect();
        return {
          x: clientX - pRect.left - dragOffset.current.x,
          y: clientY - pRect.top - dragOffset.current.y,
        };
      };

      const beginDrag = (clientX: number, clientY: number) => {
        if (dragActive) return;
        dragActive = true;
        moved = true;
        isDragging.current = true;
        setFloatingCollapsedPreviewId(null);
        // 关键：拖拽期间禁用 LiveDoc iframe 命中，否则手指一进文档区父页就收不到 move/up
        setLiveDocIframePointerEventsEnabled(false);

        const parent = panelEl.offsetParent as HTMLElement | null;
        if (floatingPosLayoutRef.current === 'right-inset' && parent) {
          const rect = panelEl.getBoundingClientRect();
          const pRect = parent.getBoundingClientRect();
          const x = rect.left - pRect.left;
          const y = rect.top - pRect.top;
          const clamped = clampFloatingPositionRef.current(x, y);
          floatingPosRef.current = clamped;
          setFloatingPosLayout('coordinates');
          setFloatingPos(clamped);
          setIsFloatingDragging(true);
          applyDomPosition(clamped.x, clamped.y);
          dragOffset.current = {
            x: clientX - pRect.left - clamped.x,
            y: clientY - pRect.top - clamped.y,
          };
        } else if (parent) {
          const p = floatingPosRef.current;
          const pRect = parent.getBoundingClientRect();
          dragOffset.current = {
            x: clientX - pRect.left - p.x,
            y: clientY - pRect.top - p.y,
          };
          setIsFloatingDragging(true);
          applyDomPosition(p.x, p.y);
        } else {
          const p = floatingPosRef.current;
          dragOffset.current = { x: clientX - p.x, y: clientY - p.y };
          setIsFloatingDragging(true);
        }
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const dx = ev.clientX - originX;
        const dy = ev.clientY - originY;
        if (!dragActive) {
          if (dx * dx + dy * dy < FLOATING_DRAG_THRESHOLD_PX * FLOATING_DRAG_THRESHOLD_PX) {
            return;
          }
          beginDrag(originX, originY);
        }
        if (!dragActive) return;
        const raw = clientToParentPos(ev.clientX, ev.clientY);
        const next = clampFloatingPositionRef.current(raw.x, raw.y);
        applyDomPosition(next.x, next.y);
      };

      // touch 在跨 iframe 时比 pointer 更稳：目标仍绑定 touchstart 元素
      const onTouchMove = (ev: TouchEvent) => {
        if (!ev.touches.length) return;
        const t = ev.touches[0];
        const dx = t.clientX - originX;
        const dy = t.clientY - originY;
        if (!dragActive) {
          if (dx * dx + dy * dy < FLOATING_DRAG_THRESHOLD_PX * FLOATING_DRAG_THRESHOLD_PX) {
            return;
          }
          beginDrag(originX, originY);
        }
        if (!dragActive) return;
        if (ev.cancelable) ev.preventDefault();
        const raw = clientToParentPos(t.clientX, t.clientY);
        const next = clampFloatingPositionRef.current(raw.x, raw.y);
        applyDomPosition(next.x, next.y);
      };

      const endGesture = (ev: PointerEvent | TouchEvent) => {
        if ('pointerId' in ev && ev.pointerId !== pointerId) return;
        cleanup();
      };

      let ended = false;
      const cleanup = () => {
        if (ended) return;
        ended = true;
        if (watchdogTimer !== null) {
          window.clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', endGesture);
        window.removeEventListener('pointercancel', endGesture);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', endGesture);
        window.removeEventListener('touchcancel', endGesture);
        restoreLiveDocIframePointerEvents();
        if (moved) {
          suppressFloatingAvatarClickRef.current = true;
          const committed = clampFloatingPositionRef.current(latestPos.x, latestPos.y);
          floatingPosRef.current = committed;
          setFloatingPos(committed);
          setFloatingPosLayout('coordinates');
        }
        isDragging.current = false;
        setIsFloatingDragging(false);
        if (floatingDragCleanupRef.current === cleanup) {
          floatingDragCleanupRef.current = null;
        }
      };

      floatingDragCleanupRef.current = cleanup;
      // 不用 setPointerCapture（跨 iframe / 文档加载时易残留，表现为点击错位）
      // 起手即暂时让 iframe 不抢事件，松手/清理时必恢复
      setLiveDocIframePointerEventsEnabled(false);
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', endGesture);
      window.addEventListener('pointercancel', endGesture);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', endGesture);
      window.addEventListener('touchcancel', endGesture);
      // 极端兜底：最长按住拖 30s 后强制收尾（避免 up 丢失导致永久点不了）
      watchdogTimer = window.setTimeout(() => cleanup(), 30000);
    },
    [
      clearFloatingDragListeners,
      restoreLiveDocIframePointerEvents,
      setLiveDocIframePointerEventsEnabled,
    ],
  );

  // 勿在「切换到 coordinates」时触发：起手已写入 clamped 坐标，再 setState 会多一次布局导致卡顿。
  React.useLayoutEffect(() => {
    if (floatingPosLayoutRef.current !== 'coordinates') return;
    if (isDragging.current) return;
    setFloatingPos((pos) => clampFloatingPosition(pos.x, pos.y));
  }, [clampFloatingPosition, floatingExpanded]);

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
  const [chatMessages, setChatMessages] = React.useState<ChatMsg[]>([]);

  React.useEffect(() => {
    const controller = new AbortController();
    const loadChatHistory = async (): Promise<void> => {
      try {
        const response = await fetchWithTimeout(
          `/api/meetings/${encodeURIComponent(meetingRoomName)}/chat-messages`,
          {
            cache: 'no-store',
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${connectionDetailsRef.current.participantToken}`,
            },
          },
        );
        if (!response.ok) return;

        const body = await response.json() as ChatHistoryResponse;
        if (!Array.isArray(body.messages)) return;
        const history = body.messages
          .filter(isPersistedChatMessage)
          .map<ChatMsg>((message) => ({
            ...message,
            isLocal: message.senderIdentity === room.localParticipant.identity,
          }));
        setChatMessages((current) => mergeChatMessages(current, history));
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    };

    void loadChatHistory();
    return () => controller.abort();
  }, [meetingRoomName, room.localParticipant.identity]);

  React.useEffect(() => {
    const handleChatData = (
      payload: Uint8Array,
      _participant?: RemoteParticipant,
      _kind?: DataPacket_Kind,
      topic?: string,
    ) => {
      if (topic !== CHAT_TOPIC) return;
      try {
        const data: unknown = JSON.parse(chatDecoder.decode(payload));
        if (!isChatWireMessage(data)) return;
        const incoming: ChatMsg = {
          clientMessageId: getChatMessageId(data),
          senderIdentity: data.senderIdentity,
          senderName: data.senderName,
          message: data.message,
          timestamp: data.timestamp,
          isLocal: data.senderIdentity === room.localParticipant.identity,
        };
        setChatMessages((current) => mergeChatMessages(current, [incoming]));
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
      const clientMessageId = createChatMessageId();
      const senderName =
        room.localParticipant.name || room.localParticipant.identity || 'You';
      const localMessage: ChatMsg = {
        clientMessageId,
        senderIdentity: room.localParticipant.identity,
        senderName,
        message: text,
        timestamp: now,
        isLocal: true,
      };
      setChatMessages((current) => mergeChatMessages(current, [localMessage]));
      const payload = chatEncoder.encode(
        JSON.stringify({
          type: 'chat',
          clientMessageId,
          senderIdentity: room.localParticipant.identity,
          senderName,
          message: text,
          timestamp: now,
        }),
      );
      room.localParticipant
        .publishData(payload, { reliable: true, topic: CHAT_TOPIC })
        .catch(() => {
          room.localParticipant.publishData(payload, { topic: CHAT_TOPIC }).catch(console.error);
        });

      const persistMessage = async (): Promise<void> => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const response = await fetchWithTimeout(
              `/api/meetings/${encodeURIComponent(meetingRoomName)}/chat-messages`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${connectionDetailsRef.current.participantToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ clientMessageId, message: text }),
              },
            );
            if (response.ok || response.status < 500) return;
          } catch (error) {
            if (attempt === 1 || (error instanceof Error && error.name === 'AbortError')) return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
      };
      void persistMessage();
    },
    [room, chatEncoder, meetingRoomName],
  );

  return (
    <div className={`lk-room-container ${isToolbarMobile ? 'kloud-mobile-meeting' : ''}`} style={{ position: 'relative', height: '100%' }}>
      <RoomContext.Provider value={room}>
        <ParticipantRoleMenuProvider {...participantRoleActions}>
        {/* 有屏幕共享时走 VideoConference 自带 RoomAudioRenderer，避免双挂载回声 */}
        {isToolbarMobile && !hasScreenShare && <KloudMobileRoomAudioRenderer />}
        <KeyboardShortcuts />

        {/* ── Host ended meeting (remote end or END_MEETING) ── */}
        {meetingEndedByHost && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 99999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(8, 8, 18, 0.88)',
              backdropFilter: 'blur(14px)',
            }}
          >
            <div
              style={{
                background: '#fff',
                borderRadius: '16px',
                padding: '2rem 2.25rem',
                maxWidth: '420px',
                width: '90%',
                textAlign: 'center',
                boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '12px',
                  background: '#fef2f2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1rem',
                }}
              >
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
                  <rect x="2" y="2" width="20" height="20" rx="2" fill="#ef4444" />
                  <path
                    d="M12 7v7M12 16.5v.5"
                    stroke="#fff"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.125rem', color: '#111827' }}>
                {t('meeting.closedByHostTitle')}
              </h3>
              <p style={{ margin: '0 0 1.5rem', color: '#4b5563', lineHeight: 1.6, fontSize: '0.9375rem' }}>
                {t('meeting.closedByHostDesc')}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (hostEndedRedirectTimerRef.current) {
                    clearTimeout(hostEndedRedirectTimerRef.current);
                    hostEndedRedirectTimerRef.current = null;
                  }
                  router.push('/');
                }}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                {t('meeting.returnHomeNow')}
              </button>
            </div>
          </div>
        )}

        {/* ── Duplicate session eviction (same user joined elsewhere) ── */}
        {evictedByDuplicateSession && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 99999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(8, 8, 18, 0.88)',
              backdropFilter: 'blur(14px)',
            }}
          >
            <div
              style={{
                background: '#fff',
                borderRadius: '16px',
                padding: '2rem 2.25rem',
                maxWidth: '420px',
                width: '90%',
                textAlign: 'center',
                boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '12px',
                  background: '#eff6ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1rem',
                }}
              >
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9" />
                  <path d="M3 4v5h5" />
                </svg>
              </div>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.125rem', color: '#111827' }}>
                {t('meeting.duplicateSessionTitle')}
              </h3>
              <p style={{ margin: '0 0 1.5rem', color: '#4b5563', lineHeight: 1.6, fontSize: '0.9375rem' }}>
                {t('meeting.duplicateSessionDesc')}
              </p>
              <button
                type="button"
                onClick={() => router.push('/')}
                style={{
                  padding: '0.625rem 1.5rem',
                  background: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                {t('meeting.returnHomeNow')}
              </button>
            </div>
          </div>
        )}

        {/* ── Connection Error / Retry Overlay ── */}
        {connectError !== null && !meetingEndedByHost && (
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
                    markIntentionalDisconnect();
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
                      connectWithFreshDetails()
                        .then(() => {
                          hasConnectedOnceRef.current = true;
                          intentionalDisconnectRef.current = false;
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
                            if (isToolbarMobileUserAgent()) {
                              room.startAudio().catch(() => null);
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
          className={`main-meeting-area${
            isToolbarMobile &&
            ((activeView === 'webcam' && !hasScreenShare) || shouldDisplayLiveDoc)
              ? ' kloud-mobile-webcam-view'
              : ''
          }`}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom:
              isToolbarMobile &&
              ((activeView === 'webcam' && !hasScreenShare) || shouldDisplayLiveDoc)
                ? 'var(--kloud-mobile-toolbar-height)'
                : 0,
            overflow: 'hidden',
            display: 'flex',
          }}
        >
          {/* Standalone LiveDoc mounts only after first activation, then stays mounted to avoid iframe reloads. */}
          <div
            style={{
              display: shouldDisplayLiveDoc ? 'flex' : 'none',
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
            <div style={{ flex: 1, position: 'relative', overflow: 'auto' }}>
              {shouldMountLiveDoc && (
                <LiveDocView
                  meetingRoomName={meetingRoomName}
                  participantName={props.userChoices.username}
                  livedocInstanceId={livedocInstanceId}
                  hostInitError={livedocInitError}
                  hostInitInProgress={livedocInitInProgress}
                  isHost={isHost}
                  livedocRole={livedocEmbedRole}
                />
              )}
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
                  setLiveDocFilePanelVisible(true);
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
                      {allP.map((p) => (
                        <LiveDocWebcamSidebarTile
                          key={p.id}
                          participant={p.participant}
                          name={p.name}
                          mediaRestrictions={floatingMediaRestrictions}
                        />
                      ))}
                    </div>
                  </div>
                );
              })()}
          </div>

          {/* VideoConference: always visible when not in pure LiveDoc mode */}
          <div
            className={`sky-meet-video-wrapper ${isWebcamSidebarCollapsed ? 'sidebar-collapsed' : ''} ${screenShareActive ? 'presenter-sharing' : ''} ${isMirrorBlocked ? 'mirror-blocked' : ''} ${isRecorderBot ? 'recorder-bot-view' : ''}`}
            style={{
              flex: 1,
              position: 'relative',
              display: shouldDisplayLiveDoc ? 'none' : 'block',
            }}
          >
            {isToolbarMobile && activeView === 'webcam' && !hasScreenShare ? (
              <MobileVideoLayout />
            ) : isToolbarMobile && !hasScreenShare ? (
              <ConnectionStateToast />
            ) : (
              <VideoConferenceErrorBoundary>
                <VideoConference
                  chatMessageFormatter={formatChatMessageLinks}
                  SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
                />
              </VideoConferenceErrorBoundary>
            )}

            {/* Mirror-blocked: overlay LiveDoc on top of the entire screenshare view */}
            {hasScreenShare && isMirrorBlocked && shouldMountLiveDoc && (
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
                  livedocRole={livedocEmbedRole}
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
            {hasScreenShare && !screenShareActive && !isRemoteControlMode && !isRecorderBot && (
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
          {shouldShowFloatingWebcamPanel &&
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
                  onPointerDown={handleFloatingPointerDown}
                  style={{
                    position: 'absolute',
                    top: floatingPos.y,
                    ...(floatingPosLayout === 'right-inset'
                      ? { right: floatingRightInset, left: 'auto' as const }
                      : { left: floatingPos.x, right: 'auto' as const }),
                    // 必须低于底栏(1001)，否则会盖住导航导致点击错位
                    zIndex: isFloatingDragging ? 900 : 350,
                    cursor: isFloatingDragging ? 'grabbing' : 'grab',
                    userSelect: 'none',
                    touchAction: 'none',
                    transition: isFloatingDragging
                      ? 'none'
                      : 'left 260ms cubic-bezier(0.22, 1, 0.36, 1), right 260ms cubic-bezier(0.22, 1, 0.36, 1), top 180ms ease-out, opacity 0.35s ease',
                  }}
                >
                  {!floatingExpanded && (
                    <>
                    <div className="floating-collapsed-row">
                      <div className="floating-stacked-avatars">
                        {allParticipants.slice(0, maxVisible).map((p, i) => {
                          const participant =
                            p.id === 'local'
                              ? room.localParticipant
                              : room.remoteParticipants.get(p.id);
                          const isPreviewSelected = floatingCollapsedPreviewId === p.id;
                          if (!participant) {
                            return (
                              <div
                                key={p.id}
                                className={`floating-avatar${isPreviewSelected ? ' selected' : ''}`}
                                title={p.name}
                                style={{ zIndex: maxVisible - i }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (suppressFloatingAvatarClickRef.current) {
                                    suppressFloatingAvatarClickRef.current = false;
                                    return;
                                  }
                                  handleCollapsedAvatarClick(p.id);
                                }}
                                role="button"
                                tabIndex={0}
                              >
                                {getInitials(p.name || p.id || '?')}
                              </div>
                            );
                          }
                          return (
                            <LiveDocFloatingCollapsedAvatar
                              key={p.id}
                              participant={participant}
                              name={p.name}
                              style={{ zIndex: maxVisible - i }}
                              selected={isPreviewSelected}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (suppressFloatingAvatarClickRef.current) {
                                  suppressFloatingAvatarClickRef.current = false;
                                  return;
                                }
                                handleCollapsedAvatarClick(p.id);
                              }}
                            />
                          );
                        })}
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
                          setFloatingCollapsedPreviewId(null);
                          setFloatingExpanded(true);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
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
                    {floatingCollapsedPreviewId && (() => {
                      const previewEntry = allParticipants.find((p) => p.id === floatingCollapsedPreviewId);
                      if (!previewEntry) return null;
                      const previewParticipant =
                        previewEntry.id === 'local'
                          ? room.localParticipant
                          : room.remoteParticipants.get(previewEntry.id);
                      if (!previewParticipant) return null;
                      return (
                        <div
                          className="floating-collapsed-preview"
                          onMouseDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                        >
                          <LiveDocFloatingGridTile
                            participant={previewParticipant}
                            name={previewEntry.name}
                            size="hero"
                            mediaRestrictions={floatingMediaRestrictions}
                          />
                        </div>
                      );
                    })()}
                    </>
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
                                setFloatingCollapsedPreviewId(null);
                                setFloatingExpanded(false);
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              onTouchStart={(e) => e.stopPropagation()}
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
                          <div className="floating-expanded-grid-wrap">
                            <LiveDocFloatingExpandedParticipantLayout
                              room={room}
                              hostIdentity={hostIdentity}
                              cohostIdentities={cohostIdentities}
                              sortedEntries={allParticipants}
                              mediaRestrictions={floatingMediaRestrictions}
                            />
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
                  localIdentity={room.localParticipant.identity}
                  autoPresenterIdentity={autoPresenterIdentity}
                  canMuteAll={isHost || isCohost || isCopresenter || isAutoPresenter}
                  muteAllActive={muteAllActive}
                  onMuteAll={handleMuteAll}
                  onUnmuteAll={handleUnmuteAll}
                  onMuteParticipant={isHost || isCohost ? handleMuteParticipant : undefined}
                  onDisableParticipantVideo={isHost || isCohost ? handleDisableParticipantVideo : undefined}
                  hostMutedIdentities={hostMutedIdentities}
                  hostDisabledVideoIdentities={hostDisabledVideoIdentities}
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

              /* 3. Screenshare aside（lk-carousel）与浮窗左侧 3 个大格（hero）同款样式 */
              .sky-meet-video-wrapper .lk-carousel { 
                --screenshare-aside-tile: 132px;
                display: flex !important;
                flex-direction: column !important;
                justify-content: flex-start !important;
                align-items: center !important;
                width: calc(var(--screenshare-aside-tile) + 16px) !important; 
                min-width: calc(var(--screenshare-aside-tile) + 16px) !important; 
                max-width: calc(var(--screenshare-aside-tile) + 16px) !important;
                height: 100% !important;
                margin: 0 !important;
                flex-shrink: 0 !important; 
                background: rgba(22, 48, 36, 0.42) !important;
                gap: 8px !important;
                overflow-y: auto !important;
                overflow-x: hidden !important;
                border-right: 1px solid rgba(255,255,255,0.06) !important;
                padding: 8px !important;
                box-sizing: border-box !important;
              }
              
              /* This pure CSS toggle prevents the catastrophic Layout Thrashing bug */
              .sky-meet-video-wrapper.sidebar-collapsed .lk-carousel {
                display: none !important;
              }
              .sky-meet-video-wrapper.recorder-bot-view .lk-carousel {
                display: none !important;
              }

              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile {
                position: relative !important;
                display: block !important;
                flex: 0 0 auto !important;
                width: var(--screenshare-aside-tile) !important;
                max-width: var(--screenshare-aside-tile) !important;
                height: auto !important;
                min-height: 0 !important;
                aspect-ratio: 1 / 1 !important;
                border-radius: 12px !important;
                box-shadow: none !important;
                overflow: hidden !important;
                background: #1e293b !important;
                gap: 0 !important;
                padding: 0 !important;
                pointer-events: auto !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-video-container,
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-participant-media-container {
                position: relative !important;
                width: 100% !important;
                height: 100% !important;
                aspect-ratio: 1 / 1 !important;
                border-radius: 12px !important;
                overflow: hidden !important;
                background: #1e293b !important;
                pointer-events: none !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile video {
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
                pointer-events: none !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-participant-placeholder {
                background: #e8dcc8 !important;
                color: #111827 !important;
                font-size: 22px !important;
                font-weight: 700 !important;
              }
              /* 关摄像头时 tile 中央的缩写（::after），覆盖全局白字 */
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile[data-lk-video-muted="true"][data-lk-source="camera"] .lk-participant-placeholder::after {
                color: #111827 !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile:hover .lk-video-container,
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile:hover .lk-participant-media-container {
                box-shadow: 0 0 0 2px #3b82f6 !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-participant-metadata {
                position: absolute !important;
                inset: auto auto 4px 4px !important;
                left: 4px !important;
                right: auto !important;
                bottom: 4px !important;
                top: auto !important;
                width: auto !important;
                max-width: calc(100% - 8px) !important;
                justify-content: flex-start !important;
                z-index: 4 !important;
                pointer-events: none !important;
                background: transparent !important;
                padding: 0 !important;
                margin: 0 !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-participant-metadata-item {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: flex-start !important;
                gap: 1.25rem !important;
                max-width: 100% !important;
                min-width: 0 !important;
                padding: 0 !important;
                line-height: 1 !important;
                border-radius: 0 !important;
                background: transparent !important;
                backdrop-filter: none !important;
                pointer-events: none !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-participant-metadata-item .kloud-custom-mic-indicator,
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-participant-metadata-item .kloud-custom-cam-indicator {
                pointer-events: auto !important;
                width: 28px !important;
                height: 28px !important;
                min-width: 28px !important;
                min-height: 28px !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-participant-name {
                display: none !important;
              }
              /* Camera-off carousel: initials by default, login name on hover/select */
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile[data-lk-video-muted="true"][data-lk-source="camera"] .lk-participant-placeholder::after {
                content: attr(data-lk-initials) !important;
                font-size: clamp(1rem, 3vw, 1.5rem) !important;
                font-weight: 700 !important;
                text-transform: uppercase !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile[data-lk-video-muted="true"][data-lk-source="camera"]:hover .lk-participant-placeholder::after,
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile[data-lk-video-muted="true"][data-lk-source="camera"]:focus-within .lk-participant-placeholder::after,
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile[data-lk-video-muted="true"][data-lk-source="camera"][data-lk-selected="true"] .lk-participant-placeholder::after {
                content: attr(data-lk-name) !important;
                font-size: clamp(0.75rem, 2.2vw, 1.1rem) !important;
                font-weight: 600 !important;
                text-transform: none !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile > button,
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-button,
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-focus-toggle-button {
                display: none !important;
                pointer-events: none !important;
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
                  height: auto !important;
                  min-height: 0 !important;
                  flex-direction: column !important;
                  flex-wrap: nowrap !important;
                  justify-content: flex-start !important;
                  align-items: center !important;
                  overflow-x: hidden !important;
                  overflow-y: auto !important;
                  -webkit-overflow-scrolling: touch;
                  overscroll-behavior-x: none;
                  touch-action: pan-y;
                  border-right: none !important;
                  border-bottom: 1px solid rgba(255,255,255,0.1) !important;
                  padding: 8px !important;
                  gap: 8px !important;
                }
                .sky-meet-video-wrapper .lk-carousel {
                  --screenshare-aside-tile: 100px;
                  width: calc(var(--screenshare-aside-tile) + 16px) !important;
                  max-width: calc(var(--screenshare-aside-tile) + 16px) !important;
                  min-width: calc(var(--screenshare-aside-tile) + 16px) !important;
                }
                .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile {
                  width: var(--screenshare-aside-tile) !important;
                  max-width: var(--screenshare-aside-tile) !important;
                  height: auto !important;
                  aspect-ratio: 1 / 1 !important;
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
               touch-action: none;
               -webkit-user-select: none;
               opacity: 1;
               pointer-events: auto;
               transition: opacity 0.35s ease;
            }
            .floating-webcam-panel.expanded {
               border-radius: 16px;
               padding: 10px 12px;
               width: fit-content;
               max-width: min(420px, calc(100vw - 24px));
               min-width: 0;
               box-sizing: border-box;
               overflow: visible;
            }
            @media (max-width: 768px) {
               .floating-webcam-panel.expanded {
                  max-width: min(280px, calc(100vw - 24px));
                  /* 头栏≈36 + 面板/网格 padding≈36 + 3×hero(132) + 2×gap(8) ≈ 508，保证左侧三大格完整可视 */
                  max-height: calc(36px + 36px + 3 * 132px + 2 * 8px);
                  overflow: auto;
               }
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
            .floating-stacked-avatars .floating-avatar,
            .floating-stacked-avatars .floating-avatar-shell {
               margin-left: -8px;
               transition: transform 0.15s ease;
            }
            .floating-stacked-avatars .floating-avatar:first-child,
            .floating-stacked-avatars .floating-avatar-shell:first-child {
               margin-left: 0;
            }
            .floating-stacked-avatars .floating-avatar:hover,
            .floating-stacked-avatars .floating-avatar-shell:hover {
               transform: scale(1.15);
            }
            .floating-stacked-avatars .floating-avatar:not(.overflow-badge),
            .floating-stacked-avatars .floating-avatar-shell {
               cursor: pointer;
            }
            .floating-stacked-avatars .floating-avatar.selected,
            .floating-stacked-avatars .floating-avatar-shell.selected .floating-avatar {
               border-color: #60a5fa;
               box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.45);
            }
            .floating-collapsed-preview {
               margin-top: 6px;
               padding-top: 6px;
               border-top: 1px solid rgba(255,255,255,0.08);
               width: var(--floating-hero-col-w, 132px);
               cursor: default;
            }
            .floating-webcam-panel:not(.expanded):has(.floating-collapsed-preview) {
               padding-bottom: 8px;
            }
            .floating-avatar-shell.lk-participant-tile {
               width: 30px;
               height: 30px;
               flex-shrink: 0;
               border-radius: 50%;
               --lk-border-radius: 50%;
               padding: 0 !important;
               display: flex !important;
               align-items: center;
               justify-content: center;
               gap: 0 !important;
               flex-direction: row !important;
            }
            .floating-avatar-shell .floating-avatar {
               border: none !important;
               width: 100%;
               height: 100%;
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
            .floating-expanded-grid-wrap {
               margin-top: 2px;
               width: fit-content;
               max-width: 100%;
            }
            .floating-expanded-grid {
               display: flex;
               flex-direction: row;
               align-items: stretch;
               width: fit-content;
               max-width: 100%;
               gap: 10px;
               background: rgba(22, 48, 36, 0.42);
               border-radius: 14px;
               padding: 8px 8px 8px 8px;
               border: 1px solid rgba(255,255,255,0.06);
               overflow: visible;
               --floating-hero-col-w: 132px;
               --floating-rest-tile: calc(var(--floating-hero-col-w) / 3 + 10px);
            }
            .floating-expanded-grid:has(.floating-compact-slot:hover) {
               align-items: flex-start;
            }
            .floating-expanded-grid--heroes-only {
               gap: 0;
            }
            .floating-webcam-panel.expanded:has(.floating-expanded-grid--heroes-only) {
               min-width: 156px;
               max-width: 168px;
            }
            .floating-expanded-hero-column {
               display: flex;
               flex-direction: column;
               justify-content: center;
               gap: 8px;
               width: var(--floating-hero-col-w, 132px);
               flex-shrink: 0;
               align-self: stretch;
               min-height: 0;
            }
            .floating-expanded-rest-wrap {
               flex: 0 0 auto;
               width: fit-content;
               min-width: calc(var(--floating-rest-tile) * var(--floating-rest-visible-cols, 1) + 8px * (var(--floating-rest-visible-cols, 1) - 1));
               max-width: calc(var(--floating-rest-tile) * 3 + 16px);
               display: flex;
               flex-direction: column;
               position: relative;
               z-index: 2;
               box-sizing: border-box;
               min-height: 0;
               align-self: stretch;
               overflow: visible;
               transition: min-width 0.22s cubic-bezier(0.22, 1, 0.36, 1), max-width 0.22s cubic-bezier(0.22, 1, 0.36, 1);
            }
            .floating-expanded-rest-wrap:has(.floating-compact-slot:hover) {
               max-width: calc(var(--floating-rest-tile) * 3 + 16px + var(--floating-rest-tile));
            }
            .floating-expanded-rest-scroll {
               flex: 1 1 auto;
               min-height: 0;
               display: flex;
               flex-direction: row;
               flex-wrap: nowrap;
               align-items: stretch;
               gap: 8px;
               overflow-x: auto;
               overflow-y: visible;
               scrollbar-width: thin;
               -webkit-overflow-scrolling: touch;
               width: fit-content;
            }
            .floating-expanded-rest-col {
               display: flex;
               flex-direction: column;
               justify-content: center;
               gap: 6px;
               flex: 0 0 var(--floating-rest-tile);
               width: var(--floating-rest-tile);
               min-width: 0;
               min-height: 0;
               align-self: stretch;
               overflow: visible;
               transition: width 0.22s cubic-bezier(0.22, 1, 0.36, 1), flex-basis 0.22s cubic-bezier(0.22, 1, 0.36, 1);
            }
            .floating-expanded-rest-col:has(.floating-compact-slot:hover) {
               flex: 0 0 calc(var(--floating-rest-tile) * 2);
               width: calc(var(--floating-rest-tile) * 2);
            }
            /* 右侧小格：悬停时槽位真实宽高 2 倍，撑开列 / 浮窗外层容器 */
            .floating-expanded-rest-scroll .floating-compact-slot {
              position: relative;
              width: var(--floating-rest-tile);
              height: var(--floating-rest-tile);
              flex-shrink: 0;
              z-index: 1;
              transition: width 0.22s cubic-bezier(0.22, 1, 0.36, 1), height 0.22s cubic-bezier(0.22, 1, 0.36, 1), z-index 0s linear 0.22s;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover {
              width: calc(var(--floating-rest-tile) * 2);
              height: calc(var(--floating-rest-tile) * 2);
              z-index: 30;
              transition: width 0.22s cubic-bezier(0.22, 1, 0.36, 1), height 0.22s cubic-bezier(0.22, 1, 0.36, 1), z-index 0s;
            }
            .floating-expanded-rest-scroll .floating-compact-slot .floating-grid-tile--compact {
              width: 100%;
              height: 100%;
              position: relative;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover .floating-grid-tile--compact .floating-grid-avatar {
              font-size: calc(var(--floating-rest-tile) * 0.68);
            }
            .floating-expanded-rest-hnav {
               display: flex;
               flex-direction: row;
               justify-content: flex-end;
               align-items: center;
               gap: 8px;
               flex-shrink: 0;
               padding-top: 6px;
               min-height: 30px;
            }
            .floating-expanded-rest-hnav-btn {
               display: inline-flex;
               align-items: center;
               justify-content: center;
               width: 34px;
               height: 28px;
               border-radius: 8px;
               border: 1px solid rgba(255,255,255,0.22);
               background: rgba(0,0,0,0.35);
               color: rgba(255,255,255,0.88);
               cursor: pointer;
               transition: background 0.15s ease, opacity 0.15s ease;
            }
            .floating-expanded-rest-hnav-btn:hover:not(:disabled) {
               background: rgba(255,255,255,0.14);
            }
            .floating-expanded-rest-hnav-btn:disabled {
               opacity: 0.3;
               cursor: default;
            }
            .floating-expanded-rest-hnav-btn--primary:not(:disabled) {
               border-color: rgba(96, 165, 250, 0.55);
               color: #93c5fd;
            }
            .floating-grid-tile--hero .floating-grid-video {
               width: 100%;
               height: auto;
               aspect-ratio: 1 / 1;
               border-radius: 12px;
            }
            .floating-grid-tile--hero .floating-grid-avatar {
               font-size: 22px;
               background: #e8dcc8;
               color: #111827;
            }
            .floating-expanded-rest-scroll .floating-grid-tile--compact .floating-grid-video,
            .floating-expanded-rest-scroll .floating-compact-slot .floating-grid-video {
               width: 100%;
               height: 100%;
               aspect-ratio: 1;
               min-height: 0;
               min-width: 0;
               border-radius: 10px;
               transition: border-radius 0.22s ease;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover .floating-grid-video {
               border-radius: 12px;
            }
            .floating-expanded-rest-scroll .floating-grid-tile--compact .floating-grid-avatar {
               font-size: calc(var(--floating-rest-tile) * 0.34);
            }
            .floating-grid-tile--hero .floating-grid-name {
               font-size: 10px;
            }
            .floating-expanded-rest-scroll .floating-grid-tile--compact .floating-grid-name {
               font-size: 9px;
            }
            .floating-expanded-rest-scroll .floating-grid-tile--compact .floating-grid-name-row {
               padding: 2px 5px;
               gap: 0.75rem;
               background: transparent;
               backdrop-filter: none;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover .floating-grid-tile--compact .floating-grid-name-row {
               background: transparent;
               backdrop-filter: none;
            }
            /* 右侧小格：麦克风默认隐藏，悬停头像再显示（左侧 hero 不受影响） */
            .floating-expanded-rest-scroll .floating-grid-tile--compact .kloud-custom-mic-indicator {
              opacity: 0;
              width: 0 !important;
              min-width: 0 !important;
              height: 0 !important;
              min-height: 0 !important;
              padding: 0 !important;
              margin: 0 !important;
              overflow: hidden;
              pointer-events: none;
              transition: opacity 0.18s ease, width 0.18s ease, min-width 0.18s ease, height 0.18s ease;
            }
            /* 主持禁音 / 全员静音：小格也始终显示红色麦克风 */
            .floating-expanded-rest-scroll .floating-grid-tile--compact .kloud-custom-mic-indicator[data-kloud-host-restricted="true"],
            .floating-expanded-rest-scroll .floating-grid-tile--compact .kloud-custom-mic-indicator[data-kloud-force-muted="true"],
            .floating-expanded-rest-scroll .floating-grid-tile--compact .kloud-custom-mic-indicator.kloud-custom-mic--force-muted,
            .floating-expanded-rest-scroll .floating-grid-tile--compact .kloud-custom-mic-indicator.self-interactive {
              opacity: 1 !important;
              width: 20px !important;
              min-width: 20px !important;
              height: 20px !important;
              min-height: 20px !important;
              padding: 3px !important;
              overflow: visible !important;
              pointer-events: auto !important;
            }
            .floating-expanded-rest-scroll .floating-grid-tile--compact .kloud-custom-cam-indicator {
              opacity: 0;
              width: 0 !important;
              min-width: 0 !important;
              height: 0 !important;
              min-height: 0 !important;
              padding: 0 !important;
              margin: 0 !important;
              overflow: hidden;
              pointer-events: none;
            }
            .floating-expanded-rest-scroll .floating-grid-tile--compact .kloud-custom-cam-indicator[data-kloud-host-restricted="true"],
            .floating-expanded-rest-scroll .floating-grid-tile--compact .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled,
            .floating-expanded-rest-scroll .floating-grid-tile--compact .kloud-custom-cam-indicator.self-interactive {
              opacity: 1 !important;
              width: 20px !important;
              min-width: 20px !important;
              height: 20px !important;
              min-height: 20px !important;
              padding: 3px !important;
              overflow: visible !important;
              pointer-events: auto !important;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover .kloud-custom-mic-indicator {
              opacity: 1;
              width: 20px !important;
              min-width: 20px !important;
              height: 20px !important;
              min-height: 20px !important;
              padding: 3px !important;
              pointer-events: auto;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover .kloud-custom-mic-indicator[data-kloud-force-muted="true"],
            .floating-expanded-rest-scroll .floating-compact-slot:hover .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] {
              width: 20px !important;
              height: 20px !important;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover .kloud-custom-mic-indicator.operator-interactive {
              width: 20px !important;
              min-width: 20px !important;
              height: 20px !important;
              min-height: 20px !important;
              padding: 3px !important;
              margin: 0;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover .kloud-custom-mic-indicator.self-interactive {
              width: 20px !important;
              min-width: 20px !important;
              height: 20px !important;
              min-height: 20px !important;
              padding: 3px !important;
              margin: 0;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover .kloud-custom-cam-indicator {
              opacity: 1;
              width: 20px !important;
              min-width: 20px !important;
              height: 20px !important;
              min-height: 20px !important;
              padding: 3px !important;
              pointer-events: auto;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover .kloud-custom-cam-indicator[data-kloud-host-restricted="true"],
            .floating-expanded-rest-scroll .floating-compact-slot:hover .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled {
              width: 20px !important;
              height: 20px !important;
            }
            .floating-grid-tile {
               display: block;
               position: relative;
            }
            .floating-grid-tile.lk-participant-tile {
               gap: 0 !important;
               flex-direction: row !important;
               align-items: stretch !important;
               background: transparent !important;
            }
            .floating-grid-video {
               width: 64px;
               height: 64px;
               border-radius: 10px;
               overflow: hidden;
               background: #1e293b;
               position: relative;
               display: block;
            }
            .floating-webcam-panel .webcam-floating-participant-metadata {
               position: absolute !important;
               inset: auto auto 4px 4px !important;
               left: 4px !important;
               right: auto !important;
               bottom: 4px !important;
               top: auto !important;
               width: auto !important;
               max-width: calc(100% - 8px);
               justify-content: flex-start !important;
               z-index: 4;
               pointer-events: none;
            }
            .floating-webcam-panel .floating-grid-name-row {
               pointer-events: none;
            }
            .floating-webcam-panel .kloud-custom-mic-indicator {
               pointer-events: auto;
            }
            .floating-webcam-panel .kloud-custom-cam-indicator {
               pointer-events: auto;
            }
            .floating-webcam-panel .kloud-custom-mic-indicator,
            .floating-webcam-panel .kloud-custom-cam-indicator {
               margin: 0 !important;
            }
            /* 活文档浮窗：mic / cam / ⋯ 统一 chip 尺寸，避免一大一小 */
            .floating-webcam-panel .kloud-custom-mic-indicator,
            .floating-webcam-panel .kloud-custom-cam-indicator,
            .floating-webcam-panel .kloud-custom-mic-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-mic-indicator.self-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.self-interactive,
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"],
            .floating-webcam-panel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"],
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-force-muted="true"],
            .floating-webcam-panel .kloud-custom-mic-indicator.kloud-custom-mic--force-muted,
            .floating-webcam-panel .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled {
              width: 20px !important;
              min-width: 20px !important;
              height: 20px !important;
              min-height: 20px !important;
              padding: 3px !important;
              margin: 0 !important;
              box-sizing: border-box !important;
              border-radius: 5px !important;
            }
            .floating-webcam-panel .kloud-custom-mic-indicator svg,
            .floating-webcam-panel .kloud-custom-cam-indicator svg {
              width: 14px !important;
              height: 14px !important;
              max-width: 14px !important;
              max-height: 14px !important;
            }
            .floating-webcam-panel .kloud-tile-more-menu-wrap .kloud-role-icon-btn {
              width: 20px !important;
              height: 20px !important;
              min-width: 20px !important;
              min-height: 20px !important;
              padding: 0 !important;
              box-sizing: border-box !important;
            }
            .floating-webcam-panel .kloud-tile-more-menu-wrap .kloud-role-icon-btn svg {
              width: 14px !important;
              height: 14px !important;
            }
            .floating-grid-name-row {
               display: inline-flex;
               align-items: center;
               justify-content: flex-start;
               gap: 1.25rem;
               max-width: 100%;
               min-width: 0;
               padding: 0;
               line-height: 1;
               border-radius: 0;
               background: transparent;
               backdrop-filter: none;
            }
            .floating-grid-name-row .lk-track-muted-indicator-microphone {
               flex-shrink: 0;
               width: 0.75rem;
               height: 0.75rem;
            }
            .floating-grid-video video {
               width: 100%;
               height: 100%;
               object-fit: cover;
            }
            .floating-grid-avatar {
               width: 100%;
               height: 100%;
               background: linear-gradient(135deg, #8882d0, #e5e7eb);
               color: #fff;
               font-size: 16px;
               font-weight: 700;
               display: flex;
               align-items: center;
               justify-content: center;
            }
            .floating-grid-avatar-initials,
            .floating-grid-avatar-fullname {
               max-width: 100%;
               padding: 0 6px;
               overflow: hidden;
               text-overflow: ellipsis;
               white-space: nowrap;
               text-align: center;
            }
            .floating-grid-avatar-fullname {
               display: none;
               font-size: 14px;
               font-weight: 600;
               line-height: 1.2;
            }
            .floating-grid-tile.lk-participant-tile:hover .floating-grid-avatar-initials,
            .floating-grid-tile.lk-participant-tile:focus-within .floating-grid-avatar-initials {
               display: none;
            }
            .floating-grid-tile.lk-participant-tile:hover .floating-grid-avatar-fullname,
            .floating-grid-tile.lk-participant-tile:focus-within .floating-grid-avatar-fullname {
               display: block;
            }
            .floating-grid-tile--hero .floating-grid-avatar-fullname {
               font-size: 14px;
            }
            .floating-expanded-rest-scroll .floating-grid-tile--compact .floating-grid-avatar-fullname {
               font-size: calc(var(--floating-rest-tile) * 0.18);
            }
            .floating-grid-tile.lk-participant-tile:hover .floating-grid-video {
               box-shadow: 0 0 0 2px #3b82f6;
            }
            .floating-webcam-panel .floating-grid-name {
               display: none !important;
            }
            .floating-grid-name {
               color: rgba(255,255,255,0.92);
               font-size: 9px;
               font-weight: 500;
               min-width: 0;
               max-width: 0;
               opacity: 0;
               overflow: hidden;
               text-overflow: ellipsis;
               white-space: nowrap;
               text-align: left;
               transition: max-width 0.18s ease, opacity 0.18s ease;
            }
            .floating-grid-tile.lk-participant-tile:hover .floating-grid-name {
               opacity: 1;
               max-width: 72px;
            }
            .floating-grid-tile.lk-participant-tile.floating-grid-tile--hero:hover .floating-grid-name {
               max-width: 120px;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover .floating-grid-name {
               max-width: calc(var(--floating-rest-tile) * 2 - 8px);
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
            .webcam-sidebar-tile.lk-participant-tile {
               gap: 0 !important;
               flex-direction: column !important;
            }
            .webcam-sidebar-panel .webcam-sidebar-participant-metadata {
               position: static !important;
               inset: auto !important;
               left: auto !important;
               right: auto !important;
               bottom: auto !important;
               width: 100%;
               flex-direction: column;
               align-items: stretch;
               gap: 0;
            }
            .webcam-sidebar-panel .webcam-sidebar-participant-metadata .webcam-sidebar-meta {
               width: 100%;
            }
            .webcam-sidebar-meta.lk-participant-metadata-item {
               min-width: 0;
               flex-wrap: nowrap;
            }
            .webcam-sidebar-meta .lk-track-muted-indicator-microphone {
               flex-shrink: 0;
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
               background: linear-gradient(135deg, #8882d0, #e5e7eb);
               color: #fff;
               font-size: 22px;
               font-weight: 700;
               display: flex;
               align-items: center;
               justify-content: center;
               padding: 0 8px;
               box-sizing: border-box;
               overflow: hidden;
               text-align: center;
            }
            .webcam-sidebar-avatar-initials,
            .webcam-sidebar-avatar-fullname {
               max-width: 100%;
               overflow: hidden;
               text-overflow: ellipsis;
               white-space: nowrap;
            }
            .webcam-sidebar-avatar-fullname {
               display: none;
               font-size: 14px;
               font-weight: 600;
            }
            .webcam-sidebar-tile:hover .webcam-sidebar-avatar-initials,
            .webcam-sidebar-tile:focus-within .webcam-sidebar-avatar-initials {
               display: none;
            }
            .webcam-sidebar-tile:hover .webcam-sidebar-avatar-fullname,
            .webcam-sidebar-tile:focus-within .webcam-sidebar-avatar-fullname {
               display: block;
            }
            .webcam-sidebar-meta {
               display: flex;
               align-items: center;
               gap: 1.25rem;
               padding: 0;
               background: transparent;
               color: rgba(255,255,255,0.8);
               font-size: 11px;
               font-weight: 500;
            }
            .webcam-sidebar-panel .webcam-sidebar-meta .kloud-custom-mic-indicator,
            .webcam-sidebar-panel .webcam-sidebar-meta .kloud-custom-cam-indicator {
               pointer-events: auto;
               flex-shrink: 0;
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
                  bottom: calc(var(--kloud-mobile-toolbar-height, 68px) + 8px);
               }
            }

            ${chatAndAttendeeStyles}

            /* Participant tile ⋯ 角色菜单（hover 显示） */
            .kloud-tile-more-menu-wrap {
              position: absolute;
              top: 4px;
              right: 4px;
              z-index: 6;
              opacity: 0;
              pointer-events: none;
              transition: opacity 0.15s ease;
            }
            .floating-grid-tile:hover > .kloud-tile-more-menu-wrap:not(.kloud-tile-more-menu-wrap--inline),
            .webcam-sidebar-tile:hover > .kloud-tile-more-menu-wrap:not(.kloud-tile-more-menu-wrap--inline),
            .webcam-sidebar-tile:hover .kloud-tile-more-menu-wrap--inline,
            .lk-grid-layout-wrapper .lk-participant-tile:hover .kloud-tile-more-menu-wrap--inline,
            .lk-mobile-scroll-grid .lk-participant-tile:hover .kloud-tile-more-menu-wrap--inline,
            .lk-grid-layout-wrapper .lk-participant-tile:hover > .kloud-tile-more-menu-wrap:not(.kloud-tile-more-menu-wrap--inline),
            .lk-mobile-scroll-grid .lk-participant-tile:hover > .kloud-tile-more-menu-wrap:not(.kloud-tile-more-menu-wrap--inline),
            .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile:hover > .kloud-tile-more-menu-wrap {
              opacity: 1;
              pointer-events: auto;
            }
            .kloud-tile-more-menu-wrap:has(.kloud-tile-more-menu-btn.open),
            .kloud-tile-more-menu-wrap.open {
              opacity: 1;
              pointer-events: auto;
            }
            .webcam-sidebar-tile {
              position: relative;
            }
            .lk-grid-layout-wrapper .lk-participant-tile,
            .lk-mobile-scroll-grid .lk-participant-tile {
              position: relative !important;
            }
            .kloud-tile-more-menu-wrap--inline {
              position: static;
              top: auto;
              right: auto;
              flex-shrink: 0;
            }
            /* Bottom bar: Mic / Cam / ⋯ only — name moves to center avatar */
            .lk-grid-layout-wrapper .lk-participant-metadata-item .lk-participant-name,
            .lk-mobile-scroll-grid .lk-participant-metadata-item .lk-participant-name,
            .webcam-sidebar-panel .webcam-sidebar-name,
            .floating-webcam-panel .floating-grid-name {
              display: none !important;
            }
            .lk-grid-layout-wrapper .lk-participant-metadata-item,
            .lk-mobile-scroll-grid .lk-participant-metadata-item {
              display: inline-flex !important;
              align-items: center !important;
              flex-wrap: nowrap !important;
              /* ~one icon width between controls for easier phone taps */
              gap: 1.25rem !important;
              max-width: 100% !important;
              min-width: 0 !important;
              padding: 0 !important;
              background: transparent !important;
              border-radius: 0 !important;
            }
            .lk-grid-layout-wrapper .lk-participant-metadata-item .kloud-tile-more-menu-wrap--inline .kloud-role-icon-btn,
            .lk-mobile-scroll-grid .lk-participant-metadata-item .kloud-tile-more-menu-wrap--inline .kloud-role-icon-btn {
              width: 28px;
              height: 28px;
            }
            .lk-grid-layout-wrapper .lk-participant-metadata-item .kloud-custom-mic-indicator,
            .lk-grid-layout-wrapper .lk-participant-metadata-item .kloud-custom-cam-indicator,
            .lk-mobile-scroll-grid .lk-participant-metadata-item .kloud-custom-mic-indicator,
            .lk-mobile-scroll-grid .lk-participant-metadata-item .kloud-custom-cam-indicator {
              width: 28px !important;
              height: 28px !important;
              min-width: 28px !important;
              min-height: 28px !important;
            }
            /* 触摸设备无 hover：Host 在 Webcam 网格仍能看到 ⋯ */
            @media (hover: none) {
              .lk-mobile-scroll-grid .kloud-tile-more-menu-wrap--inline,
              .lk-grid-layout-wrapper .kloud-tile-more-menu-wrap--inline {
                opacity: 1;
                pointer-events: auto;
              }
            }
            .webcam-sidebar-meta .kloud-tile-more-menu-wrap--inline .kloud-role-icon-btn {
              width: 28px;
              height: 28px;
            }
            .kloud-tile-more-menu-wrap .kloud-role-icon-btn {
              width: 20px;
              height: 20px;
              padding: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              background: rgba(0, 0, 0, 0.58);
              backdrop-filter: blur(4px);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 5px;
              box-sizing: border-box;
              color: rgba(255, 255, 255, 0.85);
              cursor: pointer;
            }
            .kloud-tile-more-menu-wrap .kloud-role-icon-btn:hover {
              background: rgba(0, 0, 0, 0.72);
              border-color: rgba(255, 255, 255, 0.22);
              color: #fff;
            }
            .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile > .kloud-tile-more-menu-wrap .kloud-tile-more-menu-btn,
            .lk-grid-layout-wrapper .lk-participant-tile > .kloud-tile-more-menu-wrap .kloud-tile-more-menu-btn,
            .lk-mobile-scroll-grid .lk-participant-tile > .kloud-tile-more-menu-wrap .kloud-tile-more-menu-btn {
              pointer-events: auto;
            }

            /* ══════════════════════════════════════════════════════
               Tile control chips — mic / cam / more 各自独立
               ══════════════════════════════════════════════════════ */
            .lk-room-container .kloud-custom-mic-indicator,
            .lk-room-container .kloud-custom-cam-indicator {
              background: rgba(0, 0, 0, 0.58);
              backdrop-filter: blur(4px);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 5px;
              box-sizing: border-box;
              margin: 0 !important;
            }
            .lk-room-container .lk-participant-metadata-item .lk-participant-name,
            .lk-room-container .lk-participant-metadata-item .webcam-sidebar-name,
            .lk-room-container .floating-grid-name-row .floating-grid-name {
              padding: 2px 6px;
              background: rgba(0, 0, 0, 0.58);
              backdrop-filter: blur(4px);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 5px;
              box-sizing: border-box;
            }

            /* ══════════════════════════════════════════════════════
               Custom Microphone Indicator DOM Injection
               Replaces LiveKit's missing "mic on" DOM states
               ══════════════════════════════════════════════════════ */

            /* Completely hide LiveKit's default mic/camera muted indicators */
            .lk-grid-layout-wrapper .lk-track-muted-indicator-microphone,
            .lk-mobile-scroll-grid .lk-track-muted-indicator-microphone,
            .webcam-sidebar-panel .lk-track-muted-indicator-microphone,
            .floating-webcam-panel .lk-track-muted-indicator-microphone,
            .sky-meet-video-wrapper .lk-carousel .lk-track-muted-indicator-microphone,
            .lk-grid-layout-wrapper .lk-track-muted-indicator-camera,
            .lk-mobile-scroll-grid .lk-track-muted-indicator-camera,
            .webcam-sidebar-panel .lk-track-muted-indicator-camera,
            .floating-webcam-panel .lk-track-muted-indicator-camera,
            .sky-meet-video-wrapper .lk-carousel .lk-track-muted-indicator-camera {
              display: none !important;
            }

            /* Mic/cam indicator colors — green active, gray voluntary off, red host-restricted / mute-all */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-muted="false"],
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-muted="false"],
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-muted="false"],
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-muted="false"],
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator[data-kloud-video-disabled="false"],
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator[data-kloud-video-disabled="false"],
            .webcam-sidebar-panel .kloud-custom-cam-indicator[data-kloud-video-disabled="false"],
            .floating-webcam-panel .kloud-custom-cam-indicator[data-kloud-video-disabled="false"],
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator[data-kloud-video-disabled="false"] {
              color: #22c55e !important;
            }

            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-muted="true"]:not([data-kloud-host-restricted="true"]):not([data-kloud-force-muted="true"]),
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-muted="true"]:not([data-kloud-host-restricted="true"]):not([data-kloud-force-muted="true"]),
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-muted="true"]:not([data-kloud-host-restricted="true"]):not([data-kloud-force-muted="true"]),
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-muted="true"]:not([data-kloud-host-restricted="true"]):not([data-kloud-force-muted="true"]),
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator[data-kloud-video-disabled="true"]:not([data-kloud-host-restricted="true"]),
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator[data-kloud-video-disabled="true"]:not([data-kloud-host-restricted="true"]),
            .webcam-sidebar-panel .kloud-custom-cam-indicator[data-kloud-video-disabled="true"]:not([data-kloud-host-restricted="true"]),
            .floating-webcam-panel .kloud-custom-cam-indicator[data-kloud-video-disabled="true"]:not([data-kloud-host-restricted="true"]),
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator[data-kloud-video-disabled="true"]:not([data-kloud-host-restricted="true"]) {
              color: rgba(255, 255, 255, 0.75) !important;
            }

            /* Our custom injected microphone indicator styling */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator,
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator,
            .webcam-sidebar-panel .kloud-custom-mic-indicator,
            .floating-webcam-panel .kloud-custom-mic-indicator,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator {
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
              width: 1.15rem;
              height: 1.15rem;
              flex-shrink: 0;
              transition: all 0.2s ease;
              pointer-events: auto;
            }

            /* 主持强制静音/禁视频：红色 + 脉冲 */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-host-restricted="true"],
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"],
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"],
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"],
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-force-muted="true"],
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-force-muted="true"],
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-force-muted="true"],
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] {
              width: 1.4rem;
              height: 1.4rem;
              color: #ff2020 !important;
              filter: drop-shadow(0 0 5px rgba(255, 32, 32, 0.8));
              animation: kloud-mic-alert-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            }
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg,
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg *,
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg,
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg *,
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg,
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg *,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg *,
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg,
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg *,
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg,
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg *,
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg,
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg *,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg * {
              fill: currentColor !important;
              stroke: currentColor !important;
            }
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.kloud-custom-mic--force-muted,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"],
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] {
              color: #ff2020 !important;
            }
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.kloud-custom-mic--force-muted svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.kloud-custom-mic--force-muted svg *,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg *,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg * {
              fill: currentColor !important;
              stroke: currentColor !important;
            }

            @keyframes kloud-mic-alert-pulse {
              0%, 100% { opacity: 1; transform: scale(1); }
              50% { opacity: 0.7; transform: scale(0.9); }
            }

            /* Host hover interactions */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator.operator-interactive,
            .webcam-sidebar-panel .kloud-custom-mic-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-mic-indicator.operator-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.operator-interactive,
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator.self-interactive,
            .webcam-sidebar-panel .kloud-custom-mic-indicator.self-interactive,
            .floating-webcam-panel .kloud-custom-mic-indicator.self-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.self-interactive {
              cursor: pointer;
              border-radius: 5px;
              padding: 3px;
              min-width: 1.6rem;
              min-height: 1.6rem;
              margin: 0;
            }
            /* SVG inside mic indicator must not steal pointer events */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator svg,
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator svg *,
            .webcam-sidebar-panel .kloud-custom-mic-indicator svg,
            .webcam-sidebar-panel .kloud-custom-mic-indicator svg *,
            .floating-webcam-panel .kloud-custom-mic-indicator svg,
            .floating-webcam-panel .kloud-custom-mic-indicator svg *,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator svg * {
              pointer-events: none;
            }
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator.operator-interactive:hover,
            .webcam-sidebar-panel .kloud-custom-mic-indicator.operator-interactive:hover,
            .floating-webcam-panel .kloud-custom-mic-indicator.operator-interactive:hover,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.operator-interactive:hover,
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator.self-interactive:hover,
            .webcam-sidebar-panel .kloud-custom-mic-indicator.self-interactive:hover,
            .floating-webcam-panel .kloud-custom-mic-indicator.self-interactive:hover,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.self-interactive:hover {
              background: rgba(0, 0, 0, 0.72);
              border-color: rgba(255, 255, 255, 0.22);
              transform: scale(1.05);
            }

            .floating-webcam-panel .kloud-custom-mic-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-mic-indicator.self-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.self-interactive,
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator.operator-interactive,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator.operator-interactive,
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator.self-interactive,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator.self-interactive {
              min-width: 20px;
              min-height: 20px;
              width: 20px;
              height: 20px;
              padding: 3px;
              margin: 0 !important;
              box-sizing: border-box;
            }

            /* Custom injected camera indicator styling */
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator,
            .webcam-sidebar-panel .kloud-custom-cam-indicator,
            .floating-webcam-panel .kloud-custom-cam-indicator,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator {
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
              width: 1.15rem;
              height: 1.15rem;
              flex-shrink: 0;
              transition: all 0.2s ease;
              pointer-events: auto;
            }

            .lk-grid-layout-wrapper .kloud-custom-cam-indicator[data-kloud-host-restricted="true"],
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator[data-kloud-host-restricted="true"],
            .webcam-sidebar-panel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"],
            .floating-webcam-panel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"],
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"],
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled,
            .webcam-sidebar-panel .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled,
            .floating-webcam-panel .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled {
              width: 1.4rem;
              height: 1.4rem;
              color: #ff2020 !important;
              filter: drop-shadow(0 0 5px rgba(255, 32, 32, 0.8));
              animation: kloud-mic-alert-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            }

            .lk-grid-layout-wrapper .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg,
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg *,
            .webcam-sidebar-panel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg,
            .webcam-sidebar-panel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg *,
            .floating-webcam-panel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg,
            .floating-webcam-panel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg *,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg * {
              fill: currentColor !important;
              stroke: currentColor !important;
            }
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] {
              color: #ff2020 !important;
            }
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled svg * {
              fill: currentColor !important;
              stroke: currentColor !important;
            }

            .lk-grid-layout-wrapper .kloud-custom-cam-indicator.operator-interactive,
            .webcam-sidebar-panel .kloud-custom-cam-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.operator-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.operator-interactive,
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator.self-interactive,
            .webcam-sidebar-panel .kloud-custom-cam-indicator.self-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.self-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.self-interactive {
              cursor: pointer;
              border-radius: 5px;
              padding: 3px;
              min-width: 1.6rem;
              min-height: 1.6rem;
              margin: 0;
            }

            .lk-grid-layout-wrapper .kloud-custom-cam-indicator svg,
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator svg *,
            .webcam-sidebar-panel .kloud-custom-cam-indicator svg,
            .webcam-sidebar-panel .kloud-custom-cam-indicator svg *,
            .floating-webcam-panel .kloud-custom-cam-indicator svg,
            .floating-webcam-panel .kloud-custom-cam-indicator svg *,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator svg * {
              pointer-events: none;
            }

            .lk-grid-layout-wrapper .kloud-custom-cam-indicator.operator-interactive:hover,
            .webcam-sidebar-panel .kloud-custom-cam-indicator.operator-interactive:hover,
            .floating-webcam-panel .kloud-custom-cam-indicator.operator-interactive:hover,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.operator-interactive:hover,
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator.self-interactive:hover,
            .webcam-sidebar-panel .kloud-custom-cam-indicator.self-interactive:hover,
            .floating-webcam-panel .kloud-custom-cam-indicator.self-interactive:hover,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.self-interactive:hover {
              background: rgba(0, 0, 0, 0.72);
              border-color: rgba(255, 255, 255, 0.22);
              transform: scale(1.05);
            }

            /* Host/co-host controls stay visible so mute/camera state is never ambiguous. */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator.operator-interactive,
            .webcam-sidebar-panel .kloud-custom-mic-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-mic-indicator.operator-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.operator-interactive,
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator.operator-interactive,
            .webcam-sidebar-panel .kloud-custom-cam-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.operator-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.operator-interactive {
              opacity: 1 !important;
              pointer-events: auto !important;
            }

            /* Self tile: always show own mic/cam controls (click to toggle) */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator.self-interactive,
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator.self-interactive,
            .webcam-sidebar-panel .kloud-custom-mic-indicator.self-interactive,
            .floating-webcam-panel .kloud-custom-mic-indicator.self-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.self-interactive,
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator.self-interactive,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator.self-interactive,
            .webcam-sidebar-panel .kloud-custom-cam-indicator.self-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.self-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.self-interactive {
              opacity: 1 !important;
              pointer-events: auto !important;
            }

            /* Reveal both controls when host/co-host hovers the tile */
            .lk-grid-layout-wrapper .lk-participant-tile:hover .kloud-custom-mic-indicator.operator-interactive,
            .lk-grid-layout-wrapper .lk-participant-tile:hover .kloud-custom-cam-indicator.operator-interactive,
            .webcam-sidebar-panel .lk-participant-tile:hover .kloud-custom-mic-indicator.operator-interactive,
            .webcam-sidebar-panel .lk-participant-tile:hover .kloud-custom-cam-indicator.operator-interactive,
            .floating-webcam-panel .kl-participant-tile:hover .kloud-custom-mic-indicator.operator-interactive,
            .floating-webcam-panel .lk-participant-tile:hover .kloud-custom-cam-indicator.operator-interactive,
            .sky-meet-video-wrapper .lk-carousel .lk-participant-tile:hover .kloud-custom-mic-indicator.operator-interactive,
            .sky-meet-video-wrapper .lk-carousel .lk-participant-tile:hover .kloud-custom-cam-indicator.operator-interactive,
            .lk-grid-layout-wrapper .lk-participant-tile:hover .kloud-custom-mic-indicator.self-interactive,
            .lk-grid-layout-wrapper .lk-participant-tile:hover .kloud-custom-cam-indicator.self-interactive,
            .lk-mobile-scroll-grid .lk-participant-tile:hover .kloud-custom-mic-indicator.operator-interactive,
            .lk-mobile-scroll-grid .lk-participant-tile:hover .kloud-custom-cam-indicator.operator-interactive,
            .lk-mobile-scroll-grid .lk-participant-tile:hover .kloud-custom-mic-indicator.self-interactive,
            .lk-mobile-scroll-grid .lk-participant-tile:hover .kloud-custom-cam-indicator.self-interactive,
            .webcam-sidebar-panel .lk-participant-tile:hover .kloud-custom-mic-indicator.self-interactive,
            .webcam-sidebar-panel .lk-participant-tile:hover .kloud-custom-cam-indicator.self-interactive,
            .floating-webcam-panel .kl-participant-tile:hover .kloud-custom-mic-indicator.self-interactive,
            .floating-webcam-panel .lk-participant-tile:hover .kloud-custom-cam-indicator.self-interactive,
            .sky-meet-video-wrapper .lk-carousel .lk-participant-tile:hover .kloud-custom-mic-indicator.self-interactive,
            .sky-meet-video-wrapper .lk-carousel .lk-participant-tile:hover .kloud-custom-cam-indicator.self-interactive {
              opacity: 1 !important;
              pointer-events: auto !important;
            }

            /* Mobile grid: keep metadata row compact so cam/mic icons match */
            .lk-mobile-scroll-grid .lk-participant-metadata-item {
              display: inline-flex !important;
              align-items: center !important;
              gap: 6px !important;
              max-width: 100% !important;
              min-width: 0 !important;
              padding: 0 !important;
              background: transparent !important;
              line-height: 1 !important;
            }
            /* 手机 webcam 左下角麦/摄像头：略放大，方便手指点击 */
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator {
              width: 1.65rem !important;
              height: 1.65rem !important;
              min-width: 1.65rem !important;
              min-height: 1.65rem !important;
              padding: 4px !important;
              border-radius: 6px !important;
            }
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator.self-interactive,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator.self-interactive,
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator.operator-interactive,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator.operator-interactive {
              min-width: 2rem !important;
              min-height: 2rem !important;
              width: 2rem !important;
              height: 2rem !important;
              padding: 5px !important;
            }
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator svg,
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator svg {
              width: 100% !important;
              height: 100% !important;
              max-width: 1.35rem;
              max-height: 1.35rem;
            }
            .lk-mobile-scroll-grid .lk-participant-metadata-item .kloud-tile-more-menu-wrap--inline .kloud-role-icon-btn {
              width: 2rem !important;
              height: 2rem !important;
              min-width: 2rem !important;
              min-height: 2rem !important;
            }
            .lk-mobile-scroll-grid .lk-participant-metadata-item .kloud-tile-more-menu-wrap--inline .kloud-role-icon-btn svg {
              width: 1.15rem !important;
              height: 1.15rem !important;
            }

            /* Mobile webcam：视频网格停在底部导航栏上方 */
            .kloud-mobile-meeting .main-meeting-area.kloud-mobile-webcam-view {
              bottom: var(--kloud-mobile-toolbar-height);
            }
            /* LiveDoc on phone: keep paging/zoom bar fully above the meeting toolbar */
            .kloud-mobile-meeting .main-meeting-area.kloud-mobile-webcam-view iframe[title="LiveDoc"] {
              max-height: 100%;
            }
            .kloud-mobile-meeting .main-meeting-area.kloud-mobile-webcam-view .lk-mobile-scroll-grid {
              height: 100%;
              max-height: 100%;
            }

            /* Mobile: top-level RoomAudioRenderer plays remote audio; hide duplicates inside hidden video wrapper */
            .kloud-mobile-meeting .sky-meet-video-wrapper audio {
              display: none !important;
            }
          `}</style>
        </div>

        {/* Captions overlay — visible to all participants when host enables captions */}
        {/* 移动端：浏览器拦截远程音频时提示点击开启（Web 端无此层） */}
        {isToolbarMobile && !canPlaybackAudio && room.state === ConnectionState.Connected && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 11900,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.45)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              pointerEvents: 'auto',
            }}
          >
            <button
              type="button"
              onClick={() => {
                room.startAudio()
                  .then(() => setCanPlaybackAudio(true))
                  .catch(() => setCanPlaybackAudio(room.canPlaybackAudio));
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
              <svg viewBox="0 0 24 24" width="56" height="56" fill="none">
                <path
                  d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"
                  fill="white"
                />
              </svg>
              <span style={{ color: '#fff', fontSize: 16, fontWeight: 600, letterSpacing: 0.3 }}>
                {t('toolbar.clickToEnableAudio')}
              </span>
              <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, textAlign: 'center', maxWidth: 260 }}>
                {t('toolbar.clickToHearOthers')}
              </span>
            </button>
          </div>
        )}

        <CaptionsOverlay captionsInfo={captionsInfo} bottomOffset={isToolbarMobile ? 110 : 90} />

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
          onOpenDesktopApp={() => openDesktopEntry('inMeeting')}
          isMutedByHost={isLocalMicRestricted}
          isCamDisabledByHost={isLocalCamRestricted}
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
                localIdentity={room.localParticipant.identity}
                autoPresenterIdentity={autoPresenterIdentity}
                canMuteAll={isHost || isCohost || isCopresenter || isAutoPresenter}
                muteAllActive={muteAllActive}
                onMuteAll={handleMuteAll}
                onUnmuteAll={handleUnmuteAll}
                onMuteParticipant={isHost || isCohost ? handleMuteParticipant : undefined}
                onDisableParticipantVideo={isHost || isCohost ? handleDisableParticipantVideo : undefined}
                hostMutedIdentities={hostMutedIdentities}
                hostDisabledVideoIdentities={hostDisabledVideoIdentities}
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

        {process.env.NODE_ENV === 'development' ? <DebugMode /> : null}
        <RecordingIndicator />
        {desktopLaunchModal}
        <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
        </ParticipantRoleMenuProvider>
      </RoomContext.Provider>
    </div>
  );
}
