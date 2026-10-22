'use client';

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MediaDeviceMenu } from '@livekit/components-react';
import styles from '../styles/KloudMeetToolbar.module.css';
import { useToolbarIsMobile } from './useToolbarIsMobile';
import { useI18n, LOCALE_OPTIONS } from './i18n';
import type { Locale } from './i18n';
import { STTSettingsDialog } from './RtasrHelper/STTSettingsDialog';
import { LiveDocAiPanel } from './LiveDocAiPanel';
import { useLiveDocAiBridge } from './useLiveDocAiBridge';

export type ViewMode = 'liveDoc' | 'webcam' | 'shareScreen';
export type WebcamLayoutMode = 'tile' | 'spotlight';

type ChatBubbleRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type ChatBubbleInteraction = {
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  startRect: ChatBubbleRect;
};

const CHAT_BUBBLE_MIN_WIDTH = 300;
const CHAT_BUBBLE_MIN_HEIGHT = 260;
const CHAT_BUBBLE_VIEWPORT_MARGIN = 12;

/** Web：完整页面 URL；Electron 桌面：可唤起本机应用的 kloudmeet 深度链接（含当前查询参数）。 */
export function buildInviteLinkForClipboard(isDesktop: boolean): string {
  if (!isDesktop) {
    return typeof window !== 'undefined' ? window.location.href : '';
  }
  const u = new URL(window.location.href);
  const segments = u.pathname.split('/').filter(Boolean);
  const roomName = segments.pop() || '';
  return `kloudmeet://join/${encodeURIComponent(roomName)}${u.search}`;
}

function roomNameFromLocation(): string {
  if (typeof window === 'undefined') return '';
  const segments = new URL(window.location.href).pathname.split('/').filter(Boolean);
  return segments.pop() || '';
}

/** 会议内「复制邀请」正文（与首页会议卡片的 Copy Invite 结构类似） */
function buildInMeetingInviteClipboardText(isDesktop: boolean): string {
  const roomName = roomNameFromLocation();
  const link = buildInviteLinkForClipboard(isDesktop);
  return [
    'You are invited to a Kloud Meeting',
    '',
    `Meeting ID: ${roomName}`,
    `Join meeting: ${link}`,
    '',
    'Please join a few minutes early to test your audio and video setup.',
  ].join('\n');
}

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
  remoteControlPending?: boolean;
  hasScreenShare: boolean;
  isDesktop: boolean;
  canSwitchViews: boolean;
  /** Webcam 子布局：Tile 宫格 / Spotlight 焦点 */
  webcamLayoutMode?: WebcamLayoutMode;
  onWebcamLayoutChange?: (mode: WebcamLayoutMode) => void;
  /** Host / Co-host / Presenter：可切换 LiveDoc Annotation */
  canToggleLiveDocAnnotation?: boolean;
  /**
   * Host / Co-host / Presenter（含 Co-Presenter）：
   * 协作文档菜单、摄像头视图入口、More→AI演讲 可见；随实时身份变化更新
   */
  canShowOperatorMenus?: boolean;
  /**
   * 普通参会者是否显示文档 AI。主持人和联席身份始终可见。
   * 缺省为显示。
   */
  participantLiveDocAi?: boolean;
  /** 在不切换当前视图的前提下，后台挂载并初始化 LiveDoc iframe */
  onPrepareLiveDoc?: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  attendeeOpen: boolean;
  onToggleAttendee: () => void;
  onOpenSheet?: () => void;
  /** 桌面端：Chat 气泡内容（移动端不传，沿用父级浮层） */
  chatPanelSlot?: React.ReactNode;
  /** 桌面端：Attendees 气泡内容 */
  attendeePanelSlot?: React.ReactNode;
  /** Only host/co-host can end meeting for everyone */
  canEndForAll?: boolean;
  /** Callback to end meeting for all participants (host/co-host only) */
  onEndForAll?: () => void;
  /** Only host/co-host can start/stop recording */
  canRecord?: boolean;
  isRecording?: boolean;
  onOpenRecordPopup?: () => void;
  onStopRecording?: () => void;
  /** Opens the Help modal */
  onOpenHelp?: () => void;
  /** Whether local user can mute/unmute all participants */
  canMuteAll?: boolean;
  /** Whether mute-all is currently active (so button shows unmute state) */
  muteAllActive?: boolean;
  onMuteAll?: () => void;
  onUnmuteAll?: () => void;
  /** Whether the local user's hand is currently raised */
  handRaised?: boolean;
  onToggleHand?: () => void;
  /** Number of raised hands; already zeroed out by the caller for non-managers */
  raisedHandCount?: number;
  /** Whether this local user has been force-muted by the host (distinct from voluntary self-mute) */
  isMutedByHost?: boolean;
  /** Whether this local user's camera was disabled by the host */
  isCamDisabledByHost?: boolean;
  /** Only host/co-host can toggle captions */
  canToggleCaptions?: boolean;
  /** Whether captions are currently active */
  captionsEnabled?: boolean;
  onToggleCaptions?: () => void;
  /** 网页端 Document PiP：本次会议内记住 */
  canDocumentPip?: boolean;
  documentPipEnabled?: boolean;
  onToggleDocumentPip?: () => void;
  onOpenDesktopApp?: () => void;
  /** LiveKit participant JWT，LiveDoc AI Summary 拉取本场聊天 */
  livekitToken?: string;
  /** 桌面底栏左侧显示的会议名称；缺省时回退为 URL 中的房间号 */
  meetingTitle?: string;
  /** 桌面底栏 Chats 角标（未读数）；缺省 / 0 时不显示 */
  chatBadgeCount?: number;
}

/* ───────── Desktop bar icons (Google Meet–style stroke set) ───────── */
const ICON_STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};
const IconMicOn = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
);
const IconMicOff = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><path d="M9 9v2a3 3 0 005 2.2M15 9.3V6a3 3 0 00-5.6-1.5M5 11a7 7 0 0011.5 5.4M19 11a7 7 0 01-.6 2.8M12 18v3M3 3l18 18" /></svg>
);
const IconCamOn = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><rect x="3" y="6" width="12" height="12" rx="3" /><path d="M15 10l6-3v10l-6-3z" /></svg>
);
const IconCamOff = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><path d="M15 10l6-3v10l-6-3M15 13.5V16a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h2M11 6h2a2 2 0 012 2v2M3 3l18 18" /></svg>
);
const IconSpeaker = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><path d="M11 5L6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" /></svg>
);
const IconChevronUp = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE} strokeWidth={2.4}><path d="M18 15l-6-6-6 6" /></svg>
);
const IconDoc = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>
);
const IconTile = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></svg>
);
const IconSpotlight = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><rect x="3" y="5" width="12" height="14" rx="2" /><rect x="17" y="5" width="4" height="3.5" rx="0.8" /><rect x="17" y="10.25" width="4" height="3.5" rx="0.8" /><rect x="17" y="15.5" width="4" height="3.5" rx="0.8" /></svg>
);
const IconShareScreen = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><rect x="3" y="4" width="18" height="13" rx="3" /><path d="M8 21h8M12 17v4M12 7v6M9 10l3-3 3 3" /></svg>
);
const IconHand = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><path d="M8 13V5.5a1.5 1.5 0 013 0V11M11 10V4.5a1.5 1.5 0 013 0V11M14 10.5V6a1.5 1.5 0 013 0v7.5a7 7 0 01-7 7h-.5A6.5 6.5 0 013 14l-.5-1.2a1.5 1.5 0 012.6-1.5L8 15" /></svg>
);
const IconDots = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="12" cy="19" r="1.9" /></svg>
);
const IconHangUp = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 010-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85a1 1 0 01-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" /></svg>
);
const IconDocAi = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h5M14 3v6h6v2" /><path d="M17 14l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1z" /></svg>
);
const IconPeople = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14a6.5 6.5 0 013.5 6" /></svg>
);
const IconChat = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" /></svg>
);
const IconLink = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></svg>
);
const IconSmartCam = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><rect x="3" y="5" width="18" height="14" rx="3" /><rect x="12" y="11" width="7" height="6" rx="1.5" /></svg>
);
const IconPen = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><path d="M16.86 4.49l1.69-1.69a1.88 1.88 0 112.65 2.65L6.83 19.82a4.5 4.5 0 01-1.9 1.13l-2.68.8.8-2.68a4.5 4.5 0 011.13-1.9L16.86 4.49z" /></svg>
);
const IconCursor = () => (
  <svg viewBox="0 0 24 24" {...ICON_STROKE}><path d="M15.04 21.67L13.68 16.6m0 0l-2.51 2.23.57-9.47 5.23 7.92-3.29-.67zM7.52 15.32A8.25 8.25 0 1120.25 10.5M8.29 14.21A5.25 5.25 0 1117.25 10.5" /></svg>
);

