'use client';

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MediaDeviceMenu } from '@livekit/components-react';
import styles from '../styles/KloudMeetToolbar.module.css';
import { useToolbarIsMobile } from './useToolbarIsMobile';
import { useI18n } from './i18n';
import { STTSettingsDialog } from './RtasrHelper/STTSettingsDialog';
import { CCSettingsDialog } from './RtasrHelper/CCSettingsDialog';

export type ViewMode = 'liveDoc' | 'webcam' | 'shareScreen';

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
  /** Whether this local user has been force-muted by the host (distinct from voluntary self-mute) */
  isMutedByHost?: boolean;
  /** Only host/co-host can toggle captions */
  canToggleCaptions?: boolean;
  /** Whether captions are currently active */
  captionsEnabled?: boolean;
  onToggleCaptions?: () => void;
}

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
  chatOpen,
  onToggleChat,
  attendeeOpen,
  onToggleAttendee,
  onOpenSheet,
  chatPanelSlot,
  attendeePanelSlot,
  canEndForAll,
  isRecording,
  onOpenRecordPopup,
  onStopRecording,
  onOpenHelp,
  canMuteAll,
  muteAllActive,
  onMuteAll,
  onUnmuteAll,
  isMutedByHost,
  canToggleCaptions,
  captionsEnabled,
  onToggleCaptions,
}: KloudMeetToolbarProps) {
  const [visible, setVisible] = useState(true);
  const [iframeMouseActive, setIframeMouseActive] = useState(false);
  const iframeMouseInactiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useI18n();
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const moreMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const recordMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const exitMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const chatMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const attendeeMenuBtnRef = useRef<HTMLButtonElement | null>(null);
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

  type ActionSheetType = 'views' | 'more' | 'exit' | 'recording' | 'speaker' | null;
  const [activeSheet, setActiveSheet] = useState<ActionSheetType>(null);
  const activeSheetRef = useRef<ActionSheetType>(null);
  activeSheetRef.current = activeSheet;
  const [showSTTSettings, setShowSTTSettings] = useState(false);
  const [showCCSettings, setShowCCSettings] = useState(false);
  const [localSubtitleVisible, setLocalSubtitleVisible] = useState(true);
  const [liveDocPluginLoaded, setLiveDocPluginLoaded] = useState(false);
  const [liveDocActionDialogVisible, setLiveDocActionDialogVisible] = useState(false);

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

  // Synchronous wrapper: close Chat/Attendee BEFORE opening a sheet
  const openSheet = (sheet: ActionSheetType) => {
    if (sheet !== null) {
      onOpenSheet?.(); // closes Chat & Attendee in parent synchronously
    }
    setActiveSheet(sheet);
  };

  const handleToggleChat = () => {
    setActiveSheet(null); // close any open sheet
    onToggleChat();
  };

  const handleToggleAttendee = () => {
    setActiveSheet(null); // close any open sheet
    onToggleAttendee();
  };

  const isMobile = useToolbarIsMobile();
  const [mobileAudioState, setMobileAudioState] = useState<'earpiece' | 'bluetooth' | 'speaker'>('speaker');
  const lastMouseYRef = useRef<number>(window.innerHeight);
  const lastToggleTimeRef = useRef<number>(0);
  const iframeMouseSuppressUntilRef = useRef<number>(0);
  // 记录插件最后一次告知是否允许显示 SkyMeet 底栏，用于阻止 hoverZone 在 suppress 期间重新激活。
  const lastIframeShowRef = useRef<boolean>(true);

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

  const applyMouseVisibility = (clientY: number, forceVisible?: boolean) => {
    if (activeSheetRef.current || chatOpen || attendeeOpen || forceVisible) {
      setVisible(true);
      return;
    }
    const threshold = window.innerHeight - 90;
    setVisible(clientY >= threshold);
  };

  useEffect(() => {
    if (isMobile) {
      // Logic for mobile: Auto-hide after 30 seconds of inactivity
      let hideTimer: ReturnType<typeof setTimeout> | null = null;

      const startTimer = () => {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          setVisible(false);
        }, 30000); // 30 seconds
      };

      if (visible) {
        startTimer();
      } else {
        if (hideTimer) clearTimeout(hideTimer);
      }

      const handleBodyClick = (e: MouseEvent | TouchEvent) => {
        if (e.type === 'touchstart') {
          lastToggleTimeRef.current = Date.now();
        } else if (e.type === 'click') {
          if (Date.now() - lastToggleTimeRef.current < 1000) {
            return;
          }
        }

        // If toolbar is currently hidden, ANY tap on the screen should show it.
        if (!visible) {
          setVisible(true);
          return;
        }

        const target = e.target as Element;

        // If visible, check if they tapped inside a toolbar component
        const isToolbarArea = !!(
          toolbarRef.current?.contains(target) ||
          target.closest?.('#mobileTopRightBtn') ||
          target.closest?.('.lk-device-menu') ||
          target.closest?.('.lk-menu') ||
          target.closest?.(`.${styles.actionSheetOverlay}`) ||
          target.closest?.(`.${styles.actionSheet}`)
        );

        if (isToolbarArea) {
          // They are using the toolbar, just refresh the 30s timer
          startTimer();
          return;
        }

        // They clicked outside, so hide it
        setVisible(false);
      };

      document.addEventListener('click', handleBodyClick, { capture: true });
      document.addEventListener('touchstart', handleBodyClick, { capture: true, passive: true });
      return () => {
        if (hideTimer) clearTimeout(hideTimer);
        document.removeEventListener('click', handleBodyClick, { capture: true });
        document.removeEventListener('touchstart', handleBodyClick, { capture: true });
      };
    } else {
      // Desktop mousemove logic
      const handleMouseMove = (e: MouseEvent) => {
        // 鼠标在 iframe 内移动时，由 iframe 主导显示/隐藏；父页面 mousemove 暂停一小段时间。
        if (Date.now() < iframeMouseSuppressUntilRef.current) {
          return;
        }
        lastMouseYRef.current = e.clientY;
        const target = e.target as Element;
        // forceVisible 只在鼠标直接悬浮在 toolbar 本身或其弹出菜单上时为 true
        // 注意：不能用 [class*="lk-"]，那会匹配参与者视频卡片等所有 LiveKit 元素
        const isHoveringMenu = !!(
          toolbarRef.current?.contains(target) ||
          target?.closest?.('.lk-device-menu, .lk-menu')
        );
        applyMouseVisibility(e.clientY, isHoveringMenu);
      };
      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
    }
  }, [isMobile, visible, chatOpen, attendeeOpen, activeSheet]);

  // 接收 iframe postMessage：mousemove 和点击事件沿用同一套显示/隐藏逻辑
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data;
      const msgType =
        typeof payload === 'object' && payload !== null && 'type' in payload
          ? String((payload as { type?: unknown }).type ?? '')
          : '';

      if (msgType === 'Kloud-onMouseClick' && isMobile) {
        // iframe 内部点击，移动端 toggle 菜单显示隐藏。加一个简单的节流防止 touchstart+click 重复触发
        const now = Date.now();
        if (now - lastToggleTimeRef.current > 500) {
          lastToggleTimeRef.current = now;
          setVisible(prev => !prev);
        }
        return;
      }

      if (msgType === 'onkloudloaded') {
        setLiveDocPluginLoaded(true);
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

      // 由 iframe 决定是否显示 SkyMeet 底栏：plugin 侧已综合判断 liveToolbar 区与底部区域。
      if (msgType === 'mousemove') {
        if (isMobile) return;

        const data =
          typeof payload === 'object' && payload !== null && 'data' in payload
            ? (payload as { data?: unknown }).data
            : null;
        const show =
          typeof data === 'object' &&
          data !== null &&
          'showBottomToolbar' in data &&
          !!(data as { showBottomToolbar?: unknown }).showBottomToolbar;

        // 鼠标在 iframe 内的每次 mousemove 都暂停父页面 mousemove handler 一小段时间，
        // 避免父页面 mousemove 反复把 toolbar 顶回显示。
        iframeMouseSuppressUntilRef.current = Date.now() + 200;
        // 同步给 hoverZone：iframe 内有鼠标移动时，让 hoverZone 不接收事件，
        // 避免遮挡 iframe 内 liveToolbar 上的按钮和拖拽。
        if (!iframeMouseActive) setIframeMouseActive(true);
        if (iframeMouseInactiveTimerRef.current) clearTimeout(iframeMouseInactiveTimerRef.current);
        iframeMouseInactiveTimerRef.current = setTimeout(() => {
          setIframeMouseActive(false);
        }, 250);

        lastIframeShowRef.current = show;
        const clientY = show ? window.innerHeight : 0;
        lastMouseYRef.current = clientY;
        applyMouseVisibility(clientY);
        return;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isMobile, chatOpen, attendeeOpen]);

  // 鼠标离开窗口/页面失焦时，桌面端按“上方区域”处理，避免 toolbar 悬停不消失
  useEffect(() => {
    const hideByLeave = () => {
      if (!isMobile && !activeSheetRef.current && !chatOpen && !attendeeOpen) {
        setVisible(false);
      }
    };
    const handleMouseOut = (e: MouseEvent) => {
      // 当 relatedTarget 为 null 且鼠标超出了可视区域时，才认为是真正的离开窗口
      if (!e.relatedTarget) {
        if (e.clientY <= 0 || e.clientX <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight - 1) {
          hideByLeave();
        }
      }
    };
    window.addEventListener('mouseout', handleMouseOut);
    window.addEventListener('blur', hideByLeave);
    return () => {
      window.removeEventListener('mouseout', handleMouseOut);
      window.removeEventListener('blur', hideByLeave);
    };
  }, [isMobile, chatOpen, attendeeOpen]);

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
      const preferredMaxHeight =
        desktopAnchorBubbleKind === 'chat'
          ? 500
          : desktopAnchorBubbleKind === 'attendee'
            ? 500
            : 440;
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
  }, [desktopAnchorBubbleKind, isMobile, visible, chatOpen, attendeeOpen]);

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
        desktopAnchorBubbleKind === 'chat'
          ? 500
          : desktopAnchorBubbleKind === 'attendee'
            ? 500
            : 440;
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

  const showComingSoon = (feature: string) => {
    setToastMsg(t('toolbar.comingSoon', { feature }));
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000);
  };

  const handleShareScreenClick = () => {
    onShareScreen();
  };

  const handleLiveDocSettingsClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const x = e.pageX;
    const y = e.pageY - 80;
    const show = liveDocActionDialogVisible ? 0 : 1;
    const iframe =
      (document.getElementById('sharedIframePlayer') as HTMLIFrameElement | null)
      ?? document.querySelector<HTMLIFrameElement>('iframe[title="LiveDoc"]');

    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        {
          type: 'Kloud-ShowActionDialog',
          x,
          y,
          show,
        },
        '*',
      );
    }
  };

  return (
    <>
      {/* Toast */}
      {toastMsg && <div className={styles.toast}>{toastMsg}</div>}

      {/* Hover zone + chevron handle when toolbar is hidden (desktop only) */}
      {!visible && !isMobile && (
        <>
          {/* Invisible trigger area covering the toolbar's natural position */}
          <div
            className={styles.hoverZone}
            // iframe 内持续有鼠标移动时，让 hoverZone 不吃事件，鼠标直接命中 iframe（liveToolbar 等）。
            style={iframeMouseActive ? { pointerEvents: 'none' } : undefined}
            onMouseEnter={() => {
              if (Date.now() < iframeMouseSuppressUntilRef.current) return;
              // 插件最后一次告知不显示时（如鼠标在 liveToolbar 区停留后点击），不触发显示。
              if (!lastIframeShowRef.current) return;
              setVisible(true);
            }}
          />
          {/* Small visual arrow hint at center bottom */}
          <div className={styles.chevronHandle}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </div>
        </>
      )}

      {/* Main toolbar */}
      <div
        ref={toolbarRef}
        className={`${styles.toolbar} ${isMobile ? styles.mobileToolbar : ''} ${!visible ? styles.toolbarHidden : ''}`}
      >
        {isMobile ? (
          <>
            {/* 1. Audio (Mic) */}
            <div className={styles.controlGroup} style={{ gap: '4px' }}>
              <button
                className={`${styles.controlBtn} ${!micEnabled ? styles.controlBtnOff : ''}`}
                onClick={onToggleMic}
                style={{ width: '36px', height: '36px' }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '16px', height: '16px' }}>
                  {micEnabled ? (
                    <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z" />
                  ) : (
                    <>
                      <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z" />
                      <line x1="4" y1="4" x2="20" y2="20" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" />
                    </>
                  )}
                </svg>
              </button>
              <MediaDeviceMenu kind="audioinput" className={styles.chevron} style={{ padding: '0 2px', color: '#fff' }} title={t('toolbar.micSettings')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ width: '12px', height: '12px' }}><path d="M18 15l-6-6-6 6" /></svg>
              </MediaDeviceMenu>
            </div>

            {/* 2. Webcam */}
            <div className={styles.controlGroup} style={{ gap: '4px' }}>
              <button
                className={`${styles.controlBtn} ${!camEnabled ? styles.controlBtnOff : ''}`}
                onClick={onToggleCam}
                style={{ width: '36px', height: '36px' }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '16px', height: '16px' }}>
                  {camEnabled ? (
                    <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                  ) : (
                    <>
                      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                      <line x1="4" y1="4" x2="20" y2="20" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" />
                    </>
                  )}
                </svg>
              </button>
              <MediaDeviceMenu kind="videoinput" className={styles.chevron} style={{ padding: '0 2px', color: '#fff' }} title={t('toolbar.camSettings')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ width: '12px', height: '12px' }}><path d="M18 15l-6-6-6 6" /></svg>
              </MediaDeviceMenu>
            </div>

            {/* 3. Speaker */}
            <div className={styles.controlGroup} style={{ gap: '4px' }}>
              <button
                className={`${styles.controlBtn} ${styles.controlBtnSpeaker}`}
                title={t('toolbar.speakerSettings') || 'Speaker Settings'}
                onClick={() => openSheet('speaker')}
                style={{ width: '36px', height: '36px' }}
              >
                {mobileAudioState === 'speaker' && <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '16px', height: '16px' }}><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>}
                {mobileAudioState === 'earpiece' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '16px', height: '16px' }}><path strokeLinecap="round" strokeLinejoin="round" d="M3 18v-6a9 9 0 0118 0v6M3 18a3 3 0 003 3h1a2 2 0 002-2v-4a2 2 0 00-2-2H4a2 2 0 00-2 2zM21 18a3 3 0 01-3 3h-1a2 2 0 01-2-2v-4a2 2 0 012-2h3a2 2 0 012 2z" /></svg>}
                {mobileAudioState === 'bluetooth' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: '16px', height: '16px' }}><path strokeLinecap="round" strokeLinejoin="round" d="M6.5 7.5l11 9L12 22V2l5.5 5.5-11 9" /></svg>}
              </button>
              <button className={styles.chevron} style={{ padding: '0 2px', color: '#fff', border: 'none', background: 'transparent' }} onClick={() => openSheet('speaker')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ width: '12px', height: '12px' }}><path d="M18 15l-6-6-6 6" /></svg>
              </button>
            </div>

            {/* 4. Views */}
            {canSwitchViews && (
              <button
                className={styles.mobileBtn}
                onClick={() => openSheet('views')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                </svg>
              </button>
            )}

            {/* 5. Invite */}
            <button
              className={styles.mobileBtn}
              onClick={() => {
                navigator.clipboard.writeText(buildInviteLinkForClipboard(isDesktop));
                setToastMsg(t('toolbar.inviteCopied'));
                if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
                toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
              <span>{t('toolbar.invite')}</span>
            </button>

            {/* 6. More */}
            <button
              className={styles.mobileBtn}
              onClick={() => openSheet('more')}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
              </svg>
              <span>{t('toolbar.more')}</span>
            </button>
          </>
        ) : (
          <>
            {/* Left: mic / cam / speaker toggles */}
            <div className={styles.leftControls}>
              <div className={styles.controlGroup}>
                <button
                  className={`${styles.controlBtn} ${!micEnabled ? styles.controlBtnOff : ''} ${isMutedByHost && !micEnabled ? styles.controlBtnMutedByHost : ''}`}
                  onClick={onToggleMic}
                  title={isMutedByHost ? 'Muted by host' : (micEnabled ? t('toolbar.muteMic') : t('toolbar.unmuteMic'))}
                >
                  {micEnabled ? (
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z" />
                      <line x1="4" y1="4" x2="20" y2="20" stroke={isMutedByHost ? '#ef4444' : '#f87171'} strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
                <MediaDeviceMenu kind="audioinput" className={styles.chevron} title={t('toolbar.micSettings')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>
                </MediaDeviceMenu>
              </div>

              <div className={styles.controlGroup}>
                <button
                  className={`${styles.controlBtn} ${!camEnabled ? styles.controlBtnOff : ''}`}
                  onClick={onToggleCam}
                  title={camEnabled ? t('toolbar.turnOffCam') : t('toolbar.turnOnCam')}
                >
                  {camEnabled ? (
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                      <line x1="4" y1="4" x2="20" y2="20" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
                <MediaDeviceMenu kind="videoinput" className={styles.chevron} title={t('toolbar.camSettings')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>
                </MediaDeviceMenu>
              </div>

              <div className={styles.controlGroup}>
                <button className={`${styles.controlBtn} ${styles.controlBtnSpeaker}`} title={t('toolbar.speakerSettings')} onClick={() => showComingSoon(t('toolbar.speakerSettings'))}>
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
                </button>
                <MediaDeviceMenu kind="audiooutput" className={styles.chevron} title={t('toolbar.speakerSettings')}>
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
                    {t('toolbar.liveDoc')}
                  </button>
                  {false && activeView === 'liveDoc' && liveDocPluginLoaded && (
                    <button
                      type="button"
                      className={`${styles.tabBtn} ${styles.liveDocActionBtn} ${liveDocActionDialogVisible ? styles.tabBtnActive : ''}`}
                      onClick={handleLiveDocSettingsClick}
                      title={t('toolbar.liveDocMenu')}
                      aria-label={t('toolbar.liveDocMenu')}
                    >
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M22.3865 15.2115C22.3287 14.9062 22.1794 14.6257 21.9583 14.4073C21.7373 14.1889 21.455 14.043 21.149 13.989C21.1034 13.9831 21.0599 13.9664 21.0221 13.9403C20.9843 13.9142 20.9532 13.8795 20.9315 13.839C20.91 13.7982 20.8976 13.7531 20.8953 13.707C20.893 13.6609 20.9007 13.6149 20.918 13.572C21.0246 13.2792 21.0436 12.9615 20.9724 12.6581C20.9013 12.3546 20.7432 12.0785 20.5175 11.8635C19.9415 11.2851 19.2427 10.8437 18.473 10.572C18.3239 10.5232 18.1678 10.4988 18.011 10.5C17.7706 10.4999 17.533 10.5505 17.3136 10.6484C17.0941 10.7464 16.8978 10.8895 16.7375 11.0685C16.7119 11.1045 16.6782 11.1337 16.6391 11.1539C16.5999 11.1742 16.5565 11.1847 16.5125 11.1847C16.4684 11.1847 16.425 11.1742 16.3859 11.1539C16.3467 11.1337 16.313 11.1045 16.2875 11.0685C16.1729 10.8948 16.0173 10.7521 15.8344 10.6529C15.6515 10.5537 15.447 10.5012 15.239 10.5C15.0813 10.5004 14.9248 10.5263 14.7755 10.5765C13.9343 10.8451 13.1583 11.2859 12.497 11.871C12.272 12.0858 12.1143 12.3614 12.0432 12.6643C11.9721 12.9671 11.9906 13.2841 12.0965 13.5765C12.1137 13.6194 12.1215 13.6654 12.1191 13.7115C12.1168 13.7576 12.1045 13.8027 12.083 13.8435C12.0613 13.8841 12.0303 13.9189 11.9924 13.945C11.9546 13.9711 11.9111 13.9877 11.8655 13.9935C11.5604 14.0481 11.2791 14.194 11.0589 14.4121C10.8387 14.6302 10.69 14.91 10.6325 15.2145C10.4585 16.0652 10.4585 16.9423 10.6325 17.793C10.6902 18.0984 10.8395 18.3789 11.0606 18.5973C11.2816 18.8157 11.5639 18.9615 11.87 19.0155C11.9157 19.021 11.9594 19.0375 11.9972 19.0637C12.0351 19.0898 12.0661 19.1248 12.0875 19.1655C12.109 19.2064 12.1213 19.2514 12.1236 19.2976C12.126 19.3437 12.1182 19.3897 12.101 19.4325C11.9941 19.7253 11.9749 20.0428 12.0458 20.3463C12.1166 20.6497 12.2745 20.9259 12.5 21.141C13.1191 21.7213 13.8557 22.1618 14.66 22.4325C14.9478 22.5297 15.2588 22.5345 15.5495 22.4463C15.8402 22.3581 16.0961 22.1813 16.2815 21.9405C16.307 21.9046 16.3407 21.8753 16.3799 21.8551C16.419 21.8349 16.4624 21.8244 16.5065 21.8244C16.5505 21.8244 16.5939 21.8349 16.6331 21.8551C16.6722 21.8753 16.7059 21.9046 16.7315 21.9405C16.8702 22.1161 17.0472 22.2577 17.2489 22.3547C17.4506 22.4516 17.6717 22.5013 17.8955 22.5C18.0526 22.4998 18.2086 22.4739 18.3575 22.4235C19.1608 22.1542 19.8965 21.7147 20.5145 21.135C20.7403 20.9196 20.8984 20.6428 20.9693 20.3388C21.0402 20.0348 21.0208 19.7167 20.9135 19.4235C20.8966 19.3806 20.8891 19.3346 20.8914 19.2886C20.8937 19.2425 20.9058 19.1975 20.927 19.1565C20.9484 19.1156 20.9796 19.0805 21.0178 19.0543C21.056 19.0282 21.1 19.0118 21.146 19.0065C21.4526 18.9528 21.7356 18.8069 21.9573 18.5882C22.1789 18.3695 22.3286 18.0885 22.3865 17.7825C22.5605 16.9329 22.5605 16.0567 22.3865 15.207V15.2115ZM20.918 17.4615C20.6482 17.505 20.3918 17.6092 20.1683 17.7665C19.9448 17.9237 19.76 18.1298 19.628 18.369C19.4949 18.6119 19.4156 18.8804 19.3954 19.1566C19.3752 19.4327 19.4146 19.71 19.511 19.9695C19.0466 20.4023 18.4954 20.7311 17.894 20.934C17.7318 20.7202 17.5224 20.5469 17.2821 20.4275C17.0417 20.3081 16.777 20.246 16.5087 20.246C16.2404 20.246 15.9757 20.3081 15.7354 20.4275C15.495 20.5469 15.2856 20.7202 15.1235 20.934C14.5199 20.7334 13.9664 20.4055 13.5005 19.9725C13.5964 19.7134 13.6356 19.4367 13.6155 19.1611C13.5953 18.8855 13.5162 18.6174 13.3835 18.375C13.2517 18.1361 13.0674 17.9303 12.8445 17.7731C12.6215 17.6159 12.3657 17.5114 12.0965 17.4675C12.0323 17.149 12.0001 16.8249 12.0005 16.5C12.0004 16.1745 12.0336 15.8498 12.0995 15.531C12.3672 15.4879 12.6217 15.3845 12.8436 15.2286C13.0655 15.0726 13.2491 14.8683 13.3805 14.631C13.5141 14.3885 13.594 14.12 13.6147 13.8439C13.6354 13.5677 13.5964 13.2903 13.5005 13.0305C13.9659 12.5949 14.5194 12.2639 15.1235 12.06C15.2856 12.2739 15.495 12.4472 15.7354 12.5666C15.9757 12.686 16.2404 12.7481 16.5087 12.7481C16.777 12.7481 17.0417 12.686 17.2821 12.5666C17.5224 12.4472 17.7318 12.2739 17.894 12.06C18.4971 12.2625 19.0497 12.5925 19.514 13.0275C19.4183 13.2868 19.3794 13.5636 19.3998 13.8392C19.4203 14.1147 19.4996 14.3827 19.6325 14.625C19.7641 14.863 19.9483 15.0678 20.1711 15.2237C20.3939 15.3797 20.6493 15.4828 20.918 15.525C21.0499 16.1638 21.0499 16.8228 20.918 17.4615Z" fill="currentColor"/>
                        <path d="M16.5 14.16C16.033 14.1414 15.571 14.263 15.1736 14.5091C14.7762 14.7551 14.4615 15.1144 14.2699 15.5407C14.0783 15.9671 14.0186 16.441 14.0985 16.9015C14.1783 17.3621 14.3941 17.7882 14.7181 18.1251C15.0421 18.462 15.4594 18.6944 15.9164 18.7922C16.3735 18.8901 16.8494 18.849 17.2829 18.6743C17.7164 18.4995 18.0878 18.1991 18.3492 17.8117C18.6107 17.4242 18.7502 16.9674 18.75 16.5C18.7609 15.8916 18.5302 15.3038 18.1084 14.8652C17.6867 14.4266 17.1083 14.173 16.5 14.16ZM16.5 17.28C16.3446 17.286 16.1909 17.2454 16.0588 17.1634C15.9266 17.0814 15.822 16.9618 15.7583 16.8199C15.6947 16.678 15.6749 16.5203 15.7015 16.3671C15.7281 16.2138 15.8 16.0721 15.9078 15.96C16.0155 15.8478 16.1544 15.7705 16.3065 15.7379C16.4585 15.7053 16.6169 15.7189 16.7611 15.777C16.9054 15.835 17.0291 15.9349 17.1162 16.0637C17.2033 16.1925 17.2499 16.3445 17.25 16.5C17.2536 16.7028 17.1767 16.8987 17.0361 17.0449C16.8956 17.1911 16.7028 17.2757 16.5 17.28ZM9.75 7.5H5.25C5.05109 7.5 4.86032 7.57902 4.71967 7.71967C4.57902 7.86032 4.5 8.05109 4.5 8.25C4.5 8.44891 4.57902 8.63968 4.71967 8.78033C4.86032 8.92098 5.05109 9 5.25 9H9.75C9.94891 9 10.1397 8.92098 10.2803 8.78033C10.421 8.63968 10.5 8.44891 10.5 8.25C10.5 8.05109 10.421 7.86032 10.2803 7.71967C10.1397 7.57902 9.94891 7.5 9.75 7.5ZM9.75 12H5.25C5.05109 12 4.86032 12.079 4.71967 12.2197C4.57902 12.3603 4.5 12.5511 4.5 12.75C4.5 12.9489 4.57902 13.1397 4.71967 13.2803C4.86032 13.421 5.05109 13.5 5.25 13.5H9.75C9.94891 13.5 10.1397 13.421 10.2803 13.2803C10.421 13.1397 10.5 12.9489 10.5 12.75C10.5 12.5511 10.421 12.3603 10.2803 12.2197C10.1397 12.079 9.94891 12 9.75 12Z" fill="currentColor"/>
                        <path d="M3 3H12V7.5C12 7.89783 12.158 8.27936 12.4393 8.56066C12.7206 8.84197 13.1022 9 13.5 9H19.5V8.1225C19.5002 7.92493 19.4613 7.72927 19.3856 7.54676C19.3099 7.36425 19.1989 7.19849 19.059 7.059L13.941 1.9395C13.8014 1.79985 13.6356 1.68913 13.4531 1.61371C13.2706 1.53829 13.075 1.49965 12.8775 1.5H3C2.60218 1.5 2.22064 1.65804 1.93934 1.93934C1.65804 2.22065 1.5 2.60218 1.5 3V21C1.5 21.3978 1.65804 21.7794 1.93934 22.0607C2.22064 22.342 2.60218 22.5 3 22.5H10.5V21H3V3ZM13.5 7.5V3.621L17.3775 7.5H13.5Z" fill="currentColor"/>
                        <path d="M8.25 18C8.44891 18 8.63968 17.921 8.78033 17.7803C8.92098 17.6397 9 17.4489 9 17.25C9 17.0511 8.92098 16.8603 8.78033 16.7197C8.63968 16.579 8.44891 16.5 8.25 16.5H5.25C5.05109 16.5 4.86032 16.579 4.71967 16.7197C4.57902 16.8603 4.5 17.0511 4.5 17.25C4.5 17.4489 4.57902 17.6397 4.71967 17.7803C4.86032 17.921 5.05109 18 5.25 18H8.25Z" fill="currentColor"/>
                      </svg>
                      {t('toolbar.liveDocMenu')}
                    </button>
                  )}

                  <button
                    className={`${styles.tabBtn} ${activeView === 'webcam' ? styles.tabBtnActive : ''}`}
                    onClick={() => onViewChange('webcam')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {t('toolbar.webcam')}
                  </button>

                  <button
                    className={`${styles.tabBtn} ${activeView === 'shareScreen' ? styles.tabBtnActive : ''} ${screenShareActive ? styles.tabBtnCheck : ''}`}
                    onClick={handleShareScreenClick}
                    title={hasScreenShare && !screenShareActive ? t('toolbar.shareConflictTitle') : t('toolbar.shareScreen')}
                    style={{ position: 'relative' }}
                  >
                    {/* Amber "live" pulse dot: another participant is sharing */}
                    {hasScreenShare && !screenShareActive && (
                      <span style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: '#f97316',
                        boxShadow: '0 0 0 0 rgba(249,115,22,0.5)',
                        animation: 'shareConflictPing 1.4s ease infinite',
                        pointerEvents: 'none',
                      }} />
                    )}
                    <style>{`
                      @keyframes shareConflictPing {
                        0%   { box-shadow: 0 0 0 0 rgba(249,115,22,0.55); }
                        60%  { box-shadow: 0 0 0 6px rgba(249,115,22,0); }
                        100% { box-shadow: 0 0 0 0 rgba(249,115,22,0); }
                      }
                    `}</style>
                    <svg viewBox="0 0 24 24" fill="none"
                      stroke={hasScreenShare && !screenShareActive ? '#fb923c' : 'currentColor'}
                      strokeWidth="1.5"
                    >
                      <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span style={hasScreenShare && !screenShareActive ? { color: '#fb923c' } : undefined}>
                      {t('toolbar.shareScreen')}
                    </span>
                  </button>

                  {hasScreenShare && (
                    <>
                      <button
                        className={`${styles.tabBtn} ${isDrawingMode ? styles.tabBtnCheck : ''}`}
                        onClick={onToggleDrawingMode}
                        title={t('toolbar.annotateTooltip')}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                        </svg>
                        {t('toolbar.annotate')}
                      </button>

                      <button
                        className={`${styles.tabBtn} ${isRemoteControlMode ? styles.tabBtnCheck : ''} ${remoteControlPending ? styles.tabBtnCheck : ''}`}
                        onClick={onToggleRemoteControlMode}
                        title={remoteControlPending ? t('toolbar.cancelRequest') : isRemoteControlMode ? t('toolbar.stopControl') : t('toolbar.requestControl')}
                        style={remoteControlPending ? { position: 'relative' } : undefined}
                      >
                        {remoteControlPending ? (
                          <>
                            <style>{`
                      @keyframes rcSpinner { to { transform: rotate(360deg); } }
                    `}</style>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'rcSpinner 1s linear infinite' }}>
                              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                            </svg>
                          </>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zm-7.518-.267A8.25 8.25 0 1120.25 10.5M8.288 14.212A5.25 5.25 0 1117.25 10.5" />
                          </svg>
                        )}
                        {remoteControlPending ? t('toolbar.requesting') : t('toolbar.control')}
                      </button>
                    </>
                  )}
                </>
              )}
              <button ref={attendeeMenuBtnRef} className={`${styles.tabBtn} ${attendeeOpen ? styles.tabBtnActive : ''}`} onClick={handleToggleAttendee}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {t('toolbar.attendees')}
              </button>

              <button
                className={`${styles.tabBtn} ${styles.tabBtnGreen}`}
                onClick={() => {
                  navigator.clipboard.writeText(buildInviteLinkForClipboard(isDesktop));
                  setToastMsg(t('toolbar.inviteCopied'));
                  if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
                  toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
                {t('toolbar.invite')}
              </button>

              <button ref={chatMenuBtnRef} className={`${styles.tabBtn} ${chatOpen ? styles.tabBtnActive : ''}`} onClick={handleToggleChat}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {t('toolbar.chats')}
              </button>

              {activeView === 'liveDoc' && liveDocPluginLoaded && (
                <button
                  type="button"
                  className={`${styles.tabBtn} ${styles.liveDocActionBtn} ${liveDocActionDialogVisible ? styles.tabBtnActive : ''}`}
                  onClick={handleLiveDocSettingsClick}
                  title={t('toolbar.liveDocMenu')}
                  aria-label={t('toolbar.liveDocMenu')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  {t('toolbar.liveDocMenu')}
                </button>
              )}
              <button ref={moreMenuBtnRef} type="button" className={styles.tabBtn} onClick={() => openSheet('more')}>
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
                </svg>
                {t('toolbar.more')}
              </button>

              {isRecording && (
                <button ref={recordMenuBtnRef} type="button" className={`${styles.tabBtn} ${activeSheet === 'recording' ? styles.tabBtnActive : ''}`} style={{ color: '#ef4444' }} onClick={() => openSheet('recording')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="6" fill="#ef4444" stroke="none" />
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                  {t('toolbar.recording')}
                </button>
              )}
            </div>

            <div className={styles.rightControls}>
              <button ref={exitMenuBtnRef} type="button" className={styles.exitBtn} onClick={() => openSheet('exit')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                {t('toolbar.exit')}
              </button>
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
                {activeSheet === 'views' ? t('toolbar.selectViewLayout') : activeSheet === 'recording' ? t('toolbar.recordingControls') : activeSheet === 'exit' ? t('toolbar.leaveMeeting') : t('toolbar.moreOptions')}
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
                handleToggleChat={handleToggleChat}
                onOpenSTTSettings={() => setShowSTTSettings(true)}
                onOpenCCSettings={() => setShowCCSettings(true)}
                localSubtitleVisible={localSubtitleVisible}
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
              isRecording={isRecording}
              onOpenRecordPopup={onOpenRecordPopup}
              onStopRecording={onStopRecording}
              onOpenHelp={onOpenHelp}
              handleToggleChat={handleToggleChat}
            />
          </div>
        </div>
      )}

      {desktopAnchorBubbleKind &&
        !isMobile &&
        (typeof document !== 'undefined'
          ? createPortal(
            <>
              <div
                role="presentation"
                className={styles.toolbarBubbleDismiss}
                onMouseDown={() => {
                  if (desktopAnchorBubbleKind === 'more' || desktopAnchorBubbleKind === 'exit' || desktopAnchorBubbleKind === 'recording') {
                    setActiveSheet(null);
                  } else if (desktopAnchorBubbleKind === 'chat' && chatOpen) {
                    onToggleChat();
                  } else if (desktopAnchorBubbleKind === 'attendee' && attendeeOpen) {
                    onToggleAttendee();
                  }
                }}
              />
              <div
                ref={desktopBubbleRef}
                className={`${styles.toolbarBubble} ${desktopAnchorBubbleKind === 'chat' || desktopAnchorBubbleKind === 'attendee' ? styles.toolbarBubblePanel : ''
                  }`}
                style={
                  desktopBubblePos
                    ? ({
                      top: desktopBubblePos.top,
                      left: desktopBubblePos.left,
                      width: desktopBubblePos.width,
                      maxHeight: desktopBubblePos.maxHeight,
                      height: desktopBubblePos.height,
                      ['--toolbar-bubble-arrow' as string]: `${desktopBubblePos.arrowLeft}px`,
                      visibility: 'visible',
                    } as React.CSSProperties)
                    : ({ visibility: 'hidden', pointerEvents: 'none' } as React.CSSProperties)
                }
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className={styles.toolbarBubbleArrow} aria-hidden />
                <div className={styles.toolbarBubbleHeader}>
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
                      onOpenSTTSettings={() => setShowSTTSettings(true)}
                      onOpenCCSettings={() => setShowCCSettings(true)}
                      localSubtitleVisible={localSubtitleVisible}
                    />
                  </div>
                )}
              </div>
            </>,
            document.body,
          )
          : null)}

      {isMobile && (
        <div
          id="mobileTopRightBtn"
          style={{
            position: 'fixed', top: '12px', right: '12px', zIndex: 60,
            display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px',
            opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none',
            transition: 'opacity 0.3s ease',
          }}
        >
          {/* Chat button */}
          <button
            onClick={(e) => { e.stopPropagation(); handleToggleChat(); }}
            aria-label="Chat"
            title={t('toolbar.chats') || 'Chat'}
            style={{
              background: chatOpen
                ? 'rgba(99, 102, 241, 0.85)'
                : 'rgba(17, 24, 39, 0.70)',
              backdropFilter: 'blur(10px)',
              color: '#fff', border: 'none', borderRadius: '50%',
              width: '40px', height: '40px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
              cursor: 'pointer', flexShrink: 0,
              transition: 'background 0.2s',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="19" height="19">
              <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>

          {/* Recording button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isRecording) {
                // Already recording → show stop/pause sheet
                openSheet('recording');
              } else {
                // Not recording → open the same record popup as web
                onOpenRecordPopup?.();
              }
            }}
            aria-label={isRecording ? (t('toolbar.recording') || 'Recording') : (t('toolbar.record') || 'Record')}
            title={isRecording ? (t('toolbar.recording') || 'Recording') : (t('toolbar.record') || 'Record')}
            style={{
              background: isRecording
                ? 'rgba(239, 68, 68, 0.85)'
                : 'rgba(17, 24, 39, 0.70)',
              backdropFilter: 'blur(10px)',
              color: '#fff', border: 'none', borderRadius: '50%',
              width: '40px', height: '40px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
              cursor: 'pointer', flexShrink: 0,
              transition: 'background 0.2s',
              // pulse animation when recording
              animation: isRecording ? 'mobileRecordPulse 1.8s ease-in-out infinite' : 'none',
            }}
          >
            {isRecording ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="19" height="19">
                <circle cx="12" cy="12" r="5" fill="#fff" stroke="none" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="19" height="19">
                <circle cx="12" cy="12" r="5" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            )}
          </button>

          {/* Exit button */}
          <button
            onClick={(e) => { e.stopPropagation(); openSheet('exit'); }}
            aria-label={t('toolbar.exit') || 'Exit'}
            title={t('toolbar.exit') || 'Exit'}
            style={{
              background: 'rgba(239, 68, 68, 0.80)',
              backdropFilter: 'blur(10px)',
              color: '#fff', border: 'none', borderRadius: '50%',
              width: '40px', height: '40px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
              cursor: 'pointer', flexShrink: 0,
              transition: 'background 0.2s',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="19" height="19">
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
      />
      
      <CCSettingsDialog
        isOpen={showCCSettings}
        onClose={() => setShowCCSettings(false)}
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
}: any) {
  const { t } = useI18n();
  const showComingSoon = (feature: string) => {
    setToastMsg(t('toolbar.comingSoon', { feature }));
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000);
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
          <button className={`${styles.actionSheetItem} ${activeView === 'liveDoc' ? styles.active : ''}`} onClick={() => { onViewChange('liveDoc'); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            {t('toolbar.liveDocCanvas')}
          </button>
          <button className={`${styles.actionSheetItem} ${activeView === 'webcam' ? styles.active : ''}`} onClick={() => { onViewChange('webcam'); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            {t('toolbar.webcamGrid')}
          </button>
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
          {/*
          <button className={styles.actionSheetItem} onClick={() => handleToggleChat()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {t('toolbar.chats')}
          </button>
          */}

          {!isRecording && (
            <button className={`${styles.actionSheetItem} ${isRecording ? styles.active : ''}`} onClick={() => { onOpenRecordPopup?.(); setActiveSheet(null); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="6" fill={isRecording ? "#ef4444" : "none"} /><circle cx="12" cy="12" r="10" /></svg>
              {isRecording ? t('toolbar.stopRecording') : t('toolbar.record')}
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
          {/*
          <button className={`${styles.actionSheetItem} ${attendeeOpen ? styles.active : ''}`} onClick={() => { handleToggleAttendee(); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            {t('toolbar.peopleAttendees')}
          </button>
          */}
          {false && (
            <button className={styles.actionSheetItem} onClick={() => {
              navigator.clipboard.writeText(buildInviteLinkForClipboard(isDesktop));
              setToastMsg(t('toolbar.inviteCopied'));
              if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
              toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000);
              setActiveSheet(null);
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
              {t('toolbar.copyInviteLink')}
            </button>
          )}
          <button className={styles.actionSheetItem} onClick={() => {
            const currentUrl = new URL(window.location.href);
            const rn = currentUrl.pathname.split('/').filter(Boolean).pop() || '';
            window.location.href = `kloudmeet://join/${encodeURIComponent(rn)}${currentUrl.search}`;
            setActiveSheet(null);
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            {t('toolbar.launchInApp')}
          </button>
          {false && (
            <button className={styles.actionSheetItem} onClick={() => { showComingSoon(t('toolbar.appDeviceSettings')); setActiveSheet(null); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" /><circle cx="12" cy="12" r="3" /></svg>
              {t('toolbar.appDeviceSettings')}
            </button>
          )}
          <button className={styles.actionSheetItem} onClick={() => { onOpenHelp?.(); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" /></svg>
            {t('toolbar.help')}
          </button>
        </>
      )}

      {activeSheet === 'recording' && (
        <>
          <button className={styles.actionSheetItem} onClick={() => { showComingSoon(t('toolbar.pauseRecording')); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
            {t('toolbar.pauseRecording')}
          </button>
          <button className={styles.actionSheetItem} style={{ color: '#ef4444' }} onClick={() => { onStopRecording?.(); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            {t('toolbar.stopRecording')}
          </button>

          <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '8px 16px' }} />

          <button className={styles.actionSheetItem} onClick={() => { showComingSoon(t('toolbar.liveTranscript')); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" /></svg>
            {t('toolbar.liveTranscript')}
          </button>

          <div style={{ padding: '8px 16px', fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '4px' }}>{t('toolbar.cloudRecordingSettings')}</div>

          <button className={styles.actionSheetItem} onClick={() => { showComingSoon(t('toolbar.cloudRecordingMode')); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>
            {t('toolbar.cloudRecordingMode')}
          </button>

          <label className={styles.actionSheetItem} style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
              {t('toolbar.syncTranscript')}
            </div>
            <input type="checkbox" defaultChecked style={{ accentColor: '#0b57d0' }} />
          </label>

          <div style={{ padding: '8px 16px', fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '4px' }}>{t('toolbar.localPermissions')}</div>

          <label className={styles.actionSheetItem} style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {t('toolbar.onlyHostRecord')}
            </div>
            <input type="checkbox" defaultChecked style={{ accentColor: '#0b57d0' }} />
          </label>
        </>
      )}

      {activeSheet === 'exit' && (
        <>
          <button className={styles.actionSheetItem} onClick={() => { onExit(); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            {t('toolbar.leaveTheMeeting')}
          </button>
          {canEndForAll && (
            <button className={styles.actionSheetItem} onClick={() => { if (onEndForAll) onEndForAll(); else onExit(); setActiveSheet(null); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              {t('toolbar.endForEveryone')}
            </button>
          )}
        </>
      )}
    </>
  );
}
