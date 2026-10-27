'use client';

import React from 'react';
import toast from 'react-hot-toast';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { JoinRequestsPrompt } from '@/lib/JoinRequestsPrompt';
import { MeetingTimeLimitBanner } from '@/lib/billing/MeetingTimeLimitBanner';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { VideoConferenceErrorBoundary } from '@/lib/VideoConferenceErrorBoundary';
import { KloudConnectionStateToast } from '@/lib/KloudConnectionStateToast';
import { KloudMeetToolbar, ViewMode, WebcamLayoutMode } from '@/lib/KloudMeetToolbar';
import type { LiveDocDesignItem } from '@/lib/LiveDocAiPanel';
import { KloudVideoConference } from '@/lib/KloudVideoConference';
import { HelpModal } from '@/lib/HelpModal';
import {
  createOrUpdateInstantAccount,
  resolveJitsiInstanceId,
  resolveLiveDocEmbedRole,
} from '@/lib/livedoc/client';
import { AnnotationCanvas } from '@/lib/AnnotationCanvas';
import { RemoteControlOverlay, RemoteControlRequest } from '@/lib/RemoteControlOverlay';
import { useCaptions } from '@/lib/RtasrHelper/useCaptions';
import { CaptionsOverlay } from '@/lib/RtasrHelper/CaptionsOverlay';
import { peerStateOf } from '@/lib/RtasrHelper/captionPeers';
import { SpeakWhileMutedPrompt } from '@/lib/SpeakWhileMutedPrompt';
import { useSpeakWhileMutedPrompt } from '@/lib/useSpeakWhileMutedPrompt';
import { useSpeakActivityRecorder } from '@/lib/useSpeakActivityRecorder';
import { SPEAK_TOKEN_PARAM } from '@/lib/recordingSpeakActivity';
import { useMeetingDocumentPip, type MeetingDocumentPipApi } from '@/lib/useMeetingDocumentPip';
import { getDesktopMiniWindow, isMiniWindowEligible, isWebDocumentPipEligible } from '@/lib/documentPipSupport';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { MeetingPipSuggestPrompt } from '@/lib/MeetingPipSuggestPrompt';
import {
  canControlRecording,
  IDLE_RECORDING_STATE,
  RECORDING_STATE_MSG,
  type RecordingMode,
  type RecordingState,
} from '@/lib/recordingControls';
import {
  DEFAULT_GALLERY_PREFS,
  loadGalleryPrefs,
  saveGalleryPrefs,
  type GalleryPrefs,
} from '@/lib/galleryPrefs';
import {
  isToolbarMobileUserAgent,
  postKloudShowFilePanelToIframe,
  postLivedocRoleToIframe,
  setLivedocOtherPresenter,
  useToolbarIsMobile,
} from '@/lib/useToolbarIsMobile';
import { unlockMobileRoomAudio } from '@/lib/mobileAudioUnlock';
import { ConnectionDetails } from '@/lib/types';
import { parseMeetingRoomView } from '@/lib/meetingRoomViewShared';
import { persistMeetingRoomView } from '@/lib/meetingRoomViewClient';
import { persistParticipantLiveDocAi } from '@/lib/participantLiveDocAi';
import { useI18n } from '@/lib/i18n';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  RoomContext,
  useTracks,
  RoomAudioRenderer,
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
  Track,
  DefaultReconnectPolicy,
} from 'livekit-client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';
import {
  AttendeePanel,
} from '@/lib/ChatAndAttendeePanel';
import { useLivedocRecordingBridge } from '@/lib/useLivedocRecordingBridge';
import {
  ParticipantRoleMenuProvider,
  type ParticipantRoleActionsConfig,
} from '@/lib/ParticipantRoleMenu';
import { useDesktopAppLaunch } from '@/lib/useDesktopAppLaunch';
import {
  type KloudTileMediaRestrictionProps,
  KloudMobileRoomAudioRenderer,
  LiveDocWebcamSidebarTile,
  MobileVideoLayout,
  parseKloudMemberIdFromMetadata,
} from './roomVideoLayouts';
import { isDbMeetingOwner } from '@/lib/meetingOwner';
import {
  normalizeCaptureDeviceId,
  patchStoredUserMediaChoices,
} from '@/lib/userMediaChoices';
import { authHeaders } from '@/lib/kloudSession';

const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';
import { loadAudioOutputDeviceId } from '@/lib/audioOutputChoice';
import { DesignStage } from '@/lib/DesignStage';
import { DesignLinkDialog } from '@/lib/DesignLinkDialog';
import {
  DESIGN_ALLOW_LOCAL_HTTP,
  designKindKey,
  parseDesignLink,
  parseStoredDesignLink,
  type DesignLink,
  type StoredDesignLink,
} from '@/lib/designLink';
import { checkDesignLinkEmbed, persistMeetingDesignLink, rememberDesignLink } from '@/lib/designLinkClient';
import type { DesignEmbedCheck } from '@/lib/designEmbed';
import { DESIGN_TOPIC, parseDesignSyncMessage } from '@/lib/designSync';
import { useDesignSync, type DesignSyncTransport } from '@/lib/useDesignSync';
import { LiveDocView } from '@/lib/LiveDocView';
import {
  AUTO_LOWER_HAND_MS,
  E2EE_UNSUPPORTED,
  HAND_TOAST_MERGE_MS,
  HOST_MIC_LOCK_MS,
  LIVEKIT_RECONNECT_DELAYS_MS,
  MAX_LOCK_TIMEOUT_MS,
  SCREEN_SHARE_CAPTURE,
} from './roomConstants';
import { MeetingReadyModal, RecordConsentModal } from './roomModals';
import {
  ConnectErrorOverlay,
  DuplicateSessionOverlay,
  HostEndedOverlay,
  RecorderPausedSlate,
  RecordingSaveOverlay,
  RemoteControlApprovalDialog,
  RemovedFromMeetingOverlay,
  ShareTakeoverDialog,
} from './roomOverlays';
import { useInlineVideoElements } from './useInlineVideoElements';
import { useMeetingAudioKeepAlive } from './useMeetingAudioKeepAlive';
import { useMicWatchdog } from './useMicWatchdog';
import { useTileIndicators, useTileNameSync } from './useTileIndicators';
import { useMeetingConnection } from './useMeetingConnection';
import { useLiveDocSession } from './useLiveDocSession';
import { useMeetingChat } from './useMeetingChat';
import '@/styles/roomStage.css';
import '@/styles/floatingTiles.css';