export function KloudMeetToolbar({
  activeView,
  onViewChange,
  onExit,
  onEndForAll,
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
  remoteControlPending,
  hasScreenShare,
  isDesktop,
  canSwitchViews,
  webcamLayoutMode: webcamLayoutModeProp,
  onWebcamLayoutChange,
  canToggleLiveDocAnnotation = false,
  canShowOperatorMenus = false,
  participantLiveDocAi = true,
  onPrepareLiveDoc,
  chatOpen,
  onToggleChat,
  attendeeOpen,
  onToggleAttendee,
  onOpenSheet,
  chatPanelSlot,
  attendeePanelSlot,
  canEndForAll,
  canRecord = false,
  isRecording,
  onOpenRecordPopup,
  onStopRecording,
  onOpenHelp,
  canMuteAll,
  muteAllActive,
  onMuteAll,
  onUnmuteAll,
  handRaised = false,
  onToggleHand,
  raisedHandCount = 0,
  isMutedByHost,
  isCamDisabledByHost,
  canToggleCaptions,
  captionsEnabled,
  onToggleCaptions,
  canDocumentPip = false,
  documentPipEnabled = false,
  onToggleDocumentPip,
  onOpenDesktopApp,
  livekitToken = '',
  meetingTitle,
  chatBadgeCount = 0,
}: KloudMeetToolbarProps) {
  const [visible, setVisible] = useState(true);
  const { t } = useI18n();
  /** 新增文案在 locale 文件补齐前回退到英文，避免直接显示 key */
  const tr = React.useCallback(
    (key: string, fallback: string) => {
      const v = t(key);
      return v === key ? fallback : v;
    },
    [t],
  );
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inviteMenuOpen, setInviteMenuOpen] = useState(false);
  const [viewModeMenuOpen, setViewModeMenuOpen] = useState(false);
  /** 未受控时本地兜底；父级传入 webcamLayoutMode 时以父级为准 */
  const [webcamLayoutModeLocal, setWebcamLayoutModeLocal] = useState<WebcamLayoutMode>('tile');
  const webcamLayoutMode = webcamLayoutModeProp ?? webcamLayoutModeLocal;
  const setWebcamLayoutMode = (mode: WebcamLayoutMode) => {
    setWebcamLayoutModeLocal(mode);
    onWebcamLayoutChange?.(mode);
  };
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const moreMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const recordMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const exitMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const chatMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const attendeeMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const liveDocAiBtnRef = useRef<HTMLButtonElement | null>(null);
  const desktopBubbleRef = useRef<HTMLDivElement | null>(null);

  type BubblePos = {
    top: number;
    left: number;
    width: number;
    arrowLeft: number;
    maxHeight: number;
    /** 桌面端 Chat/Attendees：默认固定高度（空间不足则取可用高度） */
    height?: number;
  };
  const [desktopBubblePos, setDesktopBubblePos] = useState<BubblePos | null>(null);
  const [chatBubbleRect, setChatBubbleRect] = useState<ChatBubbleRect | null>(null);
  const [isChatBubbleInteracting, setIsChatBubbleInteracting] = useState(false);
  const chatBubbleInteractionRef = useRef<ChatBubbleInteraction | null>(null);
  const chatBubbleRectRef = useRef<ChatBubbleRect | null>(null);
  chatBubbleRectRef.current = chatBubbleRect;

  type ActionSheetType = 'views' | 'more' | 'exit' | 'recording' | 'speaker' | null;
  const [activeSheet, setActiveSheet] = useState<ActionSheetType>(null);
  const activeSheetRef = useRef<ActionSheetType>(null);
  activeSheetRef.current = activeSheet;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const attendeeOpenRef = useRef(attendeeOpen);
  attendeeOpenRef.current = attendeeOpen;
  const lastPointerClientYRef = useRef(0);
  const lastPointerClientXRef = useRef(0);
  const desktopAutoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 父页自行隐藏底栏（如离开 3s）后，与插件 chrome 状态可能短暂不同步 */
  const parentOnlyHiddenRef = useRef(false);
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
  const inviteMenuOpenRef = useRef(inviteMenuOpen);
  inviteMenuOpenRef.current = inviteMenuOpen;
  const isMobile = useToolbarIsMobile();
  const [showSTTSettings, setShowSTTSettings] = useState(false);
  const [sttSettingsTab, setSttSettingsTab] = useState<'my' | 'defaults'>('my');
  const [localSubtitleVisible, setLocalSubtitleVisible] = useState(true);
  const [liveDocPluginLoaded, setLiveDocPluginLoaded] = useState(false);
  const [liveDocActionDialogVisible, setLiveDocActionDialogVisible] = useState(false);
  const [liveDocMenuVisible, setLiveDocMenuVisible] = useState(false);
  const [liveDocAnnotationEnabled, setLiveDocAnnotationEnabled] = useState(true);
  /** LiveDoc SyncPlayer / AI Present 播放中：禁用底栏 catch 层，避免挡住 #syncplayer */
  const [syncPlayerActive, setSyncPlayerActive] = useState(false);
  const syncPlayerActiveRef = useRef(false);
  syncPlayerActiveRef.current = syncPlayerActive;
  const [liveDocBubblePos, setLiveDocBubblePos] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    arrowLeft: number;
  } | null>(null);
  const liveDocAiBridge = useLiveDocAiBridge(liveDocMenuVisible);
  const closeLiveDocAiMenu = React.useCallback(() => setLiveDocMenuVisible(false), []);

  const clampChatBubbleRect = React.useCallback((rect: ChatBubbleRect): ChatBubbleRect => {
    if (typeof window === 'undefined') return rect;

    const maxWidth = Math.max(CHAT_BUBBLE_MIN_WIDTH, window.innerWidth - CHAT_BUBBLE_VIEWPORT_MARGIN * 2);
    const maxHeight = Math.max(CHAT_BUBBLE_MIN_HEIGHT, window.innerHeight - CHAT_BUBBLE_VIEWPORT_MARGIN * 2);
    const width = Math.min(maxWidth, Math.max(CHAT_BUBBLE_MIN_WIDTH, rect.width));
    const height = Math.min(maxHeight, Math.max(CHAT_BUBBLE_MIN_HEIGHT, rect.height));
    const left = Math.min(
      Math.max(CHAT_BUBBLE_VIEWPORT_MARGIN, rect.left),
      Math.max(CHAT_BUBBLE_VIEWPORT_MARGIN, window.innerWidth - width - CHAT_BUBBLE_VIEWPORT_MARGIN),
    );
    const top = Math.min(
      Math.max(CHAT_BUBBLE_VIEWPORT_MARGIN, rect.top),
      Math.max(CHAT_BUBBLE_VIEWPORT_MARGIN, window.innerHeight - height - CHAT_BUBBLE_VIEWPORT_MARGIN),
    );

    return { top, left, width, height };
  }, []);

  useEffect(() => {
    parentOnlyHiddenRef.current = false;
    setSyncPlayerActive(false);
    syncPlayerActiveRef.current = false;
    setVisible(true);
  }, [activeView]);

  useEffect(() => {
    if (!chatOpen) {
      setChatBubbleRect(null);
      chatBubbleInteractionRef.current = null;
      setIsChatBubbleInteracting(false);
    }
  }, [chatOpen]);

  const clearDesktopToolbarAutoHide = React.useCallback(() => {
    if (desktopAutoHideTimerRef.current) {
      clearTimeout(desktopAutoHideTimerRef.current);
      desktopAutoHideTimerRef.current = null;
    }
  }, []);

  const scheduleDesktopToolbarAutoHide = React.useCallback(() => {
    if (isMobile) return;
    if (
      activeSheetRef.current ||
      chatOpenRef.current ||
      attendeeOpenRef.current ||
      inviteMenuOpenRef.current
    ) {
      return;
    }
    clearDesktopToolbarAutoHide();
    desktopAutoHideTimerRef.current = setTimeout(() => {
      desktopAutoHideTimerRef.current = null;
      if (
        activeSheetRef.current ||
        chatOpenRef.current ||
        attendeeOpenRef.current ||
        inviteMenuOpenRef.current
      ) {
        return;
      }
      if (visibleRef.current) {
        parentOnlyHiddenRef.current = true;
      }
      setVisible(false);
    }, 3000);
  }, [isMobile, clearDesktopToolbarAutoHide]);

  const revealToolbar = () => {
    // Sync/AI Present：底栏盖住 #syncplayer，禁止唤出
    if (syncPlayerActiveRef.current) return;
    clearDesktopToolbarAutoHide();
    parentOnlyHiddenRef.current = false;
    setVisible(true);
  };

  const isRelatedChromeTarget = React.useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return !!(
      toolbarRef.current?.contains(target) ||
      desktopBubbleRef.current?.contains(target) ||
      target.closest?.('.lk-device-menu, .lk-menu, .kloud-modal')
    );
  }, []);

  const handleToolbarMouseEnter = () => {
    if (isMobile) return;
    clearDesktopToolbarAutoHide();
  };

  const handleToolbarMouseLeave = (e: React.MouseEvent) => {
    if (isMobile) return;
    if (isRelatedChromeTarget(e.relatedTarget)) return;
    scheduleDesktopToolbarAutoHide();
  };

  useEffect(() => {
    if (isMobile) return;
    if (activeSheet || chatOpen || attendeeOpen || inviteMenuOpen) {
      clearDesktopToolbarAutoHide();
    }
  }, [isMobile, activeSheet, chatOpen, attendeeOpen, inviteMenuOpen, clearDesktopToolbarAutoHide]);

  useEffect(() => () => clearDesktopToolbarAutoHide(), [clearDesktopToolbarAutoHide]);

  const getBottomNavZoneHeightPx = React.useCallback((): number => {
    const toolbarEl = toolbarRef.current;
    if (toolbarEl) {
      const h = toolbarEl.offsetHeight;
      if (h > 0) return h + 4;
    }
    return 80;
  }, []);

  const isClientYInBottomNavZone = React.useCallback(
    (clientY: number): boolean => {
      if (typeof window === 'undefined') return false;
      return clientY >= window.innerHeight - getBottomNavZoneHeightPx();
    },
    [getBottomNavZoneHeightPx],
  );

  useEffect(() => {
    const trackPointerY = (e: PointerEvent | TouchEvent | MouseEvent) => {
      if ('clientY' in e && typeof e.clientY === 'number') {
        lastPointerClientYRef.current = e.clientY;
        if ('clientX' in e && typeof e.clientX === 'number') {
          lastPointerClientXRef.current = e.clientX;
        }
        return;
      }
      if ('touches' in e && e.touches[0]) {
        lastPointerClientYRef.current = e.touches[0].clientY;
        lastPointerClientXRef.current = e.touches[0].clientX;
      }
    };
    window.addEventListener('pointerdown', trackPointerY, true);
    window.addEventListener('touchstart', trackPointerY, true);
    return () => {
      window.removeEventListener('pointerdown', trackPointerY, true);
      window.removeEventListener('touchstart', trackPointerY, true);
    };
  }, []);

  useEffect(() => {
    if (isMobile) return;
    const hoverSel = `.${styles.hoverZone}`;
    const chevronSel = `.${styles.chevronHandle}`;
    const tryReveal = (el?: EventTarget | null) => {
      if (visibleRef.current || syncPlayerActiveRef.current) return true;
      const hit =
        (el instanceof Element && (el.closest(hoverSel) || el.closest(chevronSel))) ||
        !!document.querySelector(hoverSel)?.matches(':hover') ||
        !!document.querySelector(chevronSel)?.matches(':hover');
      if (!hit) return false;
      parentOnlyHiddenRef.current = false;
      setVisible(true);
      return true;
    };
    const onMove = (e: MouseEvent) => {
      lastPointerClientXRef.current = e.clientX;
      lastPointerClientYRef.current = e.clientY;
      tryReveal(e.target);
    };
    let poll = 0;
    const stopPoll = () => {
      if (!poll) return;
      window.clearInterval(poll);
      poll = 0;
    };
    const onBlur = () => {
      stopPoll();
      poll = window.setInterval(() => {
        if (document.hasFocus() || tryReveal()) stopPoll();
      }, 100);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('pointerover', onMove, { capture: true, passive: true });
    window.addEventListener('focus', stopPoll);
    window.addEventListener('blur', onBlur);
    return () => {
      stopPoll();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointerover', onMove, true);
      window.removeEventListener('focus', stopPoll);
      window.removeEventListener('blur', onBlur);
    };
  }, [isMobile]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('kloud-stt-settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.subtitleVisible === 'boolean') {
          setLocalSubtitleVisible(parsed.subtitleVisible);
        }
      } else {
        setLocalSubtitleVisible(true);
      }
    } catch (e) {}

    const handleSettingsChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && typeof customEvent.detail.subtitleVisible === 'boolean') {
        setLocalSubtitleVisible(customEvent.detail.subtitleVisible);
      }
    };
    window.addEventListener('kloud-stt-settings-changed', handleSettingsChange);
    return () => window.removeEventListener('kloud-stt-settings-changed', handleSettingsChange);
  }, []);

  const closeInviteMenu = () => setInviteMenuOpen(false);
  const closeViewModeMenu = () => setViewModeMenuOpen(false);

  /* 桌面底栏左侧：时钟 | 会议名称（客户端挂载后再填，避免 SSR 水合不一致） */
  const [clockText, setClockText] = useState('');
  const [roomCode, setRoomCode] = useState('');
  useEffect(() => {
    if (isMobile) return;
    setRoomCode(roomNameFromLocation());
    const tick = () => {
      try {
        setClockText(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      } catch {
        setClockText('');
      }
    };
    tick();
    const id = window.setInterval(tick, 15000);
    return () => window.clearInterval(id);
  }, [isMobile]);
  const meetingLabel = (meetingTitle && meetingTitle.trim()) || roomCode;

  /* 桌面：Esc 关闭底栏自身的菜单（More / Exit / Recording / 邀请 / 摄像头布局） */
  useEffect(() => {
    if (isMobile) return;
    if (!inviteMenuOpen && !viewModeMenuOpen && !activeSheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setInviteMenuOpen(false);
      setViewModeMenuOpen(false);
      setActiveSheet(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobile, inviteMenuOpen, viewModeMenuOpen, activeSheet]);

  const showInviteToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000);
  };

  // Synchronous wrapper: close Chat/Attendee BEFORE opening a sheet
  const openSheet = (sheet: ActionSheetType) => {
    closeInviteMenu();
    closeViewModeMenu();
    setLiveDocMenuVisible(false);
    if (sheet !== null) {
      onOpenSheet?.(); // closes Chat & Attendee in parent synchronously
    }
    setActiveSheet(sheet);
  };

  const handleToggleChat = () => {
    closeInviteMenu();
    closeViewModeMenu();
    setLiveDocMenuVisible(false);
    setActiveSheet(null); // close any open sheet
    onToggleChat();
  };

  const handleToggleAttendee = () => {
    closeInviteMenu();
    closeViewModeMenu();
    setLiveDocMenuVisible(false);
    setActiveSheet(null); // close any open sheet
    onToggleAttendee();
  };

  useEffect(() => {
    if (!visible) closeViewModeMenu();
  }, [visible]);

  useEffect(() => {
    if (!inviteMenuOpen) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-invite-menu-anchor="true"]')) {
        setInviteMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [inviteMenuOpen]);

  useEffect(() => {
    if (!viewModeMenuOpen) return;
    const onDocPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-view-mode-menu-anchor="true"]')) {
        setViewModeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocPointerDown);
    document.addEventListener('touchstart', onDocPointerDown);
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown);
      document.removeEventListener('touchstart', onDocPointerDown);
    };
  }, [viewModeMenuOpen]);

  const canUseMediaDevices =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia;
  const canEnumerateDevices =
    canUseMediaDevices && !!navigator.mediaDevices?.enumerateDevices;
  const [mobileAudioState, setMobileAudioState] = useState<'earpiece' | 'bluetooth' | 'speaker'>('speaker');

  type DesktopAnchorKind = 'more' | 'exit' | 'chat' | 'attendee' | 'recording';
  const desktopAnchorBubbleKind: DesktopAnchorKind | null =
    !isMobile
      ? activeSheet === 'recording'
        ? 'recording'
        : activeSheet === 'more'
          ? 'more'
          : activeSheet === 'exit'
            ? 'exit'
            : chatOpen && chatPanelSlot
              ? 'chat'
              : attendeeOpen && attendeePanelSlot
                ? 'attendee'
                : null
      : null;

  useEffect(() => {
    if (!isMobile) return;
    // LiveDoc iframe drives chrome via Kloud-onMouseClick (200ms debounce in plugin).
    if (activeView === 'liveDoc') return;

    // Mobile webcam / screen share: tap blank area to hide toolbar + overlays (like LiveDoc).
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTouchTime = 0;

    const startTimer = () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        setVisible(false);
      }, 30000);
    };

    if (visible) {
      startTimer();
    } else if (hideTimer) {
      clearTimeout(hideTimer);
    }

    const isChromeTarget = (target: Element) => !!(
      toolbarRef.current?.contains(target) ||
      target.closest?.('#mobileTopRightBtn') ||
      target.closest?.('.lk-device-menu') ||
      target.closest?.('.lk-menu') ||
      target.closest?.('.chat-overlay-panel') ||
      target.closest?.('.floating-webcam-panel') ||
      target.closest?.(`.${styles.actionSheetOverlay}`) ||
      target.closest?.(`.${styles.actionSheet}`) ||
      target.closest?.('.kloud-modal')
    );

    const isInteractiveVideoTarget = (target: Element) => !!(
      target.closest?.(
        'button, a, input, select, textarea, .kloud-custom-mic-indicator, .kloud-custom-cam-indicator',
      )
    );

    const hideMobileChrome = () => {
      if (attendeeOpenRef.current) handleToggleAttendee();
      if (activeSheetRef.current) setActiveSheet(null);
      closeInviteMenu();
      closeViewModeMenu();
      setVisible(false);
    };

    const handleMobileBlankTap = (target: Element, clientY?: number) => {
      // 底部导航栏区域：不触发空白点击显隐（只能点向上按钮或底栏上方空白区）
      const y = typeof clientY === 'number' ? clientY : lastPointerClientYRef.current;
      if (isClientYInBottomNavZone(y)) {
        return;
      }

      if (isChromeTarget(target) || isInteractiveVideoTarget(target)) {
        if (visibleRef.current) startTimer();
        return;
      }

      if (!visibleRef.current) {
        setVisible(true);
        return;
      }

      hideMobileChrome();
    };

    const handleBodyClick = (e: MouseEvent | TouchEvent | PointerEvent) => {
      if (e.type === 'touchstart') {
        lastTouchTime = Date.now();
      } else if (e.type === 'click') {
        if (Date.now() - lastTouchTime < 1000) {
          return;
        }
      }

      let clientY: number | undefined;
      if ('clientY' in e && typeof e.clientY === 'number') {
        clientY = e.clientY;
      } else if ('touches' in e && e.touches[0]) {
        clientY = e.touches[0].clientY;
      }

      handleMobileBlankTap(e.target as Element, clientY);
    };

    const handleBlankTapEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ target?: Element; clientY?: number }>).detail;
      handleMobileBlankTap(
        detail?.target ?? (document.body as Element),
        detail?.clientY,
      );
    };

    const attachVideoWrapper = () => {
      const wrapper = document.querySelector('.sky-meet-video-wrapper');
      if (!wrapper) return undefined;
      const handler = (e: Event) => handleBodyClick(e as PointerEvent);
      wrapper.addEventListener('pointerdown', handler, { capture: true });
      return () => wrapper.removeEventListener('pointerdown', handler, { capture: true });
    };

    window.addEventListener('kloud-mobile-blank-tap', handleBlankTapEvent);
    document.addEventListener('click', handleBodyClick, { capture: true });
    document.addEventListener('touchstart', handleBodyClick, { capture: true, passive: true });
    document.addEventListener('pointerdown', handleBodyClick, { capture: true });

    let detachVideoWrapper = attachVideoWrapper();
    const attachTimer = window.setTimeout(() => {
      detachVideoWrapper?.();
      detachVideoWrapper = attachVideoWrapper();
    }, 400);

    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      window.clearTimeout(attachTimer);
      detachVideoWrapper?.();
      window.removeEventListener('kloud-mobile-blank-tap', handleBlankTapEvent);
      document.removeEventListener('click', handleBodyClick, { capture: true });
      document.removeEventListener('touchstart', handleBodyClick, { capture: true });
      document.removeEventListener('pointerdown', handleBodyClick, { capture: true });
    };
  }, [isMobile, activeView, visible, chatOpen, attendeeOpen, activeSheet, inviteMenuOpen, isClientYInBottomNavZone]);

  // LiveDoc iframe click toggles toolbar (desktop + mobile when in iframe).
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data;
      const msgType =
        typeof payload === 'object' && payload !== null && 'type' in payload
          ? String((payload as { type?: unknown }).type ?? '')
          : '';

      if (msgType === 'Kloud-SyncPlayerActive') {
        const data =
          typeof payload === 'object' && payload !== null && 'data' in payload
            ? (payload as { data?: { active?: unknown } }).data
            : null;
        const active = data?.active === 1 || data?.active === true;
        setSyncPlayerActive(active);
        syncPlayerActiveRef.current = active;
        if (active) {
          parentOnlyHiddenRef.current = false;
          clearDesktopToolbarAutoHide();
          setVisible(false);
        }
        return;
      }

      if (msgType === 'Kloud-onMouseClick') {
        const data =
          typeof payload === 'object' && payload !== null && 'data' in payload
            ? (payload as { data?: { show?: unknown } }).data
            : null;
        let show = data?.show === 1 || data?.show === true;

        // SyncPlayer 播放中：始终压住底栏，且不要被 parentOnlyHidden 改判为显示
        if (syncPlayerActiveRef.current) {
          parentOnlyHiddenRef.current = false;
          setVisible(false);
          return;
        }

        // 父页曾单独隐藏底栏（离开 3s）时，插件仍认为可见，空白点击会先发 show:0。
        // 改判为显示，保留点击空白显隐（不改插件）。
        if (!show && parentOnlyHiddenRef.current) {
          show = true;
        }
        parentOnlyHiddenRef.current = false;

        setVisible(show);
        if (show) {
          clearDesktopToolbarAutoHide();
        }
        return;
      }

      // LiveDoc iframe：仅中间向上图标附近才唤出底栏
      if (msgType === 'mousemove') {
        if (isMobile) return;
        if (syncPlayerActiveRef.current) return;
        const data =
          typeof payload === 'object' && payload !== null && 'data' in payload
            ? (payload as { data?: { showBottomToolbar?: unknown } }).data
            : null;
        const showBottomToolbar =
          typeof data === 'object' &&
          data !== null &&
          'showBottomToolbar' in data &&
          !!(data as { showBottomToolbar?: unknown }).showBottomToolbar;
        if (showBottomToolbar) {
          clearDesktopToolbarAutoHide();
          parentOnlyHiddenRef.current = false;
          setVisible(true);
        }
        return;
      }

      if (msgType === 'onkloudloaded') {
        setLiveDocPluginLoaded(true);
        return;
      }

      if (msgType === 'showAnnotationPanel') {
        const status =
          typeof payload === 'object' && payload !== null && 'status' in payload
            ? (payload as { status?: unknown }).status
            : null;
        setLiveDocAnnotationEnabled(status === 1 || status === true);
        return;
      }

      if (msgType === 'onKloudActionDialogVisibleChange') {
        const data =
          typeof payload === 'object' && payload !== null && 'data' in payload
            ? (payload as { data?: { show?: number } }).data
            : null;
        setLiveDocActionDialogVisible(data?.show === 1);
        return;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isMobile, clearDesktopToolbarAutoHide]);

  const canOpenLiveDocAi = canShowOperatorMenus || participantLiveDocAi;

  // 普通参会者被隐藏文档 AI，或失去操作者身份且会议不允许时，关掉面板
  useEffect(() => {
    if (canOpenLiveDocAi) return;
    setLiveDocMenuVisible(false);
    if (!liveDocActionDialogVisible) return;
    const iframe =
      (document.getElementById('sharedIframePlayer') as HTMLIFrameElement | null)
      ?? document.querySelector<HTMLIFrameElement>('iframe[title="LiveDoc"]');
    iframe?.contentWindow?.postMessage({ type: 'Kloud-ToggleDocPopup', show: 0 }, '*');
    setLiveDocActionDialogVisible(false);
  }, [canOpenLiveDocAi, liveDocActionDialogVisible]);

  useLayoutEffect(() => {
    if (!liveDocMenuVisible) {
      setLiveDocBubblePos(null);
      return;
    }
    const anchorEl = liveDocAiBtnRef.current;
    if (!anchorEl) {
      setLiveDocBubblePos(null);
      return;
    }

    const layout = () => {
      const r = anchorEl.getBoundingClientRect();
      const width = Math.min(560, Math.max(320, window.innerWidth - 24));
      const availableHeight = Math.max(280, r.top - 16);
      const height = Math.min(520, Math.floor(availableHeight));
      const cx = r.left + r.width / 2;
      let left = cx - width / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
      const arrowLeft = Math.round(Math.min(width - 18, Math.max(18, cx - left)));
      let top = r.top - height - 12;
      if (top < 10) top = 10;
      setLiveDocBubblePos({ top, left, width, height, arrowLeft });
    };

    layout();
    window.addEventListener('resize', layout);
    return () => window.removeEventListener('resize', layout);
  }, [liveDocMenuVisible, visible, isMobile]);

  // 失去 host/co-host 时关闭录制菜单
  useEffect(() => {
    if (canRecord || activeSheet !== 'recording') return;
    setActiveSheet(null);
  }, [canRecord, activeSheet]);

  useLayoutEffect(() => {
    if (!desktopAnchorBubbleKind || isMobile) {
      setDesktopBubblePos(null);
      return;
    }
    const anchorEl =
      desktopAnchorBubbleKind === 'recording'
        ? recordMenuBtnRef.current
        : desktopAnchorBubbleKind === 'more'
          ? moreMenuBtnRef.current
          : desktopAnchorBubbleKind === 'exit'
            ? exitMenuBtnRef.current
            : desktopAnchorBubbleKind === 'chat'
              ? chatMenuBtnRef.current
              : attendeeMenuBtnRef.current;
    if (!anchorEl) {
      setDesktopBubblePos(null);
      return;
    }

    const isPanel = desktopAnchorBubbleKind === 'chat' || desktopAnchorBubbleKind === 'attendee';
    const width = isPanel
      ? Math.min(400, Math.max(300, window.innerWidth - 24))
      : Math.min(300, Math.max(240, window.innerWidth - 24));

    let pass = 0;
    const layout = () => {
      const r = anchorEl.getBoundingClientRect();
      const availableHeight = Math.max(240, r.top - 24);
      // more/exit/recording：用满按钮上方可用高度，内容够则不出现滚动条
      const preferredMaxHeight =
        desktopAnchorBubbleKind === 'chat' || desktopAnchorBubbleKind === 'attendee'
          ? 500
          : availableHeight;
      const maxHeight = Math.min(preferredMaxHeight, Math.floor(availableHeight));
      const height = isPanel ? maxHeight : undefined;
      const cx = r.left + r.width / 2;
      let left = cx - width / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
      const arrowLeft = Math.round(Math.min(width - 18, Math.max(18, cx - left)));
      const el = desktopBubbleRef.current;
      const h = el?.getBoundingClientRect().height || (isPanel ? 400 : 268);
      // Panel：使用固定高度，永远向上生长（底部贴着按钮）
      // Non-panel：根据真实内容高度向上定位，并受 maxHeight 限制
      let top = r.top - (isPanel ? maxHeight : Math.min(h, maxHeight)) - 12;
      if (top < 10) top = 10;
      setDesktopBubblePos({ top, left, width, arrowLeft, maxHeight, height });
      pass++;
      if (pass < 2) requestAnimationFrame(layout);
    };

    layout();
  }, [desktopAnchorBubbleKind, isMobile, visible, chatOpen, attendeeOpen, inviteMenuOpen, activeView]);

  useEffect(() => {
    if (!desktopAnchorBubbleKind || isMobile) return;
    const anchorEl =
      desktopAnchorBubbleKind === 'recording'
        ? recordMenuBtnRef.current
        : desktopAnchorBubbleKind === 'more'
          ? moreMenuBtnRef.current
          : desktopAnchorBubbleKind === 'exit'
            ? exitMenuBtnRef.current
            : desktopAnchorBubbleKind === 'chat'
              ? chatMenuBtnRef.current
              : attendeeMenuBtnRef.current;
    const isPanel = desktopAnchorBubbleKind === 'chat' || desktopAnchorBubbleKind === 'attendee';
    const width = isPanel
      ? Math.min(400, Math.max(300, window.innerWidth - 24))
      : Math.min(300, Math.max(240, window.innerWidth - 24));
    const onResize = () => {
      if (!anchorEl) return;
      const r = anchorEl.getBoundingClientRect();
      const availableHeight = Math.max(240, r.top - 24);
      const preferredMaxHeight =
        desktopAnchorBubbleKind === 'chat' || desktopAnchorBubbleKind === 'attendee'
          ? 500
          : availableHeight;
      const maxHeight = Math.min(preferredMaxHeight, Math.floor(availableHeight));
      const height = isPanel ? maxHeight : undefined;
      const cx = r.left + r.width / 2;
      let left = cx - width / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
      const arrowLeft = Math.round(Math.min(width - 18, Math.max(18, cx - left)));
      const el = desktopBubbleRef.current;
      const h = el?.getBoundingClientRect().height || (isPanel ? 400 : 268);
      let top = r.top - (isPanel ? maxHeight : Math.min(h, maxHeight)) - 12;
      if (top < 10) top = 10;
      setDesktopBubblePos({ top, left, width, arrowLeft, maxHeight, height });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [desktopAnchorBubbleKind, isMobile]);

  useEffect(() => {
    if (!chatBubbleRect || isMobile) return;
    const onResize = () => setChatBubbleRect((rect) => (rect ? clampChatBubbleRect(rect) : rect));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [chatBubbleRect, clampChatBubbleRect, isMobile]);

  useEffect(() => {
    if (!isChatBubbleInteracting) return;

    const onPointerMove = (event: PointerEvent) => {
      const interaction = chatBubbleInteractionRef.current;
      if (!interaction) return;

      const dx = event.clientX - interaction.startX;
      const dy = event.clientY - interaction.startY;
      const next =
        interaction.mode === 'move'
          ? {
            ...interaction.startRect,
            left: interaction.startRect.left + dx,
            top: interaction.startRect.top + dy,
          }
          : {
            ...interaction.startRect,
            width: interaction.startRect.width + dx,
            height: interaction.startRect.height + dy,
          };

      setChatBubbleRect(clampChatBubbleRect(next));
    };

    const onPointerUp = () => {
      chatBubbleInteractionRef.current = null;
      setIsChatBubbleInteracting(false);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp, { once: true });
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };
  }, [clampChatBubbleRect, isChatBubbleInteracting]);

  const getCurrentChatBubbleRect = React.useCallback((): ChatBubbleRect | null => {
    if (chatBubbleRectRef.current) return chatBubbleRectRef.current;
    if (!desktopBubblePos) return null;
    return {
      top: desktopBubblePos.top,
      left: desktopBubblePos.left,
      width: desktopBubblePos.width,
      height: desktopBubblePos.height ?? Math.min(500, desktopBubblePos.maxHeight),
    };
  }, [desktopBubblePos]);

  const beginChatBubbleInteraction = React.useCallback(
    (event: React.PointerEvent, mode: ChatBubbleInteraction['mode']) => {
      if (desktopAnchorBubbleKind !== 'chat') return;
      const startRect = getCurrentChatBubbleRect();
      if (!startRect) return;

      event.preventDefault();
      event.stopPropagation();
      const clampedStartRect = clampChatBubbleRect(startRect);
      chatBubbleInteractionRef.current = {
        mode,
        startX: event.clientX,
        startY: event.clientY,
        startRect: clampedStartRect,
      };
      setChatBubbleRect(clampedStartRect);
      setIsChatBubbleInteracting(true);
    },
    [clampChatBubbleRect, desktopAnchorBubbleKind, getCurrentChatBubbleRect],
  );

  const handleShareScreenClick = () => {
    onShareScreen();
  };

  const handleLiveDocSettingsClick = () => {
    if (!canOpenLiveDocAi) {
      showInviteToast(t('toolbar.liveDocAiNoPermission'));
      return;
    }
    onPrepareLiveDoc?.();
    const nextVisible = !liveDocMenuVisible;
    setLiveDocMenuVisible(nextVisible);
    if (!nextVisible) return;

    setActiveSheet(null);
    setInviteMenuOpen(false);
    // 原生气泡打开时收起 iframe 内旧弹框，避免切回 LiveDoc 后出现双层菜单。
    const iframe =
      (document.getElementById('sharedIframePlayer') as HTMLIFrameElement | null)
      ?? document.querySelector<HTMLIFrameElement>('iframe[title="LiveDoc"]');
    iframe?.contentWindow?.postMessage({ type: 'Kloud-ToggleDocPopup', show: 0 }, '*');
    setLiveDocActionDialogVisible(false);
  };

  const handleLiveDocDocumentOpen = (itemId: number) => {
    void liveDocAiBridge.sendAction('document.switch', { itemId }).catch(() => undefined);
    setLiveDocMenuVisible(false);
    onViewChange('liveDoc');
  };

  const postSetLiveDocAnnotation = (enabled: boolean) => {
    setLiveDocAnnotationEnabled(enabled);
    const iframe =
      (document.getElementById('sharedIframePlayer') as HTMLIFrameElement | null)
      ?? document.querySelector<HTMLIFrameElement>('iframe[title="LiveDoc"]');
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      { type: 'showAnnotationPanel', status: enabled ? 1 : 0 },
      '*',
    );
  };

  const handleLiveDocAnnotationBadgeClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canToggleLiveDocAnnotation || !liveDocPluginLoaded) return;
    postSetLiveDocAnnotation(!liveDocAnnotationEnabled);
  };

  const handleLiveDocTabClick = () => {
    // 仅切换到协作文档视图；不再弹菜单、不向 iframe 发 ToggleDocPopup
    if (activeView === 'liveDoc') {
      return;
    }
    onViewChange('liveDoc');
  };

  const handleWebcamLayoutSelect = (layout: 'tile' | 'spotlight') => {
    if (!canSwitchViews) return;
    setWebcamLayoutMode(layout);
    onViewChange('webcam');
    closeViewModeMenu();
  };

  /** Web 桌面：摄像头按钮点击切换宫格/焦点，不弹菜单 */
  const handleDesktopWebcamClick = () => {
    closeInviteMenu();
    setActiveSheet(null);
    closeViewModeMenu();
    if (!canSwitchViews) return;
    if (activeView !== 'webcam') {
      onViewChange('webcam');
      return;
    }
    setWebcamLayoutMode(webcamLayoutMode === 'tile' ? 'spotlight' : 'tile');
  };

  const viewModeButtonLabel =
    screenShareActive
      ? t('toolbar.shareScreen')
      : activeView === 'liveDoc'
        ? t('toolbar.liveDoc')
        : activeView === 'webcam'
          ? t('toolbar.webcam')
          : t('toolbar.shareScreen');

  const viewModeButtonIcon =
    screenShareActive || activeView === 'shareScreen' ? (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke={hasScreenShare && !screenShareActive ? '#fb923c' : 'currentColor'}
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ) : activeView === 'liveDoc' ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ) : activeView === 'webcam' && webcamLayoutMode === 'spotlight' ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3" y="5" width="12" height="14" rx="1.5" />
        <rect x="17" y="5" width="4" height="3.5" rx="0.5" />
        <rect x="17" y="10.25" width="4" height="3.5" rx="0.5" />
        <rect x="17" y="15.5" width="4" height="3.5" rx="0.5" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3" y="3" width="8" height="8" rx="1" />
        <rect x="13" y="3" width="8" height="8" rx="1" />
        <rect x="3" y="13" width="8" height="8" rx="1" />
        <rect x="13" y="13" width="8" height="8" rx="1" />
      </svg>
    );

  const renderWebcamLayoutMenuItems = () => (
    <>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={activeView === 'webcam' && webcamLayoutMode === 'tile'}
        className={`${styles.viewModeMenuItem} ${activeView === 'webcam' && webcamLayoutMode === 'tile' ? styles.viewModeMenuItemActive : ''} ${!canSwitchViews ? styles.viewModeMenuItemDisabled : ''}`}
        onClick={() => handleWebcamLayoutSelect('tile')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="3" width="8" height="8" rx="1" />
          <rect x="13" y="3" width="8" height="8" rx="1" />
          <rect x="3" y="13" width="8" height="8" rx="1" />
          <rect x="13" y="13" width="8" height="8" rx="1" />
        </svg>
        <span className={styles.viewModeMenuItemLabel}>{t('toolbar.webcamTile')}</span>
        {activeView === 'webcam' && webcamLayoutMode === 'tile' && (
          <svg className={styles.viewModeMenuCheck} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <button
        type="button"
        role="menuitemradio"
        aria-checked={activeView === 'webcam' && webcamLayoutMode === 'spotlight'}
        className={`${styles.viewModeMenuItem} ${activeView === 'webcam' && webcamLayoutMode === 'spotlight' ? styles.viewModeMenuItemActive : ''} ${!canSwitchViews ? styles.viewModeMenuItemDisabled : ''}`}
        onClick={() => handleWebcamLayoutSelect('spotlight')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="5" width="12" height="14" rx="1.5" />
          <rect x="17" y="5" width="4" height="3.5" rx="0.5" />
          <rect x="17" y="10.25" width="4" height="3.5" rx="0.5" />
          <rect x="17" y="15.5" width="4" height="3.5" rx="0.5" />
        </svg>
        <span className={styles.viewModeMenuItemLabel}>{t('toolbar.webcamSpotlight')}</span>
        {activeView === 'webcam' && webcamLayoutMode === 'spotlight' && (
          <svg className={styles.viewModeMenuCheck} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </>
  );

  /** 手机端：协作文档 / 摄像头宫格·焦点 / 共享屏幕 合并上拉菜单 */
  const renderViewModeMenu = () => (
    <div className={styles.viewModeMenu} role="menu">
      <button
        type="button"
        role="menuitemradio"
        aria-checked={activeView === 'liveDoc'}
        className={`${styles.viewModeMenuItem} ${activeView === 'liveDoc' ? styles.viewModeMenuItemActive : ''} ${!canSwitchViews ? styles.viewModeMenuItemDisabled : ''}`}
        onClick={() => {
          if (!canSwitchViews) return;
          handleLiveDocTabClick();
          closeViewModeMenu();
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className={styles.viewModeMenuItemLabel}>{t('toolbar.liveDocView')}</span>
        {activeView === 'liveDoc' && (
          <svg className={styles.viewModeMenuCheck} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {renderWebcamLayoutMenuItems()}

      {screenShareActive ? (
        <div
          className={`${styles.viewModeMenuItem} ${styles.viewModeShareActiveRow}`}
          role="menuitem"
          aria-label={`${t('toolbar.shareScreen')}, ${t('toolbar.sharing')}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span className={styles.viewModeMenuItemText}>
            <span className={styles.viewModeMenuItemLabel}>{t('toolbar.shareScreen')}</span>
            <span className={styles.viewModeMenuItemSub}>{t('toolbar.sharing')}</span>
          </span>
          <button
            type="button"
            className={styles.viewModeShareStopBtn}
            onClick={() => {
              handleShareScreenClick();
              closeViewModeMenu();
            }}
          >
            {t('toolbar.stop')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          role="menuitemradio"
          aria-checked={activeView === 'shareScreen'}
          className={`${styles.viewModeMenuItem} ${activeView === 'shareScreen' ? styles.viewModeMenuItemActive : ''} ${hasScreenShare ? styles.viewModeMenuItemWarnRow : ''}`}
          onClick={() => {
            handleShareScreenClick();
            closeViewModeMenu();
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke={hasScreenShare ? '#fb923c' : 'currentColor'}
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span
            className={`${styles.viewModeMenuItemText} ${hasScreenShare ? styles.viewModeMenuItemWarn : ''}`}
          >
            <span className={styles.viewModeMenuItemLabel}>{t('toolbar.shareScreen')}</span>
            <span className={styles.viewModeMenuItemSub}>
              {hasScreenShare ? t('toolbar.shareConflictTitle') : t('toolbar.startSharing')}
            </span>
          </span>
        </button>
      )}
    </div>
  );

  /** 手机端合并视图按钮（Web 已拆分，勿用于 desktop） */
  const renderViewModeControl = () => {
    if (!canShowOperatorMenus) return null;
    return (
      <div
        className={styles.viewModeBtnWrap}
        data-view-mode-menu-anchor="true"
      >
        <button
          type="button"
          className={`${styles.mobileBtn} ${styles.active}`}
          onClick={() => {
            closeInviteMenu();
            setActiveSheet(null);
            setViewModeMenuOpen((prev) => !prev);
          }}
          aria-label={viewModeButtonLabel}
          aria-expanded={viewModeMenuOpen}
          aria-haspopup="menu"
          title={viewModeButtonLabel}
        >
          {viewModeButtonIcon}
          <span className={styles.viewModeMenuBadge} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </span>
        </button>
        {viewModeMenuOpen && renderViewModeMenu()}
      </div>
    );
  };

  /**
   * Web：视图切换分段控件「LiveDoc / Webcam / Share Screen」。
   * - LiveDoc / Webcam 段：仅 canSwitchViews && 操作者（与旧版一致）
   * - Webcam 段主体点击：非 Webcam 时切到 Webcam，已在 Webcam 时切换宫格/焦点（与旧版一致）
   * - Webcam 段右侧箭头：弹出 Tile / Spotlight 子菜单（复用 handleWebcamLayoutSelect）
   * - Share Screen 段：所有人可见
   */
  const renderDesktopViewSwitch = () => {
    const showOperatorSegments = canSwitchViews && canShowOperatorMenus;
    const webcamLabel =
      webcamLayoutMode === 'spotlight' ? t('toolbar.webcamSpotlight') : t('toolbar.webcamTile');
    const shareConflict = hasScreenShare && !screenShareActive;
    const shareTip = shareConflict
      ? t('toolbar.shareConflictTitle')
      : screenShareActive
        ? `${t('toolbar.shareScreen')} · ${t('toolbar.sharing')}`
        : t('toolbar.shareScreen');
    const webcamLayoutLabel = tr('toolbar.webcamLayout', 'Webcam layout');
    return (
      <div className={styles.viewSwitch} role="group" aria-label={t('toolbar.selectViewLayout')}>
        {showOperatorSegments && (
          <button
            type="button"
            className={`${styles.seg} ${activeView === 'liveDoc' ? styles.segActive : ''}`}
            onClick={() => {
              closeViewModeMenu();
              handleLiveDocTabClick();
            }}
            aria-pressed={activeView === 'liveDoc'}
            aria-label={t('toolbar.liveDocView')}
            data-tip={t('toolbar.liveDocView')}
          >
            <IconDoc />
            <span className={styles.segLabel}>{t('toolbar.liveDoc')}</span>
          </button>
        )}

        {showOperatorSegments && (
          <div
            className={`${styles.segSplit} ${activeView === 'webcam' ? styles.segActive : ''}`}
            data-view-mode-menu-anchor="true"
          >
            <button
              type="button"
              className={`${styles.seg} ${styles.segMain}`}
              onClick={handleDesktopWebcamClick}
              aria-pressed={activeView === 'webcam'}
              aria-label={webcamLabel}
              data-tip={webcamLabel}
            >
              {webcamLayoutMode === 'spotlight' ? <IconSpotlight /> : <IconTile />}
              <span className={styles.segLabel}>{t('toolbar.webcam')}</span>
            </button>
            <button
              type="button"
              className={styles.segChevron}
              onClick={() => {
                closeInviteMenu();
                setActiveSheet(null);
                setViewModeMenuOpen((prev) => !prev);
              }}
              aria-haspopup="menu"
              aria-expanded={viewModeMenuOpen}
              aria-label={webcamLayoutLabel}
              data-tip={webcamLayoutLabel}
            >
              <IconChevronUp />
            </button>
            {viewModeMenuOpen && (
              <div
                className={`${styles.viewModeMenu} ${styles.webcamLayoutMenu}`}
                role="menu"
                aria-label={webcamLayoutLabel}
              >
                {renderWebcamLayoutMenuItems()}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          className={`${styles.seg} ${activeView === 'shareScreen' ? styles.segActive : ''} ${shareConflict ? styles.segWarn : ''}`}
          onClick={() => {
            closeViewModeMenu();
            handleShareScreenClick();
          }}
          aria-pressed={activeView === 'shareScreen'}
          aria-label={shareTip}
          data-tip={shareTip}
        >
          {shareConflict && <span className={styles.segConflictDot} aria-hidden="true" />}
          {screenShareActive && (
            <span className={styles.segCheck} aria-hidden="true">✓</span>
          )}
          <IconShareScreen />
          <span className={styles.segLabel}>{t('toolbar.shareScreen')}</span>
        </button>
      </div>
    );
  };

  /** Web：标注 / 远程控制（仅 Electron 桌面端 + 有屏幕共享 + canSwitchViews，与旧版一致） */
  const renderDesktopShareTools = () => {
    if (!(canSwitchViews && isDesktop && hasScreenShare)) return null;
    const controlTip = remoteControlPending
      ? t('toolbar.cancelRequest')
      : isRemoteControlMode
        ? t('toolbar.stopControl')
        : t('toolbar.requestControl');
    return (
      <div className={styles.shareTools}>
        <button
          type="button"
          className={`${styles.pillBtn} ${isDrawingMode ? styles.pillBtnOn : ''}`}
          onClick={onToggleDrawingMode}
          aria-pressed={isDrawingMode}
          aria-label={t('toolbar.annotateTooltip')}
          data-tip={t('toolbar.annotateTooltip')}
        >
          <IconPen />
          <span className={styles.pillLabel}>{t('toolbar.annotate')}</span>
        </button>
        <button
          type="button"
          className={`${styles.pillBtn} ${isRemoteControlMode || remoteControlPending ? styles.pillBtnOn : ''}`}
          onClick={onToggleRemoteControlMode}
          aria-pressed={!!(isRemoteControlMode || remoteControlPending)}
          aria-label={controlTip}
          data-tip={controlTip}
        >
          {remoteControlPending ? (
            <svg className={styles.spin} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
          ) : (
            <IconCursor />
          )}
          <span className={styles.pillLabel}>
            {remoteControlPending ? t('toolbar.requesting') : t('toolbar.control')}
          </span>
        </button>
      </div>
    );
  };

  /** Web 右侧：LiveDoc AI 图标按钮（保留主持人/演示者的「批注开关」角标） */
  const renderDesktopLiveDocAiButton = () => {
    if (!canOpenLiveDocAi) return null;
    const isActive = liveDocMenuVisible || liveDocActionDialogVisible;
    const annotationLabel = liveDocAnnotationEnabled
      ? tr('toolbar.disableAnnotation', 'Disable Annotation')
      : tr('toolbar.enableAnnotation', 'Enable Annotation');
    return (
      <button
        ref={liveDocAiBtnRef}
        type="button"
        className={`${styles.iconBtn} ${isActive ? styles.iconBtnActive : ''}`}
        onClick={handleLiveDocSettingsClick}
        aria-label={t('toolbar.liveDocMenu')}
        aria-pressed={isActive}
        data-tip={t('toolbar.liveDocMenu')}
      >
        <IconDocAi />
        {canToggleLiveDocAnnotation && (
          <span
            role="button"
            tabIndex={0}
            className={`${styles.annotationToggle} ${liveDocAnnotationEnabled ? styles.annotationToggleOn : styles.annotationToggleOff}`}
            onClick={handleLiveDocAnnotationBadgeClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleLiveDocAnnotationBadgeClick(e as unknown as React.MouseEvent);
              }
            }}
            title={annotationLabel}
            aria-label={annotationLabel}
            aria-pressed={liveDocAnnotationEnabled}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" aria-hidden="true">
              {liveDocAnnotationEnabled ? <path d="M18 15l-6-6-6 6" /> : <path d="M6 9l6 6 6-6" />}
            </svg>
          </span>
        )}
      </button>
    );
  };

  const renderCountBadge = (count: number) =>
    count > 0 ? (
      <span className={styles.countBadge} aria-hidden="true">
        {count > 9 ? '9+' : count}
      </span>
    ) : null;

  /** LiveDoc AI：操作者始终显示；普通参会者由主持人开关决定 */
  const renderLiveDocSettingsButton = (variant: 'desktop' | 'mobile') => {
    if (!canOpenLiveDocAi) return null;
    const isActive = liveDocMenuVisible || liveDocActionDialogVisible;
    const className =
      variant === 'mobile'
        ? `${styles.mobileBtn} ${styles.liveDocAiBtn} ${isActive ? styles.active : ''}`
        : `${styles.tabBtn} ${styles.liveDocAiBtn} ${isActive ? styles.tabBtnActive : ''}`;
    return (
      <button
        ref={liveDocAiBtnRef}
        type="button"
        className={className}
        onClick={handleLiveDocSettingsClick}
        title={t('toolbar.liveDocMenu')}
        aria-label={t('toolbar.liveDocMenu')}
        aria-pressed={isActive}
      >
        <span className={styles.liveDocAiIconWrap}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className={styles.liveDocAiBadge} aria-hidden="true">AI</span>
        </span>
        {canToggleLiveDocAnnotation && (
          <span
            role="button"
            tabIndex={0}
            className={`${styles.liveDocAiArrowBadge} ${liveDocAnnotationEnabled ? styles.liveDocMenuBadgeOn : styles.liveDocMenuBadgeOff}`}
            onClick={handleLiveDocAnnotationBadgeClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleLiveDocAnnotationBadgeClick(e as unknown as React.MouseEvent);
              }
            }}
            title={liveDocAnnotationEnabled ? 'Disable Annotation' : 'Enable Annotation'}
            aria-label={liveDocAnnotationEnabled ? 'Disable Annotation' : 'Enable Annotation'}
            aria-pressed={liveDocAnnotationEnabled}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4">
              {liveDocAnnotationEnabled ? (
                <path d="M18 15l-6-6-6 6" />
              ) : (
                <path d="M6 9l6 6 6-6" />
              )}
            </svg>
          </span>
        )}
        {variant === 'desktop' ? t('toolbar.liveDocMenu') : null}
      </button>
    );
  };

  const renderDocumentPipButton = (variant: 'desktop' | 'mobile') => {
    if (!canDocumentPip) return null;
    const className =
      variant === 'mobile'
        ? `${styles.mobileBtn} ${documentPipEnabled ? styles.active : ''}`
        : `${styles.tabBtn} ${documentPipEnabled ? styles.tabBtnActive : ''}`;
    const label = t('toolbar.documentPip');
    return (
      <button
        type="button"
        className={className}
        onClick={() => onToggleDocumentPip?.()}
        title={label}
        aria-label={label}
        aria-pressed={documentPipEnabled}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="5" width="12" height="10" rx="1.5" />
          <path d="M15 9h4a1 1 0 011 1v8a1 1 0 01-1 1H9a1 1 0 01-1-1v-3" strokeLinecap="round" />
        </svg>
        {variant === 'desktop' ? label : null}
      </button>
    );
  };

  const desktopBubbleStyle = desktopBubblePos
    ? ({
      top:
        desktopAnchorBubbleKind === 'chat' && chatBubbleRect
          ? chatBubbleRect.top
          : desktopBubblePos.top,
      left:
        desktopAnchorBubbleKind === 'chat' && chatBubbleRect
          ? chatBubbleRect.left
          : desktopBubblePos.left,
      width:
        desktopAnchorBubbleKind === 'chat' && chatBubbleRect
          ? chatBubbleRect.width
          : desktopBubblePos.width,
      maxHeight:
        desktopAnchorBubbleKind === 'chat' && chatBubbleRect
          ? `calc(100vh - ${CHAT_BUBBLE_VIEWPORT_MARGIN * 2}px)`
          : desktopBubblePos.maxHeight,
      height:
        desktopAnchorBubbleKind === 'chat' && chatBubbleRect
          ? chatBubbleRect.height
          : desktopBubblePos.height,
      ['--toolbar-bubble-arrow' as string]: `${desktopBubblePos.arrowLeft}px`,
      visibility: 'visible',
    } as React.CSSProperties)
    : ({ visibility: 'hidden', pointerEvents: 'none' } as React.CSSProperties);

  return (
    <>
      {/* Toast */}
      {toastMsg && <div className={styles.toast}>{toastMsg}</div>}

      <LiveDocAiPanel
        open={liveDocMenuVisible && canOpenLiveDocAi}
        state={liveDocAiBridge.state}
        connected={liveDocAiBridge.connected}
        error={liveDocAiBridge.error}
        busy={liveDocAiBridge.pendingActions.size > 0}
        bubblePos={liveDocBubblePos}
        isLiveDocView={activeView === 'liveDoc'}
        onClose={closeLiveDocAiMenu}
        onClearError={liveDocAiBridge.clearError}
        onAction={liveDocAiBridge.sendAction}
        onOpenDocument={handleLiveDocDocumentOpen}
        livekitToken={livekitToken}
      />

      {!visible && !syncPlayerActive && (
        <>
          {/* 底部导航栏占位：吞掉点击，避免误点唤出；桌面仅中间图标附近悬停唤出 */}
          <div className={styles.bottomNavCatchZone} aria-hidden />
          {/* 桌面悬停中间向上图标附近唤出底栏 */}
          <div
            className={styles.hoverZone}
            onMouseEnter={revealToolbar}
          />
          <button
            type="button"
            className={styles.chevronHandle}
            onClick={revealToolbar}
            onMouseEnter={revealToolbar}
            aria-label={t('toolbar.showToolbar') || 'Show toolbar'}
            title={t('toolbar.showToolbar') || 'Show toolbar'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
        </>
      )}

      {/* Main toolbar */}
      <div
        ref={toolbarRef}
        data-skymeet-toolbar="true"
        className={`${styles.toolbar} ${isMobile ? styles.mobileToolbar : styles.desktopBar} ${!visible ? styles.toolbarHidden : ''}`}
        onMouseEnter={handleToolbarMouseEnter}
        onMouseLeave={handleToolbarMouseLeave}
      >
        {isMobile ? (
          <>
            {/* 1. Audio (Mic) */}
            <div className={styles.controlGroup}>
              <button
                className={`${styles.controlBtn} ${!micEnabled ? styles.controlBtnOff : ''}`}
                onClick={onToggleMic}
                disabled={!canUseMediaDevices}
                aria-label={micEnabled ? t('toolbar.muteMic') : t('toolbar.unmuteMic')}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  {micEnabled ? (
                    <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z" />
                  ) : (
                    <>
                      <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z" />
                      {/* 自己关麦：斜线跟 icon 同色，不用红色 */}
                      <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </>
                  )}
                </svg>
              </button>
              {canEnumerateDevices ? (
                <MediaDeviceMenu kind="audioinput" className={styles.chevron} style={{ color: '#fff' }} title={t('toolbar.micSettings')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 15l-6-6-6 6" /></svg>
                </MediaDeviceMenu>
              ) : (
                <button type="button" className={styles.chevron} style={{ color: '#fff' }} title={t('toolbar.micSettings')} disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 15l-6-6-6 6" /></svg>
                </button>
              )}
            </div>

            {/* 2. Webcam */}
            <div className={styles.controlGroup}>
              <button
                className={`${styles.controlBtn} ${!camEnabled ? styles.controlBtnOff : ''} ${isCamDisabledByHost && !camEnabled ? styles.controlBtnMutedByHost : ''}`}
                onClick={onToggleCam}
                disabled={!canUseMediaDevices}
                aria-label={camEnabled ? t('toolbar.turnOffCam') : t('toolbar.turnOnCam')}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  {camEnabled ? (
                    <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                  ) : (
                    <>
                      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                      {/* 自己关摄像头：斜线跟 icon 同色；主持人禁用仍走红色底样式 */}
                      <line
                        x1="4"
                        y1="4"
                        x2="20"
                        y2="20"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    </>
                  )}
                </svg>
              </button>
              {canEnumerateDevices ? (
                <MediaDeviceMenu kind="videoinput" className={styles.chevron} style={{ color: '#fff' }} title={t('toolbar.camSettings')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 15l-6-6-6 6" /></svg>
                </MediaDeviceMenu>
              ) : (
                <button type="button" className={styles.chevron} style={{ color: '#fff' }} title={t('toolbar.camSettings')} disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 15l-6-6-6 6" /></svg>
                </button>
              )}
            </div>

            {/* 3. 视图模式（活文档 / Webcam Tile·Spotlight / 屏幕共享合并）— 仅 host / co-host / presenter */}
            {renderViewModeControl()}

            {/* 4. Screen Share — 非操作者仍单独显示 */}
            {!canShowOperatorMenus && (
              <button
                className={`${styles.mobileBtn} ${activeView === 'shareScreen' || screenShareActive ? styles.active : ''}`}
                onClick={handleShareScreenClick}
                aria-label={t('toolbar.shareScreen')}
                title={hasScreenShare && !screenShareActive ? t('toolbar.shareConflictTitle') : t('toolbar.shareScreen')}
              >
                <svg viewBox="0 0 24 24" fill="none"
                  stroke={hasScreenShare && !screenShareActive ? '#fb923c' : 'currentColor'}
                  strokeWidth="1.5"
                >
                  <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </button>
            )}

            {/* 5. LiveDoc AI：普通参会者可被主持人隐藏 */}
            {renderLiveDocSettingsButton('mobile')}

            {/* 6. Document PiP */}
            {renderDocumentPipButton('mobile')}

            {/* 7. More */}
            <button
              className={styles.mobileBtn}
              onClick={() => openSheet('more')}
              aria-label={t('toolbar.more')}
              title={t('toolbar.more')}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          </>
        ) : (
          <>
            {/* Left zone: clock | meeting name */}
            <div className={styles.zoneLeft}>
              {clockText && <span className={styles.clock}>{clockText}</span>}
              {clockText && meetingLabel && <span className={styles.zoneDivider} aria-hidden="true" />}
              {meetingLabel && (
                <span className={styles.meetingName} title={meetingLabel}>
                  {meetingLabel}
                </span>
              )}
            </div>

            {/* Centre zone: devices → view switch → share tools → hand → (rec) → more → exit */}
            <div className={styles.zoneCenter}>
              {(() => {
                const micLabel = isMutedByHost
                  ? tr('toolbar.mutedByHost', 'Muted by host')
                  : micEnabled
                    ? t('toolbar.muteMic')
                    : t('toolbar.unmuteMic');
                const camLabel = isCamDisabledByHost
                  ? tr('toolbar.camDisabledByHost', 'Camera disabled by host')
                  : camEnabled
                    ? t('toolbar.turnOffCam')
                    : t('toolbar.turnOnCam');
                return (
                  <div className={styles.deviceGroup}>
                    {/* Mic split */}
                    <div className={styles.split}>
                      <button
                        type="button"
                        className={`${styles.roundBtn} ${!micEnabled ? styles.roundBtnOff : ''} ${isMutedByHost && !micEnabled ? styles.roundBtnByHost : ''}`}
                        onClick={onToggleMic}
                        disabled={!canUseMediaDevices}
                        aria-label={micLabel}
                        data-tip={micLabel}
                      >
                        {micEnabled ? <IconMicOn /> : <IconMicOff />}
                      </button>
                      {canEnumerateDevices ? (
                        <MediaDeviceMenu
                          kind="audioinput"
                          className={styles.splitChevron}
                          aria-label={t('toolbar.micSettings')}
                          data-tip={t('toolbar.micSettings')}
                        >
                          <IconChevronUp />
                        </MediaDeviceMenu>
                      ) : (
                        <button type="button" className={styles.splitChevron} aria-label={t('toolbar.micSettings')} disabled>
                          <IconChevronUp />
                        </button>
                      )}
                    </div>

                    {/* Camera split */}
                    <div className={styles.split}>
                      <button
                        type="button"
                        className={`${styles.roundBtn} ${!camEnabled ? styles.roundBtnOff : ''} ${isCamDisabledByHost && !camEnabled ? styles.roundBtnByHost : ''}`}
                        onClick={onToggleCam}
                        disabled={!canUseMediaDevices}
                        aria-label={camLabel}
                        data-tip={camLabel}
                      >
                        {camEnabled ? <IconCamOn /> : <IconCamOff />}
                      </button>
                      {canEnumerateDevices ? (
                        <MediaDeviceMenu
                          kind="videoinput"
                          className={styles.splitChevron}
                          aria-label={t('toolbar.camSettings')}
                          data-tip={t('toolbar.camSettings')}
                        >
                          <IconChevronUp />
                        </MediaDeviceMenu>
                      ) : (
                        <button type="button" className={styles.splitChevron} aria-label={t('toolbar.camSettings')} disabled>
                          <IconChevronUp />
                        </button>
                      )}
                    </div>

                    {/* Speaker split: icon and chevron both open the output-device menu */}
                    <div className={styles.split}>
                      {canEnumerateDevices ? (
                        <MediaDeviceMenu
                          kind="audiooutput"
                          className={styles.roundBtn}
                          aria-label={t('toolbar.speakerSettings')}
                          data-tip={t('toolbar.speakerSettings')}
                        >
                          <IconSpeaker />
                        </MediaDeviceMenu>
                      ) : (
                        <span
                          className={`${styles.roundBtn} ${styles.roundBtnStatic}`}
                          role="img"
                          aria-label={t('toolbar.speakerSettings')}
                          data-tip={t('toolbar.speakerSettings')}
                        >
                          <IconSpeaker />
                        </span>
                      )}
                      {canEnumerateDevices ? (
                        <MediaDeviceMenu
                          kind="audiooutput"
                          className={styles.splitChevron}
                          aria-label={t('toolbar.speakerSettings')}
                          data-tip={t('toolbar.speakerSettings')}
                        >
                          <IconChevronUp />
                        </MediaDeviceMenu>
                      ) : (
                        <button type="button" className={styles.splitChevron} aria-label={t('toolbar.speakerSettings')} disabled>
                          <IconChevronUp />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* View switch: LiveDoc / Webcam (Tile·Spotlight) / Share Screen */}
              {renderDesktopViewSwitch()}

              {/* Annotate / Remote control: Electron + screen share only */}
              {renderDesktopShareTools()}

              <div className={styles.actionGroup}>
                {/* Raise hand: everyone */}
                <button
                  type="button"
                  className={`${styles.roundBtn} ${handRaised ? styles.roundBtnHand : ''}`}
                  onClick={onToggleHand}
                  aria-pressed={handRaised}
                  aria-label={handRaised ? t('toolbar.lowerHand') : t('toolbar.raiseHand')}
                  data-tip={handRaised ? t('toolbar.lowerHand') : t('toolbar.raiseHand')}
                >
                  <IconHand />
                </button>

                {/* Recording in progress (host / co-host): opens Stop Recording menu */}
                {canRecord && isRecording && (
                  <button
                    ref={recordMenuBtnRef}
                    type="button"
                    className={`${styles.roundBtn} ${styles.recBtn} ${activeSheet === 'recording' ? styles.roundBtnActive : ''}`}
                    onClick={() => openSheet('recording')}
                    aria-haspopup="menu"
                    aria-expanded={activeSheet === 'recording'}
                    aria-label={t('toolbar.recordingControls')}
                    data-tip={t('toolbar.recording')}
                  >
                    <span className={styles.recDot} aria-hidden="true" />
                  </button>
                )}

                {/* More */}
                <button
                  ref={moreMenuBtnRef}
                  type="button"
                  className={`${styles.roundBtn} ${activeSheet === 'more' ? styles.roundBtnActive : ''}`}
                  onClick={() => openSheet('more')}
                  aria-haspopup="menu"
                  aria-expanded={activeSheet === 'more'}
                  aria-label={t('toolbar.moreOptions')}
                  data-tip={t('toolbar.moreOptions')}
                >
                  <IconDots />
                </button>
              </div>

              {/* Exit: separated red pill */}
              <button
                ref={exitMenuBtnRef}
                type="button"
                className={styles.exitPill}
                onClick={() => openSheet('exit')}
                aria-haspopup="menu"
                aria-expanded={activeSheet === 'exit'}
                aria-label={t('toolbar.exit')}
                data-tip={t('toolbar.exit')}
              >
                <IconHangUp />
              </button>
            </div>

            {/* Right zone: icon-only tools with tooltips + badges */}
            <div className={styles.zoneRight}>
              {renderDesktopLiveDocAiButton()}

              <button
                ref={attendeeMenuBtnRef}
                type="button"
                className={`${styles.iconBtn} ${attendeeOpen ? styles.iconBtnActive : ''}`}
                onClick={handleToggleAttendee}
                aria-pressed={attendeeOpen}
                aria-label={raisedHandCount > 0 ? `${t('toolbar.attendees')} (${raisedHandCount})` : t('toolbar.attendees')}
                data-tip={t('toolbar.attendees')}
              >
                <IconPeople />
                {renderCountBadge(raisedHandCount)}
              </button>

              <button
                ref={chatMenuBtnRef}
                type="button"
                className={`${styles.iconBtn} ${chatOpen ? styles.iconBtnActive : ''}`}
                onClick={handleToggleChat}
                aria-pressed={chatOpen}
                aria-label={chatBadgeCount > 0 ? `${t('toolbar.chats')} (${chatBadgeCount})` : t('toolbar.chats')}
                data-tip={t('toolbar.chats')}
              >
                <IconChat />
                {!chatOpen && renderCountBadge(chatBadgeCount)}
              </button>

              <div data-invite-menu-anchor="true" className={styles.inviteMenuAnchor}>
                <button
                  type="button"
                  className={`${styles.iconBtn} ${inviteMenuOpen ? styles.iconBtnActive : ''}`}
                  onClick={() =>
                    setInviteMenuOpen((prev) => {
                      const next = !prev;
                      if (next) onOpenSheet?.();
                      return next;
                    })
                  }
                  aria-haspopup="menu"
                  aria-expanded={inviteMenuOpen}
                  aria-label={t('toolbar.invite')}
                  data-tip={t('toolbar.invite')}
                >
                  <IconLink />
                </button>
                {inviteMenuOpen && (
                  <div className={`${styles.inviteDropdown} ${styles.inviteDropdownEnd}`} role="menu">
                    <button
                      type="button"
                      className={styles.inviteDropdownItem}
                      role="menuitem"
                      onClick={() => {
                        void navigator.clipboard?.writeText(buildInviteLinkForClipboard(isDesktop));
                        showInviteToast(t('toolbar.inviteCopied'));
                        closeInviteMenu();
                      }}
                    >
                      {t('schedule.copyLink')}
                    </button>
                    <button
                      type="button"
                      className={styles.inviteDropdownItem}
                      role="menuitem"
                      onClick={() => {
                        void navigator.clipboard?.writeText(buildInMeetingInviteClipboardText(isDesktop));
                        showInviteToast(t('schedule.inviteCopied'));
                        closeInviteMenu();
                      }}
                    >
                      {t('schedule.copyInvite')}
                    </button>
                  </div>
                )}
              </div>

              {/* SmartCam（智视窗 = Document PiP，同一功能，单一按钮） */}
              {canDocumentPip && (
                <button
                  type="button"
                  className={`${styles.iconBtn} ${documentPipEnabled ? styles.iconBtnActive : ''}`}
                  onClick={() => onToggleDocumentPip?.()}
                  aria-pressed={documentPipEnabled}
                  aria-label={t('toolbar.documentPip')}
                  data-tip={t('toolbar.documentPip')}
                >
                  <IconSmartCam />
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Action Sheets / Popups */}
      {activeSheet && isMobile && (
        <>
          <div className={`${styles.actionSheetOverlay} ${activeSheet ? styles.open : ''}`} onClick={() => setActiveSheet(null)} />
          <div className={`${styles.actionSheet} ${activeSheet ? styles.open : ''}`}>
            <div className={styles.actionSheetHeader}>
              <span className={styles.actionSheetTitle}>
                {activeSheet === 'views'
                  ? t('toolbar.selectViewLayout')
                  : activeSheet === 'recording'
                    ? t('toolbar.recordingControls')
                    : activeSheet === 'exit'
                      ? t('toolbar.leaveMeeting')
                      : activeSheet === 'speaker'
                        ? t('toolbar.speakerSettings')
                        : t('toolbar.moreOptions')}
              </span>
              <button type="button" className={styles.actionSheetClose} onClick={() => setActiveSheet(null)}>✕</button>
            </div>
            <div className={styles.actionSheetList}>
              <ActiveSheetContent
                activeSheet={activeSheet}
                activeView={activeView}
                onViewChange={onViewChange}
                handleShareScreenClick={handleShareScreenClick}
                canShareScreen={canShareScreen}
                attendeeOpen={attendeeOpen}
                handleToggleAttendee={handleToggleAttendee}
                toastMsg={toastMsg}
                setToastMsg={setToastMsg}
                toastTimerRef={toastTimerRef}
                setActiveSheet={setActiveSheet}
                onExit={onExit}
                onEndForAll={onEndForAll}
                isDesktop={isDesktop}
                canEndForAll={canEndForAll}
                canRecord={canRecord}
                isRecording={isRecording}
                onOpenRecordPopup={onOpenRecordPopup}
                onStopRecording={onStopRecording}
                onOpenHelp={onOpenHelp}
                canMuteAll={canMuteAll}
                muteAllActive={muteAllActive}
                onMuteAll={onMuteAll}
                onUnmuteAll={onUnmuteAll}
                canToggleCaptions={canToggleCaptions}
                captionsEnabled={captionsEnabled}
                onToggleCaptions={onToggleCaptions}
                mobileAudioState={mobileAudioState}
                setMobileAudioState={setMobileAudioState}
                handleToggleChat={handleToggleChat}
                onOpenSTTSettings={() => {
                  setSttSettingsTab('my');
                  setShowSTTSettings(true);
                }}
                onOpenCCSettings={() => {
                  setSttSettingsTab('my');
                  setShowSTTSettings(true);
                }}
                localSubtitleVisible={localSubtitleVisible}
                onOpenDesktopApp={onOpenDesktopApp}
                isMobile={isMobile}
                canShowOperatorMenus={canShowOperatorMenus}
              />
            </div>
          </div>
        </>
      )}

      {activeSheet === 'views' && !isMobile && (
        <div className={styles.desktopPopupMenu}>
          <div className={styles.desktopPopupMenuHeader}>
            <span className={styles.desktopPopupMenuTitle}>{t('toolbar.selectViewLayout')}</span>
            <button type="button" className={styles.desktopPopupMenuClose} onClick={() => setActiveSheet(null)}>✕</button>
          </div>
          <div className={styles.desktopPopupMenuList}>
            <ActiveSheetContent
              activeSheet={activeSheet}
              activeView={activeView}
              onViewChange={onViewChange}
              handleShareScreenClick={handleShareScreenClick}
              canShareScreen={canShareScreen}
              attendeeOpen={attendeeOpen}
              handleToggleAttendee={handleToggleAttendee}
              toastMsg={toastMsg}
              setToastMsg={setToastMsg}
              toastTimerRef={toastTimerRef}
              setActiveSheet={setActiveSheet}
              onExit={onExit}
              onEndForAll={onEndForAll}
              isDesktop={isDesktop}
              canEndForAll={canEndForAll}
              canRecord={canRecord}
              isRecording={isRecording}
              onOpenRecordPopup={onOpenRecordPopup}
              onStopRecording={onStopRecording}
              onOpenHelp={onOpenHelp}
              handleToggleChat={handleToggleChat}
              canShowOperatorMenus={canShowOperatorMenus}
            />
          </div>
        </div>
      )}

      {desktopAnchorBubbleKind &&
        !isMobile &&
        (typeof document !== 'undefined'
          ? createPortal(
            <>
              {desktopAnchorBubbleKind !== 'chat' && (
                <div
                  role="presentation"
                  className={styles.toolbarBubbleDismiss}
                  onMouseDown={() => {
                    if (desktopAnchorBubbleKind === 'more' || desktopAnchorBubbleKind === 'exit' || desktopAnchorBubbleKind === 'recording') {
                      setActiveSheet(null);
                    } else if (desktopAnchorBubbleKind === 'attendee' && attendeeOpen) {
                      onToggleAttendee();
                    }
                  }}
                />
              )}
              <div
                ref={desktopBubbleRef}
                className={`${styles.toolbarBubble} ${desktopAnchorBubbleKind === 'chat' || desktopAnchorBubbleKind === 'attendee' ? styles.toolbarBubblePanel : ''
                  } ${desktopAnchorBubbleKind === 'chat' ? styles.toolbarBubbleDraggable : ''
                  } ${desktopAnchorBubbleKind === 'chat' && chatBubbleRect ? styles.toolbarBubbleFree : ''
                  } ${isChatBubbleInteracting ? styles.toolbarBubbleInteracting : ''}`}
                style={desktopBubbleStyle}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className={styles.toolbarBubbleArrow} aria-hidden />
                <div
                  className={`${styles.toolbarBubbleHeader}${desktopAnchorBubbleKind === 'chat' ? ` ${styles.toolbarBubbleDragHandle}` : ''}`}
                  onPointerDown={
                    desktopAnchorBubbleKind === 'chat'
                      ? (e) => {
                          const target = e.target as HTMLElement;
                          if (target.closest('button')) return;
                          beginChatBubbleInteraction(e, 'move');
                        }
                      : undefined
                  }
                >
                  {desktopAnchorBubbleKind === 'chat' && (
                    <div
                      className={styles.toolbarBubbleDragIcon}
                      aria-hidden
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden>
                        <circle cx="8" cy="6" r="2" />
                        <circle cx="8" cy="12" r="2" />
                        <circle cx="8" cy="18" r="2" />
                        <circle cx="14" cy="6" r="2" />
                        <circle cx="14" cy="12" r="2" />
                        <circle cx="14" cy="18" r="2" />
                      </svg>
                    </div>
                  )}
                  <span className={styles.toolbarBubbleTitle}>
                    {desktopAnchorBubbleKind === 'exit'
                      ? t('toolbar.leaveMeeting')
                      : desktopAnchorBubbleKind === 'recording'
                        ? t('toolbar.recordingControls')
                        : desktopAnchorBubbleKind === 'chat'
                          ? t('toolbar.chats')
                          : desktopAnchorBubbleKind === 'attendee'
                            ? t('toolbar.participants')
                            : t('toolbar.moreOptions')}
                  </span>
                  <button
                    type="button"
                    className={styles.toolbarBubbleClose}
                    onClick={() => {
                      if (desktopAnchorBubbleKind === 'more' || desktopAnchorBubbleKind === 'exit' || desktopAnchorBubbleKind === 'recording') {
                        setActiveSheet(null);
                      } else if (desktopAnchorBubbleKind === 'chat' && chatOpen) {
                        onToggleChat();
                      } else if (desktopAnchorBubbleKind === 'attendee' && attendeeOpen) {
                        onToggleAttendee();
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
                {desktopAnchorBubbleKind === 'chat' && chatPanelSlot ? (
                  <div className={styles.toolbarBubblePanelBody}>{chatPanelSlot}</div>
                ) : desktopAnchorBubbleKind === 'attendee' && attendeePanelSlot ? (
                  <div className={styles.toolbarBubblePanelBody}>{attendeePanelSlot}</div>
                ) : (
                  <div className={styles.toolbarBubbleList}>
                    <ActiveSheetContent
                      activeSheet={activeSheet}
                      activeView={activeView}
                      onViewChange={onViewChange}
                      handleShareScreenClick={handleShareScreenClick}
                      canShareScreen={canShareScreen}
                      attendeeOpen={attendeeOpen}
                      handleToggleAttendee={handleToggleAttendee}
                      toastMsg={toastMsg}
                      setToastMsg={setToastMsg}
                      toastTimerRef={toastTimerRef}
                      setActiveSheet={setActiveSheet}
                      onExit={onExit}
                      onEndForAll={onEndForAll}
                      isDesktop={isDesktop}
                      canEndForAll={canEndForAll}
                      canRecord={canRecord}
                      isRecording={isRecording}
                      onOpenRecordPopup={onOpenRecordPopup}
                      onStopRecording={onStopRecording}
                      onOpenHelp={onOpenHelp}
                      canMuteAll={canMuteAll}
                      muteAllActive={muteAllActive}
                      onMuteAll={onMuteAll}
                      onUnmuteAll={onUnmuteAll}
                      canToggleCaptions={canToggleCaptions}
                      captionsEnabled={captionsEnabled}
                      onToggleCaptions={onToggleCaptions}
                      mobileAudioState={mobileAudioState}
                      setMobileAudioState={setMobileAudioState}
                      handleToggleChat={handleToggleChat}
                      onOpenSTTSettings={() => {
                        setSttSettingsTab('my');
                        setShowSTTSettings(true);
                      }}
                      onOpenCCSettings={() => {
                        setSttSettingsTab('my');
                        setShowSTTSettings(true);
                      }}
                      localSubtitleVisible={localSubtitleVisible}
                      onOpenDesktopApp={onOpenDesktopApp}
                      isMobile={false}
                      canShowOperatorMenus={canShowOperatorMenus}
                    />
                  </div>
                )}
                {desktopAnchorBubbleKind === 'chat' && (
                  <button
                    type="button"
                    className={styles.toolbarBubbleResizeHandle}
                    onPointerDown={(e) => beginChatBubbleInteraction(e, 'resize')}
                    aria-label="Resize chat"
                    title="Resize chat"
                  />
                )}
              </div>
            </>,
            document.body,
          )
          : null)}

      {isMobile && (
        <div
          id="mobileTopRightBtn"
          className={`${styles.mobileTopActions} ${!visible ? styles.mobileTopActionsHidden : ''}`}
        >
          {/* Invite — replaces Speaker on phone browser */}
          <div data-invite-menu-anchor="true" className={styles.mobileTopInviteAnchor}>
            <button
              type="button"
              className={`${styles.mobileTopBtn} ${inviteMenuOpen ? styles.mobileTopBtnInviteActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                closeViewModeMenu();
                setInviteMenuOpen((prev) => {
                  const next = !prev;
                  if (next) onOpenSheet?.();
                  return next;
                });
              }}
              aria-label={t('toolbar.invite')}
              title={t('toolbar.invite')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
            </button>
            {inviteMenuOpen && (
              <div className={`${styles.inviteDropdown} ${styles.inviteDropdownFromTop}`} role="menu">
                <button
                  type="button"
                  className={styles.inviteDropdownItem}
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    void navigator.clipboard?.writeText(buildInviteLinkForClipboard(isDesktop));
                    showInviteToast(t('toolbar.inviteCopied'));
                    closeInviteMenu();
                  }}
                >
                  {t('schedule.copyLink')}
                </button>
                <button
                  type="button"
                  className={styles.inviteDropdownItem}
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    void navigator.clipboard?.writeText(buildInMeetingInviteClipboardText(isDesktop));
                    showInviteToast(t('schedule.inviteCopied'));
                    closeInviteMenu();
                  }}
                >
                  {t('schedule.copyInvite')}
                </button>
              </div>
            )}
          </div>

          {/* Chat button */}
          <button
            type="button"
            className={`${styles.mobileTopBtn} ${chatOpen ? styles.mobileTopBtnChatActive : ''}`}
            onClick={(e) => { e.stopPropagation(); handleToggleChat(); }}
            aria-label="Chat"
            title={t('toolbar.chats') || 'Chat'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>

          {/* Recording button — host/co-host only */}
          {canRecord && (
            <button
              type="button"
              className={`${styles.mobileTopBtn} ${isRecording ? styles.mobileTopBtnRecording : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (isRecording) {
                  openSheet('recording');
                } else {
                  onOpenRecordPopup?.();
                }
              }}
              aria-label={isRecording ? (t('toolbar.recording') || 'Recording') : (t('toolbar.record') || 'Record')}
              title={isRecording ? (t('toolbar.recording') || 'Recording') : (t('toolbar.record') || 'Record')}
            >
              {isRecording ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="5" fill="#fff" stroke="none" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="5" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              )}
            </button>
          )}

          {/* Exit button */}
          <button
            type="button"
            className={`${styles.mobileTopBtn} ${styles.mobileTopBtnExit}`}
            onClick={(e) => { e.stopPropagation(); openSheet('exit'); }}
            aria-label={t('toolbar.exit') || 'Exit'}
            title={t('toolbar.exit') || 'Exit'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      )}
      
      <STTSettingsDialog
        isOpen={showSTTSettings}
        onClose={() => setShowSTTSettings(false)}
        captionsEnabled={captionsEnabled}
        onToggleCaptions={onToggleCaptions}
        canToggleCaptions={canToggleCaptions}
        canManageDefaults={!!canToggleCaptions}
        initialTab={sttSettingsTab}
        subtitleVisible={localSubtitleVisible}
      />
    </>
  );
}

/* Helper Component so we don't duplicate the 100 lines of buttons */
function ActiveSheetContent({
  activeSheet,
  activeView,
  onViewChange,
  handleShareScreenClick,
  canShareScreen,
  attendeeOpen,
  handleToggleAttendee,
  toastMsg,
  setToastMsg,
  toastTimerRef,
  setActiveSheet,
  onExit,
  onEndForAll,
  isDesktop,
  canEndForAll,
  canRecord = false,
  isRecording,
  onOpenRecordPopup,
  onStopRecording,
  onOpenHelp,
  canMuteAll,
  muteAllActive,
  onMuteAll,
  onUnmuteAll,
  canToggleCaptions,
  captionsEnabled,
  onToggleCaptions,
  mobileAudioState,
  setMobileAudioState,
  handleToggleChat,
  onOpenSTTSettings,
  onOpenCCSettings,
  localSubtitleVisible,
  onOpenDesktopApp,
  isMobile,
  canShowOperatorMenus = false,
}: any) {
  const { t, locale, setLocale } = useI18n();
  const [langOpen, setLangOpen] = useState(false);
  const langAnchorRef = useRef<HTMLDivElement | null>(null);
  const langCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [langFlyoutStyle, setLangFlyoutStyle] = useState<React.CSSProperties | null>(null);
  const currentLocale = LOCALE_OPTIONS.find((opt) => opt.code === locale) ?? LOCALE_OPTIONS[0];

  const clearLangCloseTimer = () => {
    if (langCloseTimerRef.current) {
      clearTimeout(langCloseTimerRef.current);
      langCloseTimerRef.current = null;
    }
  };

  const updateLangFlyoutPosition = () => {
    const rect = langAnchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const flyoutWidth = 168;
    const gap = 8;
    const openLeft = rect.left >= flyoutWidth + gap + 8;
    setLangFlyoutStyle({
      position: 'fixed',
      top: Math.min(
        Math.max(8, rect.top + rect.height / 2),
        window.innerHeight - 8,
      ),
      ...(openLeft
        ? { right: window.innerWidth - rect.left + gap, left: 'auto' }
        : { left: Math.min(rect.right + gap, window.innerWidth - flyoutWidth - 8), right: 'auto' }),
      transform: 'translateY(-50%)',
      zIndex: 13000,
    });
  };

  const openLangFlyout = () => {
    clearLangCloseTimer();
    updateLangFlyoutPosition();
    setLangOpen(true);
  };

  const scheduleCloseLangFlyout = () => {
    clearLangCloseTimer();
    langCloseTimerRef.current = setTimeout(() => setLangOpen(false), 120);
  };

  useEffect(() => {
    if (activeSheet !== 'more') setLangOpen(false);
  }, [activeSheet]);

  useEffect(() => {
    if (!langOpen) return;
    const onResize = () => updateLangFlyoutPosition();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [langOpen]);

  useEffect(() => () => clearLangCloseTimer(), []);

  const handleSelectLocale = (code: Locale) => {
    setLocale(code);
    setLangOpen(false);
  };

  return (
    <>
      {activeSheet === 'speaker' && (
        <>
          <button className={`${styles.actionSheetItem} ${mobileAudioState === 'earpiece' ? styles.active : ''}`} onClick={() => { setMobileAudioState('earpiece'); setActiveSheet(null); setToastMsg(t('toolbar.earpieceEnabled') || '已切换到耳机'); if (toastTimerRef.current) clearTimeout(toastTimerRef.current); toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 18v-6a9 9 0 0118 0v6M3 18a3 3 0 003 3h1a2 2 0 002-2v-4a2 2 0 00-2-2H4a2 2 0 00-2 2zM21 18a3 3 0 01-3 3h-1a2 2 0 01-2-2v-4a2 2 0 012-2h3a2 2 0 012 2z" /></svg>
            {t('toolbar.earpiece') || '耳机'}
          </button>
          <button className={`${styles.actionSheetItem} ${mobileAudioState === 'bluetooth' ? styles.active : ''}`} onClick={() => { setMobileAudioState('bluetooth'); setActiveSheet(null); setToastMsg(t('toolbar.bluetoothEnabled') || '已切换到蓝牙'); if (toastTimerRef.current) clearTimeout(toastTimerRef.current); toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6.5 7.5l11 9L12 22V2l5.5 5.5-11 9" /></svg>
            {t('toolbar.bluetooth') || '蓝牙'}
          </button>
          <button className={`${styles.actionSheetItem} ${mobileAudioState === 'speaker' ? styles.active : ''}`} onClick={() => { setMobileAudioState('speaker'); setActiveSheet(null); setToastMsg(t('toolbar.speakerEnabled') || '已切换到外放'); if (toastTimerRef.current) clearTimeout(toastTimerRef.current); toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000); }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
            {t('toolbar.loudspeaker') || '外放'}
          </button>
        </>
      )}

      {activeSheet === 'views' && (
        <>
          {canShowOperatorMenus && (
            <button className={`${styles.actionSheetItem} ${activeView === 'liveDoc' ? styles.active : ''}`} onClick={() => { onViewChange('liveDoc'); setActiveSheet(null); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              {t('toolbar.liveDocCanvas')}
            </button>
          )}
          {canShowOperatorMenus && (
            <button className={`${styles.actionSheetItem} ${activeView === 'webcam' ? styles.active : ''}`} onClick={() => { onViewChange('webcam'); setActiveSheet(null); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              {t('toolbar.webcamGrid')}
            </button>
          )}
          <button
            className={`${styles.actionSheetItem} ${activeView === 'shareScreen' ? styles.active : ''}`}
            onClick={() => { handleShareScreenClick(); setActiveSheet(null); }}
          >
            <svg viewBox="0 0 24 24" fill="none"
              stroke={canShareScreen ? 'currentColor' : '#fb923c'}
              strokeWidth="1.5"
            >
              <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span style={canShareScreen ? undefined : { color: '#fb923c' }}>
              {t('toolbar.screenShareLayout')}
              {!canShareScreen && (
                <span style={{ fontSize: '11px', marginLeft: '6px', color: '#fb923c', fontWeight: 400 }}>
                  ({t('toolbar.shareConflictTitle')})
                </span>
              )}
            </span>
          </button>
        </>
      )}

      {activeSheet === 'more' && (
        <>
          {isMobile && (
            <button
              type="button"
              className={styles.actionSheetItem}
              onClick={() => setActiveSheet('speaker')}
            >
              {mobileAudioState === 'earpiece' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 18v-6a9 9 0 0118 0v6M3 18a3 3 0 003 3h1a2 2 0 002-2v-4a2 2 0 00-2-2H4a2 2 0 00-2 2zM21 18a3 3 0 01-3 3h-1a2 2 0 01-2-2v-4a2 2 0 012-2h3a2 2 0 012 2z" /></svg>
              ) : mobileAudioState === 'bluetooth' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6.5 7.5l11 9L12 22V2l5.5 5.5-11 9" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
              )}
              {t('toolbar.speakerSettings')}
            </button>
          )}
          {activeView === 'liveDoc' && canShowOperatorMenus && (
            <button
              type="button"
              className={styles.actionSheetItem}
              onClick={() => {
                const iframe =
                  (document.getElementById('sharedIframePlayer') as HTMLIFrameElement | null) ??
                  document.querySelector<HTMLIFrameElement>('iframe[title="LiveDoc"]');
                iframe?.contentWindow?.postMessage({ type: 'Kloud-ShowAiPresentThink', show: 1 }, '*');
                setActiveSheet(null);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="14" rx="2" />
                <path d="M8 21h8M12 18v3" strokeLinecap="round" />
                <path d="M8 10h.01M12 10h.01M16 10h.01" strokeLinecap="round" />
              </svg>
              {t('toolbar.aiPresent')}
            </button>
          )}
          {canRecord && (
            <button
              className={styles.actionSheetItem}
              onClick={() => {
                // 录制中：Stop Recording（与录制气泡同一 handler）；否则打开录制弹窗
                if (isRecording) onStopRecording?.();
                else onOpenRecordPopup?.();
                setActiveSheet(null);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="6" fill={isRecording ? "#ef4444" : "none"} /><circle cx="12" cy="12" r="10" /></svg>
              <span className={styles.actionSheetItemLabel}>
                {isRecording ? t('toolbar.stopRecording') : t('toolbar.record')}
              </span>
              {isRecording && (
                <span className={styles.recStatus}>
                  <span className={styles.recStatusDot} aria-hidden="true" />
                  {t('toolbar.recording')}
                </span>
              )}
            </button>
          )}
          {canMuteAll && (
            <button
              className={`${styles.actionSheetItem} ${muteAllActive ? styles.active : ''}`}
              onClick={() => { muteAllActive ? onUnmuteAll?.() : onMuteAll?.(); setActiveSheet(null); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                {muteAllActive ? (
                  <>
                    <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" />
                    <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
                    <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                    <path d="M19 10v2a7 7 0 01-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </>
                )}
              </svg>
              {muteAllActive ? t('toolbar.unmuteAll') : t('toolbar.muteAll')}
            </button>
          )}
          {canToggleCaptions && (
            <button
              className={`${styles.actionSheetItem} ${captionsEnabled ? styles.active : ''}`}
              onClick={() => { onOpenSTTSettings?.(); setActiveSheet(null); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <path d="M6 12h4M6 16h8" strokeLinecap="round" />
                {captionsEnabled && (
                  <circle cx="18" cy="8" r="3.5" fill="currentColor" stroke="none" />
                )}
              </svg>
              {captionsEnabled ? t('toolbar.captionsOn') : t('toolbar.captionsOff')}
            </button>
          )}
          {captionsEnabled && (
            <button
              className={styles.actionSheetItem}
              onClick={() => { onOpenCCSettings?.(); setActiveSheet(null); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <path d="M6 12h4M6 16h8" strokeLinecap="round" />
              </svg>
              {localSubtitleVisible ? t('toolbar.ccShow') || 'Closed Caption - Show' : t('toolbar.ccHide') || 'Closed Caption - Hide'}
            </button>
          )}
          <div className={styles.menuDivider} role="separator" />
          <button className={styles.actionSheetItem} onClick={() => {
            if (onOpenDesktopApp) {
              onOpenDesktopApp();
            } else {
              const currentUrl = new URL(window.location.href);
              const rn = currentUrl.pathname.split('/').filter(Boolean).pop() || '';
              window.location.href = `kloudmeet://join/${encodeURIComponent(rn)}${currentUrl.search}`;
            }
            setActiveSheet(null);
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            {t('toolbar.openDesktop.menuItem')}
          </button>

          {/* 语言：悬停/点击时在左侧弹出 */}
          <div
            ref={langAnchorRef}
            className={styles.langMenuAnchor}
            onMouseEnter={openLangFlyout}
            onMouseLeave={scheduleCloseLangFlyout}
          >
            <button
              type="button"
              className={`${styles.actionSheetItem}${langOpen ? ` ${styles.active}` : ''}`}
              onClick={() => {
                if (langOpen) {
                  setLangOpen(false);
                  return;
                }
                openLangFlyout();
              }}
              aria-expanded={langOpen}
              aria-haspopup="listbox"
              aria-label={t('toolbar.language')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
              </svg>
              <span className={styles.actionSheetItemLabel}>{t('toolbar.language')}</span>
              <span className={styles.actionSheetItemMeta}>
                <span className={styles.langBadge}>{currentLocale.shortCode}</span>
                <svg
                  className={styles.langChevronLeft}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  width="16"
                  height="16"
                  aria-hidden
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </span>
            </button>
            {langOpen &&
              langFlyoutStyle &&
              createPortal(
                <div
                  className={styles.langFlyout}
                  style={langFlyoutStyle}
                  role="listbox"
                  aria-label={t('toolbar.language')}
                  onMouseEnter={openLangFlyout}
                  onMouseLeave={scheduleCloseLangFlyout}
                >
                  {LOCALE_OPTIONS.map((opt) => {
                    const selected = opt.code === locale;
                    return (
                      <button
                        key={opt.code}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`${styles.langFlyoutItem}${selected ? ` ${styles.langFlyoutItemActive}` : ''}`}
                        onClick={() => handleSelectLocale(opt.code)}
                      >
                        <span>{opt.label}</span>
                        <span className={styles.langFlyoutItemMeta}>
                          {selected && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14" aria-hidden>
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                          <span className={styles.langBadge}>{opt.shortCode}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>,
                document.body,
              )}
          </div>

          <button className={styles.actionSheetItem} onClick={() => { onOpenHelp?.(); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" /></svg>
            {t('toolbar.help')}
          </button>
        </>
      )}

      {canRecord && activeSheet === 'recording' && (
        <>
          <button className={`${styles.actionSheetItem} ${styles.actionSheetItemDanger}`} onClick={() => { onStopRecording?.(); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            {t('toolbar.stopRecording')}
          </button>
        </>
      )}

      {activeSheet === 'exit' && (
        <>
          <button className={styles.actionSheetItem} onClick={() => { onExit(); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            {t('toolbar.leaveTheMeeting')}
          </button>
          {canEndForAll && (
            <button className={`${styles.actionSheetItem} ${styles.actionSheetItemDanger}`} onClick={() => { if (onEndForAll) onEndForAll(); else onExit(); setActiveSheet(null); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              {t('toolbar.endForEveryone')}
            </button>
          )}
        </>
      )}
    </>
  );
}