export function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  /** DB `Meeting.createdByMemberId` — when set, that member (via token metadata) stays in-room host after reconnect. */
  meetingOwnerMemberId?: string | null;
  /** Shown on the left of the control bar; falls back to the room code. */
  meetingTitle?: string;
  region?: string;
  options: {
    hq: boolean;
    codec: VideoCodec;
  };
}) {
  const { openDesktopEntry, desktopLaunchModal } = useDesktopAppLaunch();
  const { t } = useI18n();
  const tRef = React.useRef(t);
  tRef.current = t;
  const router = useRouter();
  const searchParams = useSearchParams();
  const keyProvider = React.useMemo(() => new ExternalE2EEKeyProvider(), []);
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);
  const isRecorderBot = searchParams?.get('isBot') === 'true';

  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);
  // Late joiners: connectionDetails.currentView from LiveKit room metadata.
  // Host first open: no metadata → webcam (product default unchanged).
  const [activeView, setActiveView] = React.useState<ViewMode>(
    () => parseMeetingRoomView(props.connectionDetails.currentView) ?? 'webcam',
  );
  const activeViewRef = React.useRef<ViewMode>(activeView);
  activeViewRef.current = activeView;
  /** The view the host / presenter set for the room (attendees may look at another one locally) */
  const roomViewRef = React.useRef<ViewMode>(activeView);
  /** An attendee picked their own view; it lasts until the host switches the room again */
  const localViewChoiceRef = React.useRef(false);
  /** Design mode: the link everyone views (late joiners get it from room metadata). */
  const [designStored, setDesignStored] = React.useState<StoredDesignLink | null>(() =>
    parseStoredDesignLink(props.connectionDetails.designLink),
  );
  const [designDialogOpen, setDesignDialogOpen] = React.useState(false);
  /** Rebuilt locally from the URL: never trust another participant's embed address */
  const designLink: DesignLink | null = React.useMemo(() => {
    if (!designStored || typeof window === 'undefined') return null;
    const parsed = parseDesignLink(designStored.url, {
      appOrigin: window.location.origin,
      allowLocalHttp: DESIGN_ALLOW_LOCAL_HTTP,
    });
    return parsed.ok ? parsed.link : null;
  }, [designStored]);
  /** Last non-share room mode (webcam | liveDoc). Used when leaving shareScreen / takeover. */
  const lastStableRoomViewRef = React.useRef<ViewMode>(
    activeView === 'shareScreen' ? 'webcam' : activeView,
  );
  // Design isn't recorded here: stopping Design returns to the video or LiveDoc view before it
  if (activeView === 'webcam' || activeView === 'liveDoc') {
    lastStableRoomViewRef.current = activeView;
  }
  /**
   * Local sharer session only: remembers view before THIS client started sharing.
   * Non-null ⇒ we own restore+broadcast when share ends.
   */
  const localShareViewSessionRef = React.useRef<{ previousView: ViewMode } | null>(null);
  const [webcamLayoutMode, setWebcamLayoutMode] = React.useState<WebcamLayoutMode>('tile');
  // Each viewer's own gallery settings (tiles per page, video first, hide without video)
  const [galleryPrefs, setGalleryPrefs] = React.useState<GalleryPrefs>(DEFAULT_GALLERY_PREFS);
  React.useEffect(() => setGalleryPrefs(loadGalleryPrefs()), []);
  const handleGalleryPrefsChange = React.useCallback((next: GalleryPrefs) => {
    setGalleryPrefs(next);
    saveGalleryPrefs(next);
  }, []);
  const [micEnabled, setMicEnabled] = React.useState(props.userChoices.audioEnabled);
  /**
   * 用户当前“想不想开麦/开摄像头”。重连恢复与麦克风保活以此为准，
   * 不能用 props.userChoices（那只是准备页的初始选择）。
   * 麦意图不跟 TrackMuted：重连卸轨不能改成“不想开麦”。
   */
  const desiredMicRef = React.useRef(props.userChoices.audioEnabled);
  const desiredCamRef = React.useRef(props.userChoices.videoEnabled);
  // Stores the mic state BEFORE a MUTE_ALL command arrived, so UNMUTE_ALL can restore it.
  const preMuteAllMicRef = React.useRef<boolean | null>(null);
  const [camEnabled, setCamEnabled] = React.useState(props.userChoices.videoEnabled);
  const [screenShareActive, setScreenShareActive] = React.useState(false);
  const [isWebcamSidebarCollapsed, setIsWebcamSidebarCollapsed] = React.useState(false);
  const [isDrawingMode, setIsDrawingMode] = React.useState(false);
  const localMicRestrictedRef = React.useRef(false);
  /** 解除本人禁麦标记；handleToggleMic 定义在 sendMeetingMsg 之前，故用 ref 桥接 */
  const clearOwnMicRestrictionRef = React.useRef<(() => void) | null>(null);
  const localCamRestrictedRef = React.useRef(false);
  const [isRemoteControlMode, setIsRemoteControlMode] = React.useState(false);
  // Remote control permission flow
  const [remoteControlPending, setRemoteControlPending] = React.useState(false);
  const [remoteControlRequest, setRemoteControlRequest] = React.useState<RemoteControlRequest | null>(null);
  const [approvedControllerIdentity, setApprovedControllerIdentity] = React.useState<string | null>(null);
  const approvedControllerIdentityRef = React.useRef<string | null>(null);
  approvedControllerIdentityRef.current = approvedControllerIdentity;
  const [screenShareSurface, setScreenShareSurface] = React.useState<
    'monitor' | 'window' | 'browser' | 'current-tab' | 'unknown'
  >('unknown');
  // Only activate mirror-block AFTER surface detection completes (avoids overlay flash)
  const [surfaceDetected, setSurfaceDetected] = React.useState(false);
  const isDesktop = useIsDesktop();
  const isToolbarMobile = useToolbarIsMobile();
  /** Desktop web: clock | name | mode bar above the stage (phones keep their own header). */
  // 微信/手机内置浏览器无法自动播放时，显示「点击播放」覆盖层
  const [needsPlayTap, setNeedsPlayTap] = React.useState(false);
  const [canPlaybackAudio, setCanPlaybackAudio] = React.useState(() =>
    typeof window !== 'undefined' ? !isToolbarMobileUserAgent() : true,
  );

  const [showMeetingReadyModal, setShowMeetingReadyModal] = React.useState(false);
  // Recording state everyone in the meeting shares (server is the source of truth; whoever
  // changes it broadcasts RECORDING_STATE). Before, only the person recording knew.
  const [recordingState, setRecordingState] = React.useState<RecordingState>(IDLE_RECORDING_STATE);
  const isRecording = recordingState.active;
  const setIsRecording = React.useCallback(
    (on: boolean) => setRecordingState((s) => ({ ...s, active: on, paused: on ? s.paused : false })),
    [],
  );
  /** True on the client that started the recording: leaving from here stops it, as before. */
  const startedRecordingHereRef = React.useRef(false);
  const broadcastRecordingStateRef = React.useRef<(state: RecordingState) => void>(() => {});
  const applyRecordingState = React.useCallback((state: RecordingState | undefined | null, broadcast: boolean) => {
    if (!state) return;
    setRecordingState(state);
    if (broadcast) broadcastRecordingStateRef.current(state);
  }, []);
  useLivedocRecordingBridge({
    state: recordingState,
    startedHereRef: startedRecordingHereRef,
    screenShareOn: activeView === 'shareScreen',
  });
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

      // LiveDoc Full Recording: Kloud starts / ends its recording with this user's LiveDoc login
      // (the server records LiveDoc Full whenever the meeting has its LiveDoc).
      const livedocToken = await createOrUpdateInstantAccount(props.userChoices.username).catch(() => null);

      const res = await fetch(`/api/meetings/${roomSeg}/record`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action, pageUrl: pageUrlStr, mode: recordingState.mode, livedocToken }),
      });

      const data = await res.json();
      if (res.ok) {
        startedRecordingHereRef.current = action === 'start';
        applyRecordingState(data.state, true);
      }
      if (!res.ok) {
        setIsRecording(action === 'stop'); // revert
        const toastEl = document.createElement('div');
        // Billing: plan limit reached (402 BILLING_LIMIT) — explain why instead of a raw error.
        toastEl.textContent =
          data?.code === 'BILLING_LIMIT'
            ? t('billing.limit.recording')
            : data?.code === 'RECORDING_NOT_ALLOWED'
              ? t('toolbar.recordingNotAllowed')
              : `${t('toolbar.recordingFailed') || 'Recording failed'}: ${data.error}`;
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

  /** Pause / resume and recording settings: ask the server, then tell everyone. */
  const recordingRequest = React.useCallback(
    async (body: { action: 'pause' | 'resume' } | { action: 'settings'; mode?: RecordingMode; hostOnly?: boolean; syncTranscript?: boolean }) => {
      const roomSeg = window.location.pathname.split('/').filter(Boolean).pop();
      const showError = (text: string) => {
        const toastEl = document.createElement('div');
        toastEl.textContent = text;
        toastEl.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(239,68,68,0.95);color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:99999;pointer-events:none;max-width:80vw;text-align:center;';
        document.body.appendChild(toastEl);
        setTimeout(() => toastEl.remove(), 3500);
      };
      try {
        const res = await fetch(`/api/meetings/${roomSeg}/record`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showError(
            data?.code === 'MODE_NEEDS_RESTART'
              ? t('toolbar.recordingModeNeedsRestart')
              : data?.code === 'RECORDING_NOT_ALLOWED'
                ? t('toolbar.recordingNotAllowed')
                : `${t('toolbar.recordingFailed') || 'Recording failed'}: ${data?.error ?? res.status}`,
          );
          return;
        }
        applyRecordingState(data.state, true);
      } catch {
        showError(t('toolbar.recordNetworkError') || 'Network error while toggling recording');
      }
    },
    [applyRecordingState, t],
  );

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
      deviceId: normalizeCaptureDeviceId(props.userChoices.videoDeviceId),
      resolution: useHq
        ? VideoPresets.h2160
        : isMobileClient
          ? VideoPresets.h360
          : VideoPresets.h720,
      ...(isMobileClient && !normalizeCaptureDeviceId(props.userChoices.videoDeviceId)
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
        deviceId: normalizeCaptureDeviceId(props.userChoices.audioDeviceId),
      },
      audioOutput: { deviceId: loadAudioOutputDeviceId() },
      adaptiveStream: true,
      dynacast: true,
      // 手机切后台常见 pagehide/freeze；不断连，靠现有 visibility 恢复音频
      disconnectOnPageLeave: !isMobileClient,
      e2ee: keyProvider && worker && e2eeEnabled ? { keyProvider, worker } : undefined,
      reconnectPolicy: new DefaultReconnectPolicy(LIVEKIT_RECONNECT_DELAYS_MS),
      // 单 PC 模式在断网后 full reconnect 重新发布麦克风时易出现对方听不到，沿用双 PC
      singlePeerConnection: false,
    };
  }, [props.userChoices, props.options.hq, props.options.codec, e2eeEnabled, keyProvider, worker]);

  const room = React.useMemo(() => new Room(roomOptions), [roomOptions]);

  // 以「有没有共享发布」为准，而不是当前这一帧有没有媒体轨。
  // adaptiveStream 会在画面被挡住时暂停订阅，若据此退出共享视图，视频元素被卸掉后订阅就不再恢复。
  const screenShareTracks = useTracks([Track.Source.ScreenShare], { room, onlySubscribed: false });
  const hasScreenShare = screenShareTracks.length > 0;

  // LiveDoc Full: the page that started the recording reports each screen share that starts, so it is
  // recorded even when LiveKit's webhook doesn't reach the server.
  const screenSids = screenShareTracks.map((ref) => ref.publication?.trackSid ?? '').filter(Boolean).join(',');
  const reportedSidsRef = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!recordingState.active || recordingState.option !== 'livedoc_full' || !startedRecordingHereRef.current) return;
    const fresh = screenSids.split(',').filter((sid) => sid && !reportedSidsRef.current.has(sid));
    if (fresh.length === 0) return;
    fresh.forEach((sid) => reportedSidsRef.current.add(sid));
    const roomSeg = window.location.pathname.split('/').filter(Boolean).pop();
    void fetch(`/api/meetings/${roomSeg}/record`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'screen' }),
    }).catch(() => fresh.forEach((sid) => reportedSidsRef.current.delete(sid)));
  }, [screenSids, recordingState.active, recordingState.option]);
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

  // Ref for broadcast function (defined later in DataChannel sync block)
  const broadcastViewChangeRef = React.useRef<((view: ViewMode) => void) | null>(null);
  // Only host / co-host / presenter roles may broadcast view changes to the room
  const canBroadcastViewChangeRef = React.useRef(false);
  /** Skip repeat POST /api/meetings/.../view when mode unchanged */
  const lastPersistedRoomViewRef = React.useRef<ViewMode | null>(null);

  /**
   * Sharer starts sharing:
   * - remember previous room mode (never capture shareScreen — use lastStable)
   * - stay on Screen share locally (the stage shows a "you're sharing" card, not the picture)
   * - broadcast shareScreen for everyone else
   */
  const beginLocalScreenShareView = React.useCallback(() => {
    if (!localShareViewSessionRef.current) {
      const current = activeViewRef.current;
      const previousView =
        current === 'webcam' || current === 'liveDoc' || current === 'design'
          ? current
          : lastStableRoomViewRef.current;
      localShareViewSessionRef.current = { previousView };
      broadcastViewChangeRef.current?.('shareScreen');
    }
    setActiveView('shareScreen');
  }, []);

  /** Sharer stops: restore + broadcast. null if we were not the sharer. */
  const endLocalScreenShareView = React.useCallback((): ViewMode | null => {
    const session = localShareViewSessionRef.current;
    if (!session) return null;
    localShareViewSessionRef.current = null;
    broadcastViewChangeRef.current?.(session.previousView);
    return session.previousView;
  }, []);

  // Screen-share ↔ view-mode sync
  React.useEffect(() => {
    if (hasScreenShare) {
      if (isLocalScreenShare) {
        setSurfaceDetected(false);
        const surfaceTimer = window.setTimeout(() => {
          const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
          if (pub && pub.track) {
            const nativeStr = pub.track.mediaStreamTrack;
            if (nativeStr) {
              const settings = nativeStr.getSettings();
              const raw = settings.displaySurface;
              let surf: 'monitor' | 'window' | 'browser' | 'current-tab' | 'unknown' =
                raw === 'monitor' || raw === 'window' || raw === 'browser' ? raw : 'unknown';
              const withHandle = nativeStr as MediaStreamTrack & {
                getCaptureHandle?: () => { handle?: string } | null;
              };
              if (withHandle.getCaptureHandle) {
                const handle = withHandle.getCaptureHandle();
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
        beginLocalScreenShareView();
        return () => window.clearTimeout(surfaceTimer);
      } else {
        setScreenShareSurface('unknown');
        setSurfaceDetected(false);
        setActiveView('shareScreen');
      }
      return;
    }

    setScreenShareActive(false);
    setIsDrawingMode(false);
    setIsRemoteControlMode(false);
    setScreenShareSurface('unknown');
    setSurfaceDetected(false);
    setActiveView((prev) => {
      // Only skip end while disconnected / reconnecting AND a restore will run afterwards
      // (restoreScreenShareAfterReconnect ends the session itself if restore fails).
      if (
        localShareViewSessionRef.current &&
        screenShareRestorePendingRef.current &&
        (reconnectInFlightRef.current || room.state !== ConnectionState.Connected)
      ) {
        return prev;
      }

      // We were the sharer → restore + broadcast
      const restored = endLocalScreenShareView();
      if (restored) return restored;

      // Viewer: leave shareScreen locally. Only the sharer broadcasts restore
      // (avoids late-joining privileged clients overwriting the sharer's VIEW_CHANGE).
      if (prev === 'shareScreen') {
        return lastStableRoomViewRef.current;
      }
      return prev;
    });
  }, [
    hasScreenShare,
    isLocalScreenShare,
    room.localParticipant,
    beginLocalScreenShareView,
    endLocalScreenShareView,
  ]);

  const handleViewChange = React.useCallback(
    (view: ViewMode) => {
      if (view !== 'shareScreen') {
        setIsDrawingMode(false);
        setIsRemoteControlMode(false);
        if (screenShareActive && view !== 'liveDoc') {
          setScreenShareActive(false);
          // User chose a new mode — do not restore the pre-share mode on track end
          localShareViewSessionRef.current = null;
          room.localParticipant.setScreenShareEnabled(false).catch(console.error);
        }
      }
      setActiveView(view);
      if (canBroadcastViewChangeRef.current) {
        roomViewRef.current = view;
        localViewChoiceRef.current = false;
        broadcastViewChangeRef.current?.(view);
      } else {
        // Attendees only change their own screen
        localViewChoiceRef.current = view !== roomViewRef.current;
      }
    },
    [screenShareActive, room],
  );

  const connectOptions = React.useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  const {
    connectError,
    setConnectError,
    meetingEndedByHost,
    evictedByDuplicateSession,
    removedFromMeeting,
    reconnectInFlightRef,
    connectionDetailsRef,
    screenShareRestorePendingRef,
    hostEndedHandledRef,
    intentionalDisconnectRef,
    duplicateSessionHandledRef,
    setEvictedByDuplicateSession,
    hostEndedRedirectTimerRef,
    markIntentionalDisconnect,
    clearActiveKloudRoom,
    handleClosedByHostExit,
    handleRemovedFromMeeting,
    rejoinAfterDuplicateSession,
    rejoinManually,
    handleError,
    showScreenShareFailureToast,
  } = useMeetingConnection({
    room,
    e2eeSetupComplete,
    connectOptions,
    connectionDetails: props.connectionDetails,
    region: props.region,
    username: props.userChoices.username,
    videoDeviceId: props.userChoices.videoDeviceId,
    audioDeviceId: props.userChoices.audioDeviceId,
    meetingOwnerMemberId: props.meetingOwnerMemberId,
    desiredMicRef,
    desiredCamRef,
    localMicRestrictedRef,
    localCamRestrictedRef,
    beginLocalScreenShareView,
    endLocalScreenShareView,
    setActiveView,
    setScreenShareActive,
    setMicEnabled,
    setCanPlaybackAudio,
    setShowMeetingReadyModal,
  });
  const takeoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lowPowerMode = useLowCPUOptimizer(room);

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
            setConnectError(E2EE_UNSUPPORTED);
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

  useMicWatchdog({
    room,
    desiredMicRef,
    localMicRestrictedRef,
    reconnectInFlightRef,
    setMicEnabled,
  });

  React.useEffect(() => {
    if (lowPowerMode) {
      console.warn('Low power mode enabled');
    }
  }, [lowPowerMode]);

  useMeetingAudioKeepAlive(room, setCanPlaybackAudio);

  useInlineVideoElements();

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
    // 被主持人静音后本人仍可自行开麦：开麦的同时解除自己的禁麦标记，
    // 否则红色禁麦角标会与实际发声状态不符，且会被 enforceHostMute 立刻重新静音。
    if (next && localMicRestrictedRef.current) {
      clearOwnMicRestrictionRef.current?.();
    }
    setMicEnabled(next);
    desiredMicRef.current = next;
    void room.localParticipant
      .setMicrophoneEnabled(next)
      .then(() => {
        patchStoredUserMediaChoices({ audioEnabled: next });
      })
      .catch((error: Error) => {
        setMicEnabled(!next);
        desiredMicRef.current = !next;
        handleError(error);
      });
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
    desiredCamRef.current = next;
    void room.localParticipant
      .setCameraEnabled(next)
      .then(() => {
        patchStoredUserMediaChoices({ videoEnabled: next });
      })
      .catch((error: Error) => {
        setCamEnabled(!next);
        desiredCamRef.current = !next;
        handleError(error);
      });
  }, [canUseRealtimeMediaControls, camEnabled, room, handleError, showMediaUnavailableToast]);

  // LiveKit 轨道才是会中开关状态的事实来源，避免工具栏与用户列表各自维护后失步。
  React.useEffect(() => {
    const syncLocalMediaState = () => {
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      setMicEnabled(Boolean(micPub?.track && !micPub.isMuted));
      setCamEnabled(Boolean(camPub?.track && !camPub.isMuted));
    };

    room.on(RoomEvent.LocalTrackPublished, syncLocalMediaState);
    room.on(RoomEvent.LocalTrackUnpublished, syncLocalMediaState);
    room.on(RoomEvent.TrackMuted, syncLocalMediaState);
    room.on(RoomEvent.TrackUnmuted, syncLocalMediaState);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, syncLocalMediaState);
      room.off(RoomEvent.LocalTrackUnpublished, syncLocalMediaState);
      room.off(RoomEvent.TrackMuted, syncLocalMediaState);
      room.off(RoomEvent.TrackUnmuted, syncLocalMediaState);
    };
  }, [room]);

  // 仅一人且 10 分钟无人加入 → 自动关麦/摄像头（不写入用户偏好）
  React.useEffect(() => {
    const ALONE_AUTO_MUTE_MS = 10 * 60 * 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearAloneTimer = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    };

    const muteLocalMediaIfAlone = () => {
      timer = null;
      if (room.remoteParticipants.size > 0) return;

      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const micLive = Boolean(micPub?.track && !micPub.isMuted);
      const camLive = Boolean(camPub?.track && !camPub.isMuted);

      if (micLive) {
        desiredMicRef.current = false;
        setMicEnabled(false);
        room.localParticipant.setMicrophoneEnabled(false).catch(handleError);
      }
      if (camLive) {
        desiredCamRef.current = false;
        setCamEnabled(false);
        room.localParticipant.setCameraEnabled(false).catch(handleError);
      }
    };

    const scheduleAloneAutoMute = () => {
      clearAloneTimer();
      if (room.remoteParticipants.size > 0) return;
      timer = setTimeout(muteLocalMediaIfAlone, ALONE_AUTO_MUTE_MS);
    };

    scheduleAloneAutoMute();
    room.on(RoomEvent.Connected, scheduleAloneAutoMute);
    room.on(RoomEvent.ParticipantConnected, scheduleAloneAutoMute);
    room.on(RoomEvent.ParticipantDisconnected, scheduleAloneAutoMute);

    return () => {
      clearAloneTimer();
      room.off(RoomEvent.Connected, scheduleAloneAutoMute);
      room.off(RoomEvent.ParticipantConnected, scheduleAloneAutoMute);
      room.off(RoomEvent.ParticipantDisconnected, scheduleAloneAutoMute);
    };
  }, [room, handleError]);

  /** documentPip 在本回调之后才创建，用 ref 转接 */
  const documentPipOpenRef = React.useRef<MeetingDocumentPipApi['open'] | null>(null);

  const handleShareScreen = React.useCallback(() => {
    // Mobile browsers can't do screen share — show a warning toast
    if (isToolbarMobile) {
      const toastEl = document.createElement('div');
      toastEl.textContent = t('toolbar.mobileShareUnsupported');
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
    if (!next) {
      screenShareRestorePendingRef.current = false;
    }

    if (next) {
      beginLocalScreenShareView();
    }

    room.localParticipant
      .setScreenShareEnabled(next, next ? SCREEN_SHARE_CAPTURE : undefined)
      .catch((e: unknown) => {
      setScreenShareActive(false);
      screenShareRestorePendingRef.current = false;
      if (next) {
        const restored = endLocalScreenShareView();
        if (restored) setActiveView(restored);
        showScreenShareFailureToast(e);
      }
      console.error(e);
    });

    // 开启共享时按底部画中画按钮的方式打开。
    // requestWindow 与 getDisplayMedia 争用同一次用户手势，抢不到就静默放弃，
    // 仍可由工具栏按钮或切走标签页时自动打开。
    if (next) {
      void documentPipOpenRef.current?.({ sticky: true });
    }
  }, [
    screenShareActive,
    room,
    hasScreenShare,
    isToolbarMobile,
    beginLocalScreenShareView,
    endLocalScreenShareView,
    showScreenShareFailureToast,
    t,
  ]);

  /**
   * Toolbar Screen share segment. While you share and have stepped over to LiveDoc, it brings you
   * back to the "you're sharing" view; from that view it stops the share (as before).
   */
  const handleShareSegment = React.useCallback(() => {
    if (screenShareActive && activeViewRef.current !== 'shareScreen') {
      setActiveView('shareScreen');
      return;
    }
    handleShareScreen();
  }, [screenShareActive, handleShareScreen]);

  // Leave: just disconnect without ending the meeting for everyone
  const handleLeave = React.useCallback(() => {
    screenShareRestorePendingRef.current = false;
    markIntentionalDisconnect();
    clearActiveKloudRoom();
    room.disconnect();
    router.push('/');
  }, [markIntentionalDisconnect, clearActiveKloudRoom, room, router]);

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
      if (!isRecording || !startedRecordingHereRef.current) {
        afterFn();
        return;
      }
      startedRecordingHereRef.current = false;
      broadcastRecordingStateRef.current({ ...recordingState, active: false, paused: false });

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
    [isRecording, recordingState],
  );

  // Wrapped leave: stop recording then leave
  const handleLeaveWithSave = React.useCallback(() => {
    stopRecordingAndThen(() => {
      markIntentionalDisconnect();
      clearActiveKloudRoom();
      room.disconnect();
      router.push('/');
    });
  }, [stopRecordingAndThen, markIntentionalDisconnect, clearActiveKloudRoom, room, router]);

  // ── Mute All / Unmute All ──
  // Track whether mute-all is active so the button can show the right state.
  // 全体静音持久生效：期间参会者无法自行开麦，直到主持人点「解除全体静音」。
  const [muteAllActive, setMuteAllActive] = React.useState(false);

  const isPresenterScreencast = screenShareActive;
  const isPureLiveDoc = activeView === 'liveDoc';
  // Mirror-blocked: presenter is sharing AND surface detected AND it's NOT a safe "browser tab" share
  const isMirrorBlocked = screenShareActive && surfaceDetected && screenShareSurface !== 'browser';
  // Own share of a screen or window (or not known yet): the stage shows a card instead of the
  // picture, which would repeat inside itself. Sharing another browser tab can still be previewed.
  const ownShareHidden = screenShareActive && (!surfaceDetected || screenShareSurface !== 'browser');

  // Determine host: override (from transfer) takes precedence over join-time computation
  const [hostIdentityOverride, setHostIdentityOverride] = React.useState<string | null>(null);
  // 勿默认成本人：否则参会者首帧 isHost=true，操作者按钮闪一下再消失
  const [hostIdentityFromJoin, setHostIdentityFromJoin] = React.useState<string>('');

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

      // 未连上时 remote 列表可能仍空，不能用「房间里只有我」把晚进的人判成 host
      if (room.state !== ConnectionState.Connected) {
        return;
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
  const isHost = Boolean(hostIdentity) && hostIdentity === room.localParticipant.identity;
  const hostIdentityRef = React.useRef(hostIdentity);
  hostIdentityRef.current = hostIdentity;
  const [participantLiveDocAi, setParticipantLiveDocAi] = React.useState(
    () => props.connectionDetails.participantLiveDocAi !== false,
  );
  const [copresenterIdentities, setCopresenterIdentities] = React.useState<string[]>([]);
  const isCopresenter = copresenterIdentities.includes(room.localParticipant.identity);
  const [cohostIdentities, setCohostIdentities] = React.useState<string[]>([]);
  const [hostMutedIdentities, setHostMutedIdentities] = React.useState<string[]>([]);
  const [hostMutedUntilByIdentity, setHostMutedUntilByIdentity] = React.useState<Record<string, number>>({});
  const [muteAllLockUntil, setMuteAllLockUntil] = React.useState<number | null>(null);
  const [hostDisabledVideoIdentities, setHostDisabledVideoIdentities] = React.useState<string[]>([]);
  const [hostDisabledVideoUntilByIdentity, setHostDisabledVideoUntilByIdentity] = React.useState<Record<string, number>>({});
  const [exemptFromMuteAllIdentities, setExemptFromMuteAllIdentities] = React.useState<string[]>([]);
  // 举手：handRaised 是本地用户自己的权威状态（心跳上报的数据源），
  // raisedHands 是主持人下发的全房间举手队列镜像（驱动 tile 角标与参会者面板）。
  const [handRaised, setHandRaised] = React.useState(false);
  const [raisedHands, setRaisedHands] = React.useState<string[]>([]);
  const handRaisedRef = React.useRef(false);
  const handRaisedAtRef = React.useRef<number | null>(null);
  const raisedHandsRef = React.useRef<string[]>([]);
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
    handRaisedRef.current = handRaised;
    if (!handRaised) handRaisedAtRef.current = null;
  }, [handRaised]);

  React.useEffect(() => {
    raisedHandsRef.current = raisedHands;
    updateCustomMicsRef.current?.();
  }, [raisedHands]);

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
    const delay = Math.max(0, nextExpiry - Date.now()) + 50;
    // 永久锁不排定时器：既没有到期可言，超长延迟还会让 setTimeout 溢出成立即触发
    if (delay > MAX_LOCK_TIMEOUT_MS) return;
    const timeout = window.setTimeout(refreshTimedMicLocks, delay);
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

  /** Another participant is presenting: the LiveDoc plugin then syncs their pointer / zoom, not the host's */
  const otherPresenterActive = [...copresenterIdentities, autoPresenterIdentity].some(
    (id) => !!id && id !== room.localParticipant.identity,
  );
  React.useEffect(() => {
    setLivedocOtherPresenter(otherPresenterActive);
  }, [otherPresenterActive]);

  const localIdentity = room.localParticipant.identity;
  const isLocalMicRestricted =
    !isLocalControlOperator &&
    (hostMutedIdentities.includes(localIdentity) ||
      (muteAllActive && !exemptFromMuteAllIdentities.includes(localIdentity)));
  const isLocalCamRestricted =
    !isLocalControlOperator && hostDisabledVideoIdentities.includes(localIdentity);
  // Only host / co-host / presenter may switch views; they sync the room for everyone else
  const canSwitchViews = isHost || isCohost || isCopresenter || isAutoPresenter;
  const canBroadcastViewChange = canSwitchViews;
  canBroadcastViewChangeRef.current = canBroadcastViewChange;

  /** Design mode messages count only from people who may switch the stage */
  const designSenderAllowedRef = React.useRef<(identity: string) => boolean>(() => false);
  designSenderAllowedRef.current = (identity: string) =>
    identity === hostIdentity ||
    cohostIdentities.includes(identity) ||
    copresenterIdentities.includes(identity) ||
    identity === autoPresenterIdentity;
  /** Whoever opened the link drives size and zoom; the host takes over if they left */
  const designSetBy = designStored?.setBy ?? null;
  const designOpenerPresent =
    !!designSetBy && (designSetBy === localIdentity || room.remoteParticipants.has(designSetBy));
  const isDesignDriver =
    canSwitchViews && (designSetBy === localIdentity || (!designOpenerPresent && isHost));

  React.useEffect(() => {
    localMicRestrictedRef.current = isLocalMicRestricted;

    const enforceHostMute = () => {
      if (!localMicRestrictedRef.current) return;
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const micIsLive = !!micPub?.track && !micPub.isMuted;
      if (micEnabled || micIsLive) {
        desiredMicRef.current = false;
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

  const acceptsKnocks = props.connectionDetails.accessLevel === 'PROTECTED';
  const joinRequestsRefreshRef = React.useRef<(() => void) | null>(null);
  const meetingRoomName = props.connectionDetails.roomName;
  const jitsiInstanceId = resolveJitsiInstanceId({
    roomName: meetingRoomName,
    meetingId: props.connectionDetails.meetingId,
    isPersonalRoom: props.connectionDetails.isPersonalRoom,
  });
  const [livedocInstanceId, setLivedocInstanceId] = React.useState<string | null>(
    () => props.connectionDetails.livedocInstanceId ?? null,
  );
  const [livedocInitError, setLivedocInitError] = React.useState<string | null>(null);
  const [livedocInitInProgress, setLivedocInitInProgress] = React.useState(false);
  const shouldDisplayLiveDoc = isPureLiveDoc && (!hasScreenShare || isLocalScreenShare);
  /** Design mode shows the shared link; a screen share still takes the stage first */
  const shouldDisplayDesign = activeView === 'design' && !!designLink && (!hasScreenShare || isLocalScreenShare);
  /** Design mode sync (size, zoom, page, scroll, drawings, laser) on its own data topic */
  const designTransport = React.useMemo<DesignSyncTransport>(() => {
    const designEncoder = new TextEncoder();
    const designDecoder = new TextDecoder();
    return {
      send(msg, opts) {
        if (room.state !== ConnectionState.Connected) return;
        room.localParticipant
          .publishData(designEncoder.encode(JSON.stringify(msg)), {
            reliable: !opts?.lossy,
            topic: DESIGN_TOPIC,
            ...(opts?.to ? { destinationIdentities: [opts.to] } : {}),
          })
          .catch(() => {});
      },
      subscribe(handler) {
        const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
          if (topic !== DESIGN_TOPIC || !participant) return;
          try {
            const msg = parseDesignSyncMessage(JSON.parse(designDecoder.decode(payload)));
            if (msg) handler(msg, { identity: participant.identity, name: participant.name || '' });
          } catch {
            /* ignore malformed messages */
          }
        };
        room.on(RoomEvent.DataReceived, onData);
        return () => {
          room.off(RoomEvent.DataReceived, onData);
        };
      },
      onConnected(handler) {
        // A hello sent before the room connected went nowhere; after a reconnect, messages were missed
        room.on(RoomEvent.Connected, handler);
        room.on(RoomEvent.Reconnected, handler);
        return () => {
          room.off(RoomEvent.Connected, handler);
          room.off(RoomEvent.Reconnected, handler);
        };
      },
    };
  }, [room]);
  const designSync = useDesignSync({
    transport: designTransport,
    active: shouldDisplayDesign,
    linkUrl: designLink?.url ?? null,
    isDriver: isDesignDriver,
    isAllowedSender: React.useCallback((identity: string) => designSenderAllowedRef.current(identity), []),
    localIdentity,
    localName: props.userChoices.username || '',
  });
  const [livedocHasBeenActivated, setLivedocHasBeenActivated] = React.useState(false);
  const shouldMountLiveDoc = livedocHasBeenActivated || shouldDisplayLiveDoc || isMirrorBlocked;
  /** 共享非浏览器画面时，LiveDoc 盖住整个视频区，避免画面套娃 */
  const liveDocMirrorOverlay = isMirrorBlocked && shouldMountLiveDoc && isPureLiveDoc;
  const [livekitConnected, setLivekitConnected] = React.useState(false);

  React.useEffect(() => {
    const onConnected = () => setLivekitConnected(true);
    const onDisconnected = () => {
      setLivekitConnected(false);
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

  const speakActivityToken = searchParams?.get(SPEAK_TOKEN_PARAM) ?? null;
  useSpeakActivityRecorder(
    room,
    isRecorderBot && livekitConnected ? speakActivityToken : null,
  );

  const speakWhileMutedMonitoring =
    livekitConnected &&
    !isRecorderBot &&
    !meetingEndedByHost &&
    !isLocalMicRestricted &&
    canUseRealtimeMediaControls;

  const {
    visible: speakWhileMutedVisible,
    dismiss: dismissSpeakWhileMuted,
    accept: acceptSpeakWhileMuted,
  } = useSpeakWhileMutedPrompt({
    micEnabled,
    monitoringEnabled: speakWhileMutedMonitoring,
  });

  const meetingDocumentPipLabels = React.useMemo(
    () => ({
      muteMic: t('toolbar.muteMic'),
      unmuteMic: t('toolbar.unmuteMic'),
      turnOffCam: t('toolbar.turnOffCam'),
      turnOnCam: t('toolbar.turnOnCam'),
      leave: t('toolbar.leaveTheMeeting'),
      endForEveryone: t('toolbar.endForEveryone'),
      meeting: t('meeting.documentPipTitle'),
      you: t('toolbar.you'),
      minimize: t('meeting.documentPipMinimize'),
      restore: t('meeting.documentPipRestore'),
      shareBadge: t('meeting.documentPipShareBadge'),
      presentingSelf: t('meeting.documentPipPresentingSelf'),
      shareScreen: t('toolbar.shareScreen'),
      stopSharing: t('toolbar.stopSharing'),
      shareConflict: t('toolbar.shareConflictTitle'),
      invite: t('toolbar.invite'),
      inviteCopied: t('meeting.documentPipCopied'),
      settings: t('meeting.documentPipSettings'),
      backToMain: t('meeting.documentPipBack'),
      close: t('common.close'),
    }),
    [t],
  );

  // ═══ Meeting Control Sync via DataChannel ═══
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
    /** 普通参会者是否显示文档 AI */
    participantLiveDocAi: boolean;
    /** 举手队列，按举手先后排序 */
    raisedHands: string[];
    /** identity → 举手时刻（发送端时钟），仅用于主持人重连后按心跳重建队列顺序 */
    raisedHandAtByIdentity: Record<string, number>;
    /** Design mode link (null when none) */
    designLink: StoredDesignLink | null;
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
    participantLiveDocAi: props.connectionDetails.participantLiveDocAi !== false,
    raisedHands: [],
    raisedHandAtByIdentity: {},
    designLink: parseStoredDesignLink(props.connectionDetails.designLink),
  });
  if (isHost) {
    authState.current.participantLiveDocAi =
      props.connectionDetails.participantLiveDocAi !== false;
  }

  const presenterListsEqual = React.useCallback(
    (a: string[] | null | undefined, b: string[] | null | undefined) => {
      const left = a ?? [];
      const right = b ?? [];
      if (left.length !== right.length) return false;
      return left.every((id, index) => id === right[index]);
    },
    [],
  );

  /** buildCorrection — 用主持人当前权威状态组装一条 CORRECTION 消息体 */
  const buildCorrection = React.useCallback(() => {
    const auth = authState.current;
    return {
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
      participantLiveDocAi: auth.participantLiveDocAi,
      raisedHands: auth.raisedHands,
      designLink: auth.designLink,
    } as const;
  }, []);

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
      // 断连 / PC 已关时 publishData 会抛 UnexpectedConnectionState: PC manager is closed
      if (room.state !== ConnectionState.Connected) {
        return;
      }
      const data = encoder.encode(JSON.stringify(msg));
      const opts: { reliable: boolean; topic: string; destinationIdentities?: string[] } = {
        reliable: true,
        topic: TOPIC,
      };
      if (destinationIdentities) {
        opts.destinationIdentities = destinationIdentities;
      }
      room.localParticipant.publishData(data, opts).catch(() => {
        if (room.state !== ConnectionState.Connected) {
          return;
        }
        room.localParticipant
          .publishData(data, {
            topic: TOPIC,
            ...(destinationIdentities ? { destinationIdentities } : {}),
          })
          .catch((err: unknown) => {
            // 重连/离开竞态：忽略 PC 已关闭类错误，避免刷控制台
            if (room.state !== ConnectionState.Connected) {
              return;
            }
            const message = err instanceof Error ? err.message : String(err);
            if (/PC manager is closed|UnexpectedConnectionState/i.test(message)) {
              return;
            }
            console.error(err);
          });
      });
    },
    [room, encoder],
  );
  broadcastRecordingStateRef.current = (state: RecordingState) => {
    sendMeetingMsg({ type: RECORDING_STATE_MSG, state });
  };

  useLiveDocSession({
    room,
    livekitConnected,
    meetingEndedByHost,
    isHost,
    isRecorderBot,
    shouldMountLiveDoc,
    shouldDisplayLiveDoc,
    isMirrorBlocked,
    jitsiInstanceId,
    meetingRoomName,
    username: props.userChoices.username,
    livedocInstanceId,
    setLivedocInstanceId,
    setLivedocInitError,
    setLivedocInitInProgress,
    livedocHasBeenActivated,
    setLivedocHasBeenActivated,
    connectionDetailsRef,
    sendMeetingMsg,
    setAuthLivedocInstanceId: (id) => {
      authState.current.livedocInstanceId = id;
    },
  });

  const participantLiveDocSentRef = React.useRef<boolean | null>(null);
  const participantLiveDocSavedRef = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    if (!isHost || !livekitConnected) return;
    const show = authState.current.participantLiveDocAi;
    if (participantLiveDocSentRef.current !== show) {
      participantLiveDocSentRef.current = show;
      setParticipantLiveDocAi(show);
      sendMeetingMsg({ type: 'PARTICIPANT_LIVEDOC_AI', show });
    }
    if (participantLiveDocSavedRef.current === show) return;
    const token = connectionDetailsRef.current.participantToken;
    const rn = connectionDetailsRef.current.roomName;
    if (!token || !rn) return;
    void persistParticipantLiveDocAi({
      roomName: rn,
      show,
      livekitToken: token,
    })
      .then(() => {
        participantLiveDocSavedRef.current = show;
      })
      .catch((err: unknown) => {
        console.error('[participantLiveDocAi] persist failed', err);
      });
  }, [isHost, livekitConnected, sendMeetingMsg]);

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

  // ═══ Raise Hand ═══
  // 举手权限与 Mute All 一致：主持人 / 联席主持人 / 联席演示者 / 当前屏幕共享者。
  const canManageHands = isHost || isCohost || isCopresenter || isAutoPresenter;
  // DataChannel 处理器用 ref 校验发送者身份，避免把角色列表塞进那个大 effect 的依赖里。
  const canManageHandsByRef = React.useRef<(identity: string) => boolean>(() => false);
  React.useEffect(() => {
    canManageHandsByRef.current = (identity: string) =>
      identity === hostIdentity ||
      cohostIdentities.includes(identity) ||
      copresenterIdentities.includes(identity) ||
      identity === autoPresenterIdentity;
  }, [hostIdentity, cohostIdentities, copresenterIdentities, autoPresenterIdentity]);
  const notifyHandRaisedRef = React.useRef<((identity: string) => void) | null>(null);

  /**
   * applyHostHands — 主持人提交新的权威举手队列并广播
   *
   * 只有队列真正发生变化时才发 CORRECTION，避免心跳聚合导致每 5 秒刷一次全量状态。
   */
  const applyHostHands = React.useCallback(
    (next: string[]) => {
      const auth = authState.current;
      if (presenterListsEqual(next, auth.raisedHands)) return;
      auth.raisedHands = next;
      auth.raisedHandAtByIdentity = Object.fromEntries(
        Object.entries(auth.raisedHandAtByIdentity).filter(([id]) => next.includes(id)),
      );
      setRaisedHands(next);
      sendMeetingMsg(buildCorrection());
    },
    [presenterListsEqual, sendMeetingMsg, buildCorrection],
  );

  // 下面三个操作都必须无条件广播 RAISE_HAND / LOWER_HAND / LOWER_ALL_HANDS：
  // 每个参会者的 handRaised 是自己心跳上报的数据源，若只更新主持人权威队列而不通知本人，
  // 被放下的手会在下一次心跳聚合时被重新加回队列。

  /** handleToggleHand — 本地用户举手 / 放下自己的手 */
  const handleToggleHand = React.useCallback(() => {
    const identity = room.localParticipant.identity;
    if (handRaisedRef.current) {
      setHandRaised(false);
      setRaisedHands((prev) => prev.filter((id) => id !== identity));
      sendMeetingMsg({ type: 'LOWER_HAND', identity });
      if (isHost) {
        applyHostHands(authState.current.raisedHands.filter((id) => id !== identity));
      }
      return;
    }
    const raisedAt = Date.now();
    handRaisedAtRef.current = raisedAt;
    setHandRaised(true);
    setRaisedHands((prev) => (prev.includes(identity) ? prev : [...prev, identity]));
    sendMeetingMsg({ type: 'RAISE_HAND', identity, raisedAt });
    if (isHost) {
      authState.current.raisedHandAtByIdentity[identity] = raisedAt;
      applyHostHands([
        ...authState.current.raisedHands.filter((id) => id !== identity),
        identity,
      ]);
    }
  }, [room, isHost, sendMeetingMsg, applyHostHands]);

  /** handleLowerParticipantHand — 管理角色放下指定参会者的手 */
  const handleLowerParticipantHand = React.useCallback(
    (identity: string) => {
      if (identity === room.localParticipant.identity) setHandRaised(false);
      setRaisedHands((prev) => prev.filter((id) => id !== identity));
      sendMeetingMsg({ type: 'LOWER_HAND', identity });
      if (isHost) {
        applyHostHands(authState.current.raisedHands.filter((id) => id !== identity));
      }
    },
    [room, isHost, sendMeetingMsg, applyHostHands],
  );

  /** handleLowerAllHands — 管理角色清空整个举手队列 */
  const handleLowerAllHands = React.useCallback(() => {
    setHandRaised(false);
    setRaisedHands([]);
    sendMeetingMsg({ type: 'LOWER_ALL_HANDS' });
    if (isHost) applyHostHands([]);
  }, [isHost, sendMeetingMsg, applyHostHands]);

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

  /**
   * clearOwnMicRestriction — 本人主动开麦时解除自己的禁麦标记
   *
   * 复用 UNMUTE_PARTICIPANT 让各端（含主持人）同步清掉红色角标：
   * 主持人不清的话，下一次心跳比对会把禁麦状态重新纠正回来。
   * 同时加入全体静音豁免名单，覆盖「被 Mute All 静音」的情形。
   */
  const clearOwnMicRestriction = React.useCallback(() => {
    const identity = room.localParticipant.identity;
    // 抢在 state 落地前置位，避免 TrackUnmuted 触发 enforceHostMute 把麦克风又关掉
    localMicRestrictedRef.current = false;
    sendMeetingMsg({ type: 'UNMUTE_PARTICIPANT', targetIdentity: identity });
    setHostMutedUntilByIdentity((prev) => {
      if (!(identity in prev)) return prev;
      const next = { ...prev };
      delete next[identity];
      return next;
    });
    setHostMutedIdentities((prev) => prev.filter((id) => id !== identity));
    setExemptFromMuteAllIdentities((prev) =>
      prev.includes(identity) ? prev : [...prev, identity],
    );
  }, [room, sendMeetingMsg]);
  clearOwnMicRestrictionRef.current = clearOwnMicRestriction;

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

  // Takeover: 通知所有远端共享人停止，等旧轨下线后再开本地共享
  const handleConfirmShareTakeover = React.useCallback(() => {
    setShowShareTakeoverDialog(false);

    if (takeoverTimerRef.current) {
      clearTimeout(takeoverTimerRef.current);
      takeoverTimerRef.current = null;
    }

    const localId = room.localParticipant.identity;
    const remotes = new Set<string>();
    for (const ref of screenShareTracks) {
      const id = ref.participant?.identity;
      if (id && id !== localId) remotes.add(id);
    }
    remotes.forEach((id) => {
      sendMeetingMsg(
        { type: 'FORCE_STOP_SHARE', requesterIdentity: localId },
        [id],
      );
    });

    const startLocalShare = () => {
      takeoverTimerRef.current = null;
      setScreenShareActive(true);
      beginLocalScreenShareView();
      room.localParticipant.setScreenShareEnabled(true, SCREEN_SHARE_CAPTURE).catch((e: unknown) => {
        setScreenShareActive(false);
        const restored = endLocalScreenShareView();
        if (restored) setActiveView(restored);
        showScreenShareFailureToast(e);
        console.error(e);
      });
    };

    const remoteStillSharing = () =>
      Array.from(room.remoteParticipants.values()).some((p) => {
        const pub = p.getTrackPublication(Track.Source.ScreenShare);
        return Boolean(pub?.track);
      });

    const deadline = Date.now() + 4000;
    const poll = () => {
      if (!remoteStillSharing() || Date.now() >= deadline) {
        startLocalShare();
        return;
      }
      takeoverTimerRef.current = setTimeout(poll, 150);
    };
    takeoverTimerRef.current = setTimeout(poll, 150);
  }, [room, screenShareTracks, sendMeetingMsg, beginLocalScreenShareView, endLocalScreenShareView, showScreenShareFailureToast]);

  React.useEffect(
    () => () => {
      if (takeoverTimerRef.current) {
        clearTimeout(takeoverTimerRef.current);
        takeoverTimerRef.current = null;
      }
    },
    [],
  );

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
      clearActiveKloudRoom();
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
    clearActiveKloudRoom,
    props.meetingOwnerMemberId,
    room,
    router,
    sendMeetingMsg,
    stopRecordingAndThen,
  ]);

  React.useEffect(() => {
    if (!isHost) return;
    const handler = (participant: RemoteParticipant) => {
      // Send full meeting state to new joiner so they immediately adopt the
      // current meeting mode and see correct mute indicators.
      sendMeetingMsg(buildCorrection(), [participant.identity]);
    };
    room.on(RoomEvent.ParticipantConnected, handler);
    return () => {
      room.off(RoomEvent.ParticipantConnected, handler);
    };
  }, [room, isHost, sendMeetingMsg, buildCorrection]);

  // Host/Presenter/Co-host: broadcast VIEW_CHANGE to all participants
  const broadcastViewChange = React.useCallback(
    (view: ViewMode) => {
      if (isHost) {
        authState.current.view = view;
        sendMeetingMsg(buildCorrection());
      }
      sendMeetingMsg({ type: 'VIEW_CHANGE', view });
      // Persist for late joiners (privileged only; skip duplicate mode)
      if (!canBroadcastViewChangeRef.current) return;
      if (lastPersistedRoomViewRef.current === view) return;
      const token = connectionDetailsRef.current.participantToken;
      const rn = connectionDetailsRef.current.roomName;
      if (token && rn) {
        lastPersistedRoomViewRef.current = view;
        void persistMeetingRoomView({
          roomName: rn,
          view,
          livekitToken: token,
        }).catch((err) => {
          // Allow retry on next broadcast of the same view after a failure
          if (lastPersistedRoomViewRef.current === view) {
            lastPersistedRoomViewRef.current = null;
          }
          console.error('[meetingRoomView] persist failed', err);
        });
      }
    },
    [sendMeetingMsg, isHost, buildCorrection],
  );

  // Keep the ref in sync for handleViewChange
  React.useEffect(() => {
    broadcastViewChangeRef.current = broadcastViewChange;
  }, [broadcastViewChange]);

  /* ── Design mode: a link everyone views ── */
  const persistDesignLink = React.useCallback((url: string | null, view?: ViewMode, embed?: 'blocked') => {
    const token = connectionDetailsRef.current.participantToken;
    const rn = connectionDetailsRef.current.roomName;
    if (!token || !rn) return;
    // Guests can't store it for late joiners (403); the live message still reached everyone.
    void persistMeetingDesignLink({ roomName: rn, url, view, embed, livekitToken: token }).catch((err) =>
      console.warn('[design] persist failed', err),
    );
  }, []);

  const applyDesignLink = React.useCallback(
    (next: StoredDesignLink | null, nextView?: ViewMode) => {
      setDesignStored(next);
      if (isHost) authState.current.designLink = next;
      sendMeetingMsg({ type: 'DESIGN_LINK', link: next });
      persistDesignLink(next?.url ?? null, nextView, next?.embed);
    },
    [isHost, sendMeetingMsg, persistDesignLink],
  );

  /** Design mode lives in the LiveDoc panel: the shared link is a row there, "Link" sits with the uploads */
  const designItem: LiveDocDesignItem | null = React.useMemo(() => {
    if (!designLink) return null;
    const kind = designKindKey(designLink);
    const kindLabel = t(kind.key);
    return {
      label: designLink.kind === 'figma' ? designLink.label : designLink.host,
      kind: designLink.kind,
      kindLabel: kindLabel === kind.key ? kind.fallback : kindLabel,
      setByName: designStored?.setByName,
      showing: activeView === 'design',
    };
  }, [designLink, designStored?.setByName, activeView, t]);
  const showDesign = React.useCallback(() => {
    if (canSwitchViews && designLink) handleViewChange('design');
  }, [canSwitchViews, designLink, handleViewChange]);
  const openDesignDialog = React.useCallback(() => {
    if (canSwitchViews) setDesignDialogOpen(true);
  }, [canSwitchViews]);

  const submitDesignLink = React.useCallback(
    (link: DesignLink, check?: DesignEmbedCheck) => {
      applyDesignLink({
        url: link.url,
        setBy: room.localParticipant.identity,
        setByName: props.userChoices.username || undefined,
        setAt: Date.now(),
        ...(check?.embed === 'blocked' ? { embed: 'blocked' as const } : {}),
      });
      rememberDesignLink({ url: link.url, label: link.kind === 'figma' ? link.label : link.host, kind: link.kind });
      setDesignDialogOpen(false);
      handleViewChange('design');
    },
    [applyDesignLink, room, props.userChoices.username, handleViewChange],
  );

  const checkDesignEmbed = React.useCallback(
    (url: string) =>
      checkDesignLinkEmbed({
        roomName: connectionDetailsRef.current.roomName,
        url,
        livekitToken: connectionDetailsRef.current.participantToken,
      }),
    [],
  );

  const stopDesign = React.useCallback(() => {
    const nextView = lastStableRoomViewRef.current;
    applyDesignLink(null, nextView);
    handleViewChange(nextView);
  }, [applyDesignLink, handleViewChange]);

  // The stage says Design but there's no usable link (cleared, or refused locally): fall back.
  React.useEffect(() => {
    if (activeView === 'design' && !designLink) {
      setActiveView(lastStableRoomViewRef.current);
    }
  }, [activeView, designLink]);

  // Listen for incoming DataChannel messages
  React.useEffect(() => {
    const handleData = (payload: Uint8Array, participant?: any, kind?: any, topic?: string) => {
      try {
        const msg = JSON.parse(decoder.decode(payload));
        // 服务端踢人通知（可能来自 meeting-control 或 kloud-session）
        if (msg.type === 'SESSION_EVICTED') {
          // Self token renew / voluntary leave must not show "Session Moved"
          if (intentionalDisconnectRef.current) {
            return;
          }
          duplicateSessionHandledRef.current = true;
          intentionalDisconnectRef.current = true;
          setEvictedByDuplicateSession(true);
          return;
        }
        if (msg.type === 'REMOVED_FROM_MEETING') {
          const target =
            typeof msg.identity === 'string' ? msg.identity : room.localParticipant.identity;
          if (target === room.localParticipant.identity) {
            handleRemovedFromMeeting();
          }
          return;
        }
      } catch {
        /* fall through to topic-gated handler */
      }
      if (topic !== TOPIC) return;
      try {
        const msg = JSON.parse(decoder.decode(payload));
        const senderIdentity = participant?.identity;

        if (msg.type === 'VIEW_CHANGE') {
          // Skip messages from self — presenter broadcasts 'shareScreen' to others
          // but stays in 'liveDoc' themselves
          if (senderIdentity !== room.localParticipant.identity) {
            // The host switched the room: everyone follows, own choices end here
            roomViewRef.current = msg.view as ViewMode;
            localViewChoiceRef.current = false;
            setActiveView(msg.view as ViewMode);
          }
        } else if (msg.type === 'DESIGN_LINK') {
          // Only people who may switch the stage can change what everyone views
          if (senderIdentity && senderIdentity !== room.localParticipant.identity && designSenderAllowedRef.current(senderIdentity)) {
            const next = msg.link === null ? null : parseStoredDesignLink(msg.link);
            if (msg.link === null || next) {
              setDesignStored(next);
              if (hostIdentityRef.current === room.localParticipant.identity) {
                authState.current.designLink = next;
              }
            }
          }
        } else if (msg.type === 'LIVEDOC_INSTANCE' && typeof msg.livedocInstanceId === 'string') {
          setLivedocInstanceId(msg.livedocInstanceId);
        } else if (msg.type === 'PARTICIPANT_LIVEDOC_AI' && typeof msg.show === 'boolean') {
          const hostId = hostIdentityRef.current;
          if (!hostId || senderIdentity === hostId) {
            setParticipantLiveDocAi(msg.show);
          }
        } else if (msg.type === 'CORRECTION') {
          // Correction from host — update to authoritative state
          // But don't override presenter's liveDoc view (they intentionally diverge), nor an
          // attendee's own view choice while the room view hasn't changed
          if (msg.view !== roomViewRef.current) localViewChoiceRef.current = false;
          roomViewRef.current = msg.view as ViewMode;
          if (!(isLocalScreenShare && msg.view === 'shareScreen') && !localViewChoiceRef.current) {
            setActiveView(msg.view as ViewMode);
          }
          if (msg.presenter !== undefined) {
            setCopresenterIdentities(Array.isArray(msg.presenter) ? msg.presenter : msg.presenter ? [msg.presenter] : []);
          }
          if (typeof (msg as { livedocInstanceId?: string }).livedocInstanceId === 'string') {
            setLivedocInstanceId((msg as { livedocInstanceId: string }).livedocInstanceId);
          }
          // Restore mute state for late joiners
          if ('designLink' in msg) {
            setDesignStored(parseStoredDesignLink(msg.designLink));
          }
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
          if (typeof (msg as { participantLiveDocAi?: boolean }).participantLiveDocAi === 'boolean') {
            const hostId = hostIdentityRef.current;
            if (!hostId || senderIdentity === hostId) {
              setParticipantLiveDocAi(
                (msg as { participantLiveDocAi: boolean }).participantLiveDocAi,
              );
            }
          }
          // 举手队列以主持人为准；本地 handRaised 不在此处覆盖，
          // 主持人重连后会通过心跳重新收到本地举手态并补回队列。
          if (Array.isArray(msg.raisedHands)) {
            setRaisedHands(msg.raisedHands.filter((id: unknown) => typeof id === 'string'));
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
            desiredMicRef.current = false;
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
            desiredMicRef.current = restoreTo;
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
            desiredMicRef.current = false;
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
              sendMeetingMsg({
                type: 'RC_DENIED',
                requesterIdentity: msg.requesterIdentity,
                requesterName: msg.requesterName,
                reason: 'busy',
              });
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
        } else if (msg.type === 'RC_STOP') {
          // Controller voluntarily ended control — presenter clears approval
          if (screenShareActive && msg.requesterIdentity) {
            const wasApproved = approvedControllerIdentity === msg.requesterIdentity;
            if (wasApproved) {
              setApprovedControllerIdentity(null);
            }
            if (remoteControlRequest?.requesterIdentity === msg.requesterIdentity) {
              setRemoteControlRequest(null);
            }
            // Only echo revoke for the active controller (avoid spurious clears)
            if (wasApproved) {
              sendMeetingMsg({
                type: 'RC_REVOKED',
                requesterIdentity: msg.requesterIdentity,
                requesterName: msg.requesterName || '',
              });
            }
          }
        } else if (msg.type === 'RC_CANCELLED') {
          if (remoteControlRequest?.requesterIdentity === msg.requesterIdentity) {
            setRemoteControlRequest(null);
          }
        } else if (msg.type === 'FORCE_STOP_SHARE') {
          // Someone is taking over screen share — stop our share and remove presenter role
          if (screenShareActive) {
            if (approvedControllerIdentity) {
              sendMeetingMsg({
                type: 'RC_REVOKED',
                requesterIdentity: approvedControllerIdentity,
                requesterName: '',
              });
              setApprovedControllerIdentity(null);
            }
            setScreenShareActive(false);
            room.localParticipant.setScreenShareEnabled(false).catch(console.error);
            // View restore happens in hasScreenShare effect when the track ends
          }
          // If we were a co-presenter, remove ourselves
          setCopresenterIdentities((prev) => prev.filter((id) => id !== room.localParticipant.identity));
          // Let the host know our presenter role is gone
          if (!isHost) {
            sendMeetingMsg({ type: 'REMOVE_PRESENTER', identity: room.localParticipant.identity });
          }
        } else if (msg.type === 'RAISE_HAND') {
          // 只接受"本人举自己的手"，防止伪造他人举手
          const target = typeof msg.identity === 'string' ? msg.identity : null;
          if (!target || !senderIdentity || target !== senderIdentity) return;
          const raisedAt = typeof msg.raisedAt === 'number' ? msg.raisedAt : Date.now();
          setRaisedHands((prev) => (prev.includes(target) ? prev : [...prev, target]));
          if (isHost) {
            const auth = authState.current;
            auth.raisedHandAtByIdentity[target] = raisedAt;
            applyHostHands([...auth.raisedHands.filter((id) => id !== target), target]);
          }
          notifyHandRaisedRef.current?.(target);
        } else if (msg.type === 'LOWER_HAND') {
          const target = typeof msg.identity === 'string' ? msg.identity : null;
          if (!target || !senderIdentity) return;
          // 放手只允许本人或管理角色发起
          if (target !== senderIdentity && !canManageHandsByRef.current(senderIdentity)) return;
          if (target === room.localParticipant.identity) setHandRaised(false);
          setRaisedHands((prev) => prev.filter((id) => id !== target));
          if (isHost) {
            // 联席主持人发起的放手需由主持人转发给本人：晚加入者可能还不知道
            // 发起者是联席主持人而拒收，导致对方的手在下次心跳里被加回队列。
            // 仅在队列确实发生变化时转发，避免主持人身份切换期间来回转发。
            const wasQueued = authState.current.raisedHands.includes(target);
            applyHostHands(authState.current.raisedHands.filter((id) => id !== target));
            if (wasQueued && target !== senderIdentity && target !== room.localParticipant.identity) {
              sendMeetingMsg({ type: 'LOWER_HAND', identity: target }, [target]);
            }
          }
        } else if (msg.type === 'LOWER_ALL_HANDS') {
          if (!senderIdentity || !canManageHandsByRef.current(senderIdentity)) return;
          setHandRaised(false);
          setRaisedHands([]);
          if (isHost) {
            const hadQueue = authState.current.raisedHands.length > 0;
            applyHostHands([]);
            if (hadQueue) sendMeetingMsg({ type: 'LOWER_ALL_HANDS' });
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

          // 举手持久化：每个参会者在心跳里上报自己的举手态，主持人据此重建权威队列。
          // 主持人刷新/重连后队列会在一个心跳周期内自动恢复，无需服务端存储。
          const guestHandRaised = (msg as { handRaised?: boolean }).handRaised === true;
          const guestHandRaisedAt = typeof (msg as { handRaisedAt?: number }).handRaisedAt === 'number'
            ? (msg as { handRaisedAt: number }).handRaisedAt
            : Date.now();
          const authHands = auth.raisedHands;
          if (guestHandRaised && !authHands.includes(senderIdentity)) {
            auth.raisedHandAtByIdentity[senderIdentity] = guestHandRaisedAt;
            // 按上报时刻插入，保证主持人重连后各端看到的排队顺序一致
            const insertAt = authHands.findIndex(
              (id) => (auth.raisedHandAtByIdentity[id] ?? 0) > guestHandRaisedAt,
            );
            const rebuilt = [...authHands];
            rebuilt.splice(insertAt === -1 ? rebuilt.length : insertAt, 0, senderIdentity);
            applyHostHands(rebuilt);
          } else if (!guestHandRaised && authHands.includes(senderIdentity)) {
            applyHostHands(authHands.filter((id) => id !== senderIdentity));
          }
          const guestRaisedHands = Array.isArray((msg as { raisedHands?: unknown }).raisedHands)
            ? ((msg as { raisedHands: string[] }).raisedHands)
            : [];

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
            captionsMismatch ||
            !presenterListsEqual(guestRaisedHands, auth.raisedHands)
          ) {
            sendMeetingMsg(buildCorrection(), [senderIdentity]);
          }
        } else if (msg.type === RECORDING_STATE_MSG && msg.state) {
          // Someone started / stopped / paused recording or changed its settings
          setRecordingState({ ...IDLE_RECORDING_STATE, ...(msg.state as RecordingState) });
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
    handleRemovedFromMeeting,
    presenterListsEqual,
    isLocalScreenShare,
    isLocalControlOperator,
    applyHostHands,
    buildCorrection,
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
      // 接过主持人身份时用本地举手队列镜像播种，避免主持人转让后队列被清空
      if (auth.raisedHands.length === 0 && raisedHandsRef.current.length > 0) {
        auth.raisedHands = raisedHandsRef.current;
      }
      for (const [, participant] of room.remoteParticipants) {
        sendMeetingMsg(buildCorrection(), [participant.identity]);
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
    buildCorrection,
  ]);

  // 取消静音后持续说话自动放下手：仅对本地用户生效，避免各端重复广播
  React.useEffect(() => {
    if (!handRaised) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const handleSpeakers = (speakers: Participant[]) => {
      const local = room.localParticipant;
      const isSpeakingNow =
        speakers.some((p) => p.identity === local.identity) && local.isMicrophoneEnabled;
      if (!isSpeakingNow) {
        clearTimer();
        return;
      }
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (handRaisedRef.current) handleToggleHand();
      }, AUTO_LOWER_HAND_MS);
    };
    room.on(RoomEvent.ActiveSpeakersChanged, handleSpeakers);
    return () => {
      clearTimer();
      room.off(RoomEvent.ActiveSpeakersChanged, handleSpeakers);
    };
  }, [room, handRaised, handleToggleHand]);

  // "XXX 举手了" 提示：短窗口内合并，多人同时举手只弹一条
  React.useEffect(() => {
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    notifyHandRaisedRef.current = (identity: string) => {
      if (identity === room.localParticipant.identity) return;
      pending.add(identity);
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        const names = Array.from(pending).map(
          (id) => room.remoteParticipants.get(id)?.name || id,
        );
        pending.clear();
        const name = names[0];
        if (!name) return;
        toast(
          names.length > 1
            ? t('toolbar.handRaisedToastMulti', {
                name,
                others: names.length - 1,
                total: names.length,
              })
            : t('toolbar.handRaisedToast', { name }),
        );
      }, HAND_TOAST_MERGE_MS);
    };
    return () => {
      notifyHandRaisedRef.current = null;
      if (timer !== null) clearTimeout(timer);
    };
  }, [room, t]);

  // 参会者离开时清理其举手记录（离线者不再发心跳，必须显式剔除）
  React.useEffect(() => {
    const handleLeft = (participant: RemoteParticipant) => {
      setRaisedHands((prev) =>
        prev.includes(participant.identity)
          ? prev.filter((id) => id !== participant.identity)
          : prev,
      );
      if (isHost) {
        applyHostHands(
          authState.current.raisedHands.filter((id) => id !== participant.identity),
        );
      }
    };
    room.on(RoomEvent.ParticipantDisconnected, handleLeft);
    return () => {
      room.off(RoomEvent.ParticipantDisconnected, handleLeft);
    };
  }, [room, isHost, applyHostHands]);

  // All participants: send heartbeat every 5s to the authoritative host identity.
  // Protected meetings also refresh the waiting list on this clock (host / co-host only).
  React.useEffect(() => {
    if (!room.localParticipant.identity) return;

    const interval = setInterval(() => {
      if (acceptsKnocks && (isHost || isCohost)) {
        joinRequestsRefreshRef.current?.();
      }
      if (hostIdentity === room.localParticipant.identity) return;
      sendMeetingMsg(
        {
          type: 'HEARTBEAT',
          // An attendee looking at their own choice reports the room view, so the host doesn't pull them back
          view: localViewChoiceRef.current
            ? roomViewRef.current
            : (activeView === 'liveDoc' && isLocalScreenShare) ? 'shareScreen' : activeView,
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
          // 自己的举手态 + 举手时刻：主持人据此重建权威队列（举手持久化）
          handRaised: handRaisedRef.current,
          handRaisedAt: handRaisedAtRef.current,
          // 本地举手队列镜像，供主持人检测不一致后下发 CORRECTION
          raisedHands: raisedHandsRef.current,
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
    acceptsKnocks,
    isHost,
    isCohost,
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

  useTileIndicators({
    room,
    hostIdentity,
    cohostIdentities,
    autoPresenterIdentity,
    copresenterIdentities,
    isHost,
    isCohost,
    muteAllActive,
    hostMutedIdentities,
    hostDisabledVideoIdentities,
    exemptFromMuteAllIdentities,
    hasScreenShare,
    isWebcamSidebarCollapsed,
    muteAllActiveRef,
    hostMutedIdentitiesRef,
    hostDisabledVideoIdentitiesRef,
    exemptFromMuteAllIdentitiesRef,
    raisedHandsRef,
    updateCustomMicsRef,
  });

  // 主持禁音/禁视频 / 切换 Webcam 视图后立即刷新 tile 图标与 ⋯ 菜单
  React.useEffect(() => {
    updateCustomMicsRef.current?.();
  }, [hostMutedIdentities, hostDisabledVideoIdentities, muteAllActive, hasScreenShare, activeView]);

  // Clear remote-control + Electron share-target only when a share session ends
  const prevHasScreenShareRef = React.useRef(false);
  React.useEffect(() => {
    const hadShare = prevHasScreenShareRef.current;
    prevHasScreenShareRef.current = hasScreenShare;
    if (!hadShare || hasScreenShare) return;

    const activeController = approvedControllerIdentityRef.current;
    if (activeController) {
      sendMeetingMsg({
        type: 'RC_REVOKED',
        requesterIdentity: activeController,
        requesterName: '',
      });
    }
    setRemoteControlPending(false);
    setRemoteControlRequest(null);
    setApprovedControllerIdentity(null);
    setIsRemoteControlMode(false);
    setIsDrawingMode(false);
    if (typeof window !== 'undefined' && window.electronAPI?.clearShareTarget) {
      void window.electronAPI.clearShareTarget();
    }
  }, [hasScreenShare, sendMeetingMsg]);

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

  /** Presenter revokes an active remote-control session */
  const handleRevokeRc = React.useCallback(
    (identity: string | null) => {
      if (!identity) return;
      setApprovedControllerIdentity(null);
      setRemoteControlRequest(null);
      sendMeetingMsg({
        type: 'RC_REVOKED',
        requesterIdentity: identity,
        requesterName: '',
      });
    },
    [sendMeetingMsg],
  );

  useTileNameSync(room);

  /** LiveDoc 当前文件是否为 Excalidraw 白板（来自 iframe 的 onkloudswitchfile.IsWhiteboard） */
  const [isWhiteboardDoc, setIsWhiteboardDoc] = React.useState(false);

  // Listen for postMessage to toggle webcam sidebar in LiveDoc mode
  React.useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;
      const data = e.data as { type?: string };
      if (e.data.type === 'Kloud-ShowWebcamView') {
        setShowWebcamSidebar(true);
      } else if (e.data.type === 'Kloud-HideWebcamView') {
        setShowWebcamSidebar(false);
      } else if (data.type === 'onkloudswitchfile') {
        const file = (e.data as { data?: { IsWhiteboard?: unknown } }).data;
        setIsWhiteboardDoc(file?.IsWhiteboard === true);
      } else if (data.type === 'onkloudloaded') {
        setShowWebcamSidebar(false);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // LiveDoc 主区域显示时：右侧面板已改为居中弹窗模态（LiveDoc Popup Modal），
  // 不再常驻右侧，因此 KloudMeet 侧也不再预留面板宽度。
  React.useEffect(() => {
    setShowWebcamSidebar(false);
    if (shouldDisplayLiveDoc) {
      postKloudShowFilePanelToIframe(0);
    }
  }, [shouldDisplayLiveDoc, isToolbarMobile]);

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
      raisedHands,
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
      raisedHands,
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
      raisedHands,
      canLowerHands: canManageHands,
      onLowerHand: handleLowerParticipantHand,
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
      onRemoveFromMeeting: (identity) => {
        if (!isHost && !isCohost) return;
        if (!identity || identity === room.localParticipant.identity) return;
        if (identity === hostIdentity) return;

        // 先通知对方立即离开，再由服务端强制移除
        sendMeetingMsg({ type: 'REMOVED_FROM_MEETING', identity }, [identity]);

        const roomSeg =
          window.location.pathname.split('/').filter(Boolean).pop() || '';
        if (roomSeg) {
          void fetch(`/api/meetings/${encodeURIComponent(roomSeg)}/remove-participant`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              identity,
              hostIdentity,
              cohostIdentities,
            }),
          }).catch((e) => {
            console.warn('[remove-participant] API failed', e);
          });
        }
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
      raisedHands,
      canManageHands,
      handleLowerParticipantHand,
    ],
  );

  // Desktop builds with their own mini window (kept out of screen shares) get one too
  const desktopMiniWindow = React.useMemo(() => getDesktopMiniWindow() !== null, []);
  const documentPip = useMeetingDocumentPip({
    enabled:
      livekitConnected &&
      (!isDesktop || desktopMiniWindow) &&
      !isToolbarMobile &&
      !isRecorderBot &&
      !meetingEndedByHost,
    room,
    micEnabled,
    camEnabled,
    labels: meetingDocumentPipLabels,
    localName: props.userChoices.username || t('toolbar.you'),
    mediaRestrictions: floatingMediaRestrictions,
    roleActions: participantRoleActions,
    onToggleMic: handleToggleMic,
    onToggleCam: handleToggleCam,
    onToggleShare: handleShareScreen,
    shareActive: screenShareActive,
    hasScreenShare,
    onLeave: handleLeaveWithSave,
    onEndForAll: handleEndForAll,
    onMuteParticipant: handleMuteParticipant,
    onDisableParticipantVideo: handleDisableParticipantVideo,
  });
  documentPipOpenRef.current = documentPip.open;

  // Recording: pick up the meeting's recording state when joining (late joiners, the recorder bot)
  React.useEffect(() => {
    if (!livekitConnected) return;
    const roomSeg = window.location.pathname.split('/').filter(Boolean).pop();
    const token = connectionDetailsRef.current?.participantToken;
    if (!roomSeg || !token) return;
    let cancelled = false;
    fetch(`/api/meetings/${roomSeg}/record`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.state) setRecordingState(data.state as RecordingState);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [livekitConnected]);

  // The current host keeps the server's list of host / co-hosts / presenters, which the record
  // API uses to check who may record.
  const meetingRolesKey = JSON.stringify({
    host: hostIdentity || null,
    cohosts: [...cohostIdentities].sort(),
    presenters: [...new Set([...copresenterIdentities, ...(autoPresenterIdentity ? [autoPresenterIdentity] : [])])].sort(),
  });
  React.useEffect(() => {
    if (!livekitConnected || !isHost || isRecorderBot) return;
    const roomSeg = window.location.pathname.split('/').filter(Boolean).pop();
    if (!roomSeg) return;
    const id = window.setTimeout(() => {
      void fetch(`/api/meetings/${roomSeg}/record`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'roles', roles: JSON.parse(meetingRolesKey) }),
      }).catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(id);
  }, [livekitConnected, isHost, isRecorderBot, meetingRolesKey]);

  // Recorder bot: the cloud recording mode decides what it shows.
  //   follow  — whatever the meeting shows (as before)
  //   gallery — everyone's video in a grid, even while someone shares
  //   speaker — whoever is talking; the shared content while someone shares / presents LiveDoc
  // The meeting's own view is kept in meetingViewRef so "follow" and "speaker" can return to it.
  const meetingViewRef = React.useRef<ViewMode>(activeView);
  const botForcingViewRef = React.useRef(false);
  const botMode = isRecorderBot ? recordingState.mode : 'follow';
  React.useEffect(() => {
    if (!isRecorderBot) return;
    if (botForcingViewRef.current) {
      botForcingViewRef.current = false;
    } else {
      meetingViewRef.current = activeView;
    }
    const meetingView = meetingViewRef.current;
    let wantView: ViewMode = meetingView;
    if (botMode === 'gallery') wantView = 'webcam';
    if (botMode === 'speaker') {
      wantView = hasScreenShare || meetingView === 'liveDoc' || meetingView === 'design' ? meetingView : 'webcam';
    }
    if (wantView !== activeView) {
      botForcingViewRef.current = true;
      setActiveView(wantView);
    }
    if (botMode === 'gallery' && webcamLayoutMode !== 'tile') setWebcamLayoutMode('tile');
    if (botMode === 'speaker' && webcamLayoutMode !== 'spotlight') setWebcamLayoutMode('spotlight');
  }, [isRecorderBot, botMode, activeView, hasScreenShare, webcamLayoutMode]);

  /** Who may start / stop / pause recording here (the server checks the same rule) */
  const canRecordHere = canControlRecording({
    isHost,
    isCohost,
    isPresenter: isCopresenter || isAutoPresenter,
    hostOnly: recordingState.hostOnly,
  });

  const [showPipSuggest, setShowPipSuggest] = React.useState(false);

  React.useEffect(() => {
    if (!livekitConnected || isDesktop || isToolbarMobile || isRecorderBot || meetingEndedByHost) {
      setShowPipSuggest(false);
      return;
    }
    if (!isWebDocumentPipEligible() || documentPip.isOpen || showMeetingReadyModal) {
      setShowPipSuggest(false);
      return;
    }
    const id = window.setTimeout(() => setShowPipSuggest(true), 1200);
    return () => window.clearTimeout(id);
  }, [
    livekitConnected,
    isDesktop,
    isToolbarMobile,
    isRecorderBot,
    meetingEndedByHost,
    documentPip.isOpen,
    showMeetingReadyModal,
  ]);

  // 浮窗拖拽曾把 LiveDoc iframe 的 pointer-events 设为 none，这里清掉历史残留
  React.useEffect(() => {
    document.querySelectorAll<HTMLIFrameElement>('iframe[title="LiveDoc"]').forEach((iframe) => {
      iframe.style.pointerEvents = '';
    });
  }, []);

  // Chat + Attendee overlay state
  const [chatOpen, setChatOpen] = React.useState(false);
  const [attendeeOpen, setAttendeeOpen] = React.useState(false);

  // ─── Captions (host/co-host only can toggle, all see the overlay) ────────
  const { locale } = useI18n();
  const {
    captionsInfo,
    setCaptionsOpen,
    captionsRunning,
    readLanguage: captionReadLanguage,
    roomLanguages: captionRoomLanguages,
    setReadLanguage: setCaptionReadLanguage,
    captionStatus,
    retryCaptions,
    peerCaptionIssues,
  } = useCaptions({
    room,
    micEnabled,
    languageCode: locale,
    getToken: () => connectionDetailsRef.current?.participantToken ?? '',
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

  const { chatPanelNode } = useMeetingChat({
    room,
    meetingRoomName,
    livedocInstanceId,
    connectionDetailsRef,
    setLivedocHasBeenActivated,
    setActiveView,
  });

  return (
    <div className={`lk-room-container ${isToolbarMobile ? 'kloud-mobile-meeting' : ''}`} style={{ position: 'relative', height: '100%' }}>
      <RoomContext.Provider value={room}>
        <ParticipantRoleMenuProvider {...participantRoleActions}>
        {/* 移动端始终挂载独立音频渲染；屏幕共享时 VideoConference 内 audio 由 CSS 隐藏，避免双挂回声 */}
        {isToolbarMobile && <KloudMobileRoomAudioRenderer />}
        {/* 桌面端远端音频挂在错误边界之外：视频区域反复出错被卸载时仍能听到声音 */}
        {/* While recording is paused the recorder bot shows a slate instead of the meeting
            (and goes silent below), so nothing said or shown during the pause is in the file */}
        {isRecorderBot && recordingState.paused && <RecorderPausedSlate />}
        {/* The recorder bot goes silent while recording is paused, so the pause isn't in the file */}
        {!isToolbarMobile && <RoomAudioRenderer muted={isRecorderBot && recordingState.paused} />}
        <KeyboardShortcuts />

        {/* ── Host ended meeting (remote end or END_MEETING) ── */}
        {meetingEndedByHost && (
          <HostEndedOverlay
            onReturnHome={() => {
              if (hostEndedRedirectTimerRef.current) {
                clearTimeout(hostEndedRedirectTimerRef.current);
                hostEndedRedirectTimerRef.current = null;
              }
              router.push('/');
            }}
          />
        )}

        {/* ── Duplicate session eviction (same user joined elsewhere) ── */}
        {evictedByDuplicateSession && (
          <DuplicateSessionOverlay
            onReturnHome={() => router.push('/')}
            onRejoin={rejoinAfterDuplicateSession}
          />
        )}

        {/* ── Removed from meeting by host / co-host ── */}
        {removedFromMeeting && <RemovedFromMeetingOverlay onReturnHome={() => router.push('/')} />}

        {/* ── Connection Error / Retry Overlay ── */}
        {connectError !== null && !meetingEndedByHost && (
          <ConnectErrorOverlay
            error={connectError}
            onCancel={() => {
              // Go back to dashboard
              markIntentionalDisconnect();
              clearActiveKloudRoom();
              setConnectError(null);
              room.disconnect().catch(console.error);
              router.push('/');
            }}
            onRejoin={rejoinManually}
          />
        )}

        {/* ── Recording Save Overlay ── */}
        {recordSavePhase !== null && <RecordingSaveOverlay phase={recordSavePhase} />}

        {/* Remote Control approval dialog — rendered at top level to avoid overflow clipping */}
        {remoteControlRequest && screenShareActive && (
          <RemoteControlApprovalDialog
            request={remoteControlRequest}
            onDeny={handleDenyRcRequest}
            onApprove={handleApproveRcRequest}
          />
        )}

        {/* ── Screen Share Takeover Dialog ── */}
        {showShareTakeoverDialog && (
          <ShareTakeoverDialog
            presenter={
              screenShareTracks[0]?.participant?.name ||
              screenShareTracks[0]?.participant?.identity
            }
            onCancel={() => setShowShareTakeoverDialog(false)}
            onConfirm={handleConfirmShareTakeover}
          />
        )}

        {/* View content area */}
        <div
          className={`main-meeting-area${
            isToolbarMobile &&
            ((activeView === 'webcam' && !hasScreenShare) || shouldDisplayLiveDoc || shouldDisplayDesign)
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
              ((activeView === 'webcam' && !hasScreenShare) || shouldDisplayLiveDoc || shouldDisplayDesign)
                ? 'var(--kloud-mobile-toolbar-height)'
                : 0,
            overflow: 'hidden',
            display: 'flex',
            background: 'var(--km-stage)',
          }}
        >
          {/* Sharing your own screen: say so instead of showing it (LiveDoc stays one click away) */}
          {ownShareHidden && activeView === 'shareScreen' && !isRecorderBot && (
            <div className="km-presenting-cover" role="status">
              <div className="km-presenting-card">
                <div className="km-presenting-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path d="M8 21h8M12 17v4M12 13V7M9 10l3-3 3 3" />
                  </svg>
                </div>
                <h2 className="km-presenting-title">{t('meeting.presentingTitle')}</h2>
                <p className="km-presenting-body">{t('meeting.presentingBody')}</p>
                <div className="km-presenting-actions">
                  <button type="button" className="km-presenting-stop" onClick={handleShareScreen}>
                    {t('toolbar.stopSharing')}
                  </button>
                  <button type="button" className="km-presenting-doc" onClick={() => setActiveView('liveDoc')}>
                    {t('meeting.presentingShowDoc')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Standalone LiveDoc mounts only after first activation, then stays mounted to avoid iframe reloads. */}
          <div
            style={
              liveDocMirrorOverlay
                ? {
                    position: 'absolute',
                    inset: 0,
                    zIndex: 50,
                    display: 'flex',
                    overflow: 'hidden',
                    background: 'var(--km-stage)',
                  }
                : {
                    display: shouldDisplayLiveDoc ? 'flex' : 'none',
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                  }
            }
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

          {/* Design mode: the shared link (Figma, web page) */}
          {shouldDisplayDesign && designLink && (
            <div style={{ display: 'flex', flex: 1, minWidth: 0, position: 'relative' }}>
              <DesignStage
                link={designLink}
                presenterName={designStored?.setByName}
                isDriver={isDesignDriver}
                canControl={canSwitchViews}
                sync={designSync}
                embedBlocked={designStored?.embed === 'blocked'}
                onChangeLink={() => setDesignDialogOpen(true)}
                onStop={stopDesign}
              />
            </div>
          )}

          {/* VideoConference: always visible when not in pure LiveDoc mode */}
          <div
            className={`sky-meet-video-wrapper ${hasScreenShare ? 'has-screen-share' : ''} ${isWebcamSidebarCollapsed ? 'sidebar-collapsed' : ''} ${screenShareActive ? 'presenter-sharing' : ''} ${isMirrorBlocked ? 'mirror-blocked' : ''} ${isRecorderBot ? 'recorder-bot-view' : ''} ${!hasScreenShare && activeView === 'webcam' && webcamLayoutMode === 'spotlight' ? 'webcam-spotlight' : ''}`}
            style={{
              flex: 1,
              position: 'relative',
              display: shouldDisplayLiveDoc || shouldDisplayDesign ? 'none' : 'flex',
              flexDirection: 'column',
              minHeight: 0,
              height: '100%',
              overflow: 'hidden',
            }}
          >
            {isToolbarMobile && activeView === 'webcam' && !hasScreenShare && webcamLayoutMode === 'tile' ? (
              <MobileVideoLayout />
            ) : isToolbarMobile && !hasScreenShare && webcamLayoutMode === 'tile' ? (
              <KloudConnectionStateToast />
            ) : (
              <VideoConferenceErrorBoundary>
                <KloudVideoConference
                  webcamLayoutMode={hasScreenShare ? 'tile' : webcamLayoutMode}
                  ignoreScreenShare={botMode === 'gallery'}
                  galleryPrefs={galleryPrefs}
                  chatMessageFormatter={formatChatMessageLinks}
                  SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
                />
              </VideoConferenceErrorBoundary>
            )}

            {/* Safe preview badge (hidden during remote control for clear view) */}
            {hasScreenShare && activeView === 'shareScreen' && !isMirrorBlocked && !ownShareHidden && !isRemoteControlMode && (
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
                    // 强制 play 页面上所有视频 + 解锁远程音频（需在用户手势内）
                    document.querySelectorAll('video').forEach((v) => {
                      v.play().catch(() => null);
                    });
                    void unlockMobileRoomAudio(room).then((ok) => setCanPlaybackAudio(ok));
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

            {/*
              Desktop: keep annotation/RC bridges mounted whenever a share exists so the
              presenter (forced onto LiveDoc) still forwards DataChannel → Electron IPC.
              Interactive UI only when viewing shareScreen.
              Web: same mount is harmless (no electronAPI); interactive only on shareScreen.
            */}
            {hasScreenShare && (
              <>
                <AnnotationCanvas
                  isDrawingMode={isDrawingMode && activeView === 'shareScreen'}
                  bridgeOnly={activeView !== 'shareScreen'}
                  forwardToOverlay={screenShareActive}
                />
                <RemoteControlOverlay
                  isActive={isRemoteControlMode && activeView === 'shareScreen'}
                  isPresenter={screenShareActive}
                  controllerIdentity={screenShareActive ? approvedControllerIdentity : null}
                  onPresenterStop={() => {
                    setIsRemoteControlMode(false);
                    handleRevokeRc(approvedControllerIdentityRef.current);
                  }}
                  onStopControl={() => {
                    setIsRemoteControlMode(false);
                    sendMeetingMsg({
                      type: 'RC_STOP',
                      requesterIdentity: room.localParticipant.identity,
                      requesterName: room.localParticipant.name || room.localParticipant.identity,
                    });
                  }}
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
                aria-label={isWebcamSidebarCollapsed ? t('toolbar.expandWebcams') : t('toolbar.collapseWebcams')}
                aria-expanded={!isWebcamSidebarCollapsed}
                style={
                  isToolbarMobile
                    ? {
                      position: 'fixed',
                      top: 'max(44px, env(safe-area-inset-top, 0px), 7vh)',
                      left: 'max(10px, env(safe-area-inset-left, 0px))',
                      right: 'auto',
                      transform: 'none',
                      zIndex: 15000,
                      background: 'rgba(43, 44, 50, 0.96)',
                      color: 'var(--km-stage-text)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
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
                      left: isWebcamSidebarCollapsed ? 0 : 148,
                      right: 'auto',
                      transform: 'translateY(-50%)',
                      zIndex: 2000,
                      background: 'rgba(43, 44, 50, 0.95)',
                      color: 'var(--km-stage-text)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderLeft: 'none',
                      borderRadius: '0 8px 8px 0',
                      width: '28px',
                      height: '64px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1), background 0.15s ease',
                      boxShadow: '4px 0 12px rgba(0,0,0,0.4)',
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

          {/* Chat / Attendees：移动端沿用侧栏浮层；桌面端由 KloudMeetToolbar 锚点气泡承载 */}
          {chatOpen && isToolbarMobile && (
            <div className="chat-overlay-panel">
              <div className="chat-overlay-header">
                <span>{t('toolbar.chat')}</span>
                <button
                  type="button"
                  className="chat-overlay-close"
                  onClick={() => setChatOpen(false)}
                  aria-label={t('common.close')}
                >
                  ✕
                </button>
              </div>
              <div className="chat-overlay-body">
                {chatPanelNode}
              </div>
            </div>
          )}

          {attendeeOpen && isToolbarMobile && (
            <div className="chat-overlay-panel" style={{ right: chatOpen ? 352 : 16 }}>
              <div className="chat-overlay-header">
                <span>{t('toolbar.peopleAttendees')}</span>
                <button
                  type="button"
                  className="chat-overlay-close"
                  onClick={() => setAttendeeOpen(false)}
                  aria-label={t('common.close')}
                >
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
                  raisedHands={raisedHands}
                  canManageHands={canManageHands}
                  onLowerAllHands={handleLowerAllHands}
                />
              </div>
            </div>
          )}

        </div>

        {/* Captions overlay — visible to all participants when host enables captions */}
        <SpeakWhileMutedPrompt
          visible={speakWhileMutedVisible}
          onDismiss={dismissSpeakWhileMuted}
          onUnmute={() => {
            acceptSpeakWhileMuted();
            handleToggleMic();
          }}
        />
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
                void unlockMobileRoomAudio(room).then((ok) => setCanPlaybackAudio(ok));
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

        <CaptionsOverlay
          captionsInfo={captionsInfo}
          bottomOffset={isToolbarMobile ? 110 : 96}
          readLanguage={captionReadLanguage}
          roomLanguages={captionRoomLanguages}
          onChangeLanguage={setCaptionReadLanguage}
          status={captionStatus}
          onRetry={retryCaptions}
          peerIssues={isHost || isCohost ? peerCaptionIssues : undefined}
        />

        {/* Custom toolbar overlay */}
        <KloudMeetToolbar
          meetingTitle={props.meetingTitle}
          activeView={activeView}
          onViewChange={handleViewChange}
          onExit={handleLeaveWithSave}
          onEndForAll={handleEndForAll}
          micEnabled={micEnabled}
          camEnabled={camEnabled}
          onToggleMic={handleToggleMic}
          onToggleCam={handleToggleCam}
          onShareScreen={handleShareSegment}
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

            // Presenter: toggle local mode; turning off also revokes active controller
            if (screenShareActive) {
              const next = !isRemoteControlMode;
              if (next) {
                setIsDrawingMode(false);
                setIsRemoteControlMode(true);
              } else {
                setIsRemoteControlMode(false);
                if (approvedControllerIdentity) {
                  handleRevokeRc(approvedControllerIdentity);
                }
              }
              return;
            }

            // Viewer: cancel pending request
            if (remoteControlPending) {
              setRemoteControlPending(false);
              sendMeetingMsg({
                type: 'RC_CANCELLED',
                requesterIdentity: room.localParticipant.identity,
                requesterName: room.localParticipant.name || room.localParticipant.identity,
              });
              return;
            }

            // Viewer: stop active control — notify presenter (RC_STOP)
            if (isRemoteControlMode) {
              setIsRemoteControlMode(false);
              sendMeetingMsg({
                type: 'RC_STOP',
                requesterIdentity: room.localParticipant.identity,
                requesterName: room.localParticipant.name || room.localParticipant.identity,
              });
              return;
            }

            // Viewer: request permission
            const presenterTrack = screenShareTracks[0];
            const presenterIdentity = presenterTrack?.participant?.identity;
            if (presenterIdentity) {
              setRemoteControlPending(true);
              setIsDrawingMode(false);
              sendMeetingMsg({
                type: 'RC_REQUEST',
                requesterIdentity: room.localParticipant.identity,
                requesterName: room.localParticipant.name || room.localParticipant.identity,
              });
            }
          }}
          hasScreenShare={hasScreenShare}
          isDesktop={isDesktop}
          canSwitchViews={canSwitchViews}
          designItem={designItem}
          onShowDesign={canSwitchViews ? showDesign : undefined}
          onAddDesignLink={canSwitchViews ? openDesignDialog : undefined}
          webcamLayoutMode={webcamLayoutMode}
          onWebcamLayoutChange={setWebcamLayoutMode}
          galleryPrefs={galleryPrefs}
          onGalleryPrefsChange={handleGalleryPrefsChange}
          canToggleLiveDocAnnotation={canBroadcastViewChange}
          canShowOperatorMenus={canBroadcastViewChange}
          participantLiveDocAi={participantLiveDocAi}
          onPrepareLiveDoc={() => setLivedocHasBeenActivated(true)}
          canEndForAll={isHost || isCohost}
          canRecord={canRecordHere}
          isRecording={isRecording}
          onOpenRecordPopup={() => {
            if (canRecordHere) setShowRecordPopup(true);
          }}
          onStopRecording={() => {
            if (canRecordHere) handleToggleRecording('stop');
          }}
          recordingState={recordingState}
          canChangeRecordingPolicy={isHost}
          onRecordingAction={(action) => void recordingRequest({ action })}
          onRecordingSettings={(patch) => void recordingRequest({ action: 'settings', ...patch })}
          onOpenHelp={() => setShowHelp(true)}
          canMuteAll={isHost || isCohost || isCopresenter || isAutoPresenter}
          muteAllActive={muteAllActive}
          onMuteAll={handleMuteAll}
          onUnmuteAll={handleUnmuteAll}
          handRaised={handRaised}
          onToggleHand={handleToggleHand}
          raisedHandCount={canManageHands ? raisedHands.length : 0}
          onOpenDesktopApp={() => openDesktopEntry('inMeeting')}
          isMutedByHost={isLocalMicRestricted}
          isCamDisabledByHost={isLocalCamRestricted}
          canToggleCaptions={isHost || isCohost}
          captionsEnabled={captionsRunning}
          captionsHealth={peerStateOf(captionStatus)}
          onToggleCaptions={handleToggleCaptions}
          canDocumentPip={
            livekitConnected &&
            (!isDesktop || desktopMiniWindow) &&
            !isToolbarMobile &&
            !isRecorderBot &&
            !meetingEndedByHost &&
            isMiniWindowEligible()
          }
          documentPipEnabled={documentPip.isOpen}
          onToggleDocumentPip={() => {
            if (documentPip.isOpen) {
              documentPip.close();
              return;
            }
            void documentPip.open({ sticky: true });
          }}
          livekitToken={props.connectionDetails.participantToken}
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
            isToolbarMobile ? undefined : chatPanelNode
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
                raisedHands={raisedHands}
                canManageHands={canManageHands}
                onLowerAllHands={handleLowerAllHands}
              />
            )
          }
        />

        {/* --- MODALS --- */}
        <MeetingPipSuggestPrompt
          visible={showPipSuggest}
          attendeeCount={1 + room.remoteParticipants.size}
          onEnable={() => {
            void documentPip.open({ sticky: true });
          }}
        />
        {showMeetingReadyModal && (
          <MeetingReadyModal isDesktop={isDesktop} onClose={() => setShowMeetingReadyModal(false)} />
        )}

        {/* Recording: unified consent dialog — no intermediate page — host/co-host only */}
        {showRecordPopup && canRecordHere && (
          <RecordConsentModal
            mode={recordingState.mode}
            onModeChange={(m) => setRecordingState((st) => ({ ...st, mode: m }))}
            onClose={() => setShowRecordPopup(false)}
            onStart={() => {
              setShowRecordPopup(false);
              handleToggleRecording('start');
            }}
          />
        )}



        {process.env.NODE_ENV === 'development' ? <DebugMode /> : null}
        <RecordingIndicator />
        {!isRecorderBot && acceptsKnocks && (isHost || isCohost) && (
          <JoinRequestsPrompt
            room={room}
            canAdmit
            acceptsKnocks
            refreshRef={joinRequestsRefreshRef}
          />
        )}
        {!isRecorderBot && (
          <MeetingTimeLimitBanner
            meetingEndsAt={props.connectionDetails.meetingEndsAt}
            roomName={props.connectionDetails.roomName}
            isHost={isHost}
          />
        )}
        {desktopLaunchModal}
        <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
        {designDialogOpen && canSwitchViews && (
          <DesignLinkDialog
            currentUrl={designLink?.url}
            appOrigin={typeof window !== 'undefined' ? window.location.origin : ''}
            onSubmit={submitDesignLink}
            checkEmbed={checkDesignEmbed}
            onClose={() => setDesignDialogOpen(false)}
          />
        )}
        </ParticipantRoleMenuProvider>
      </RoomContext.Provider>
    </div>
  );
}
