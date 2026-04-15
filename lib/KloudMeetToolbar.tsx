'use client';

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MediaDeviceMenu } from '@livekit/components-react';
import styles from '../styles/KloudMeetToolbar.module.css';
import { useToolbarIsMobile } from './useToolbarIsMobile';
import { useI18n } from './i18n';

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
  canToggleCaptions,
  captionsEnabled,
  onToggleCaptions,
}: KloudMeetToolbarProps) {
  const [visible, setVisible] = useState(true);
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
  const bottomAreaPriorityUntilRef = useRef<number>(0);
  const lastToggleTimeRef = useRef<number>(0);

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
        lastMouseYRef.current = e.clientY;
        const target = e.target as Element;
        const isHoveringMenu = !!(
          toolbarRef.current?.contains(target) ||
          target?.closest?.('.lk-device-menu, .lk-menu, [class*="lk-"]')
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
          console.log("111");
          lastToggleTimeRef.current = now;
          setVisible(prev => !prev);
        }
        return;
      }

      if (msgType === 'mousemove') {
        if (isMobile) return; // 移动端没有鼠标悬浮逻辑，不需要处理 iframe 的 mousemove

        const now = Date.now();
        if (now < bottomAreaPriorityUntilRef.current) {
          // 底部热区刚触发过时，忽略主区 mousemove 的短时抖动覆盖
          return;
        }
        const data =
          typeof payload === 'object' && payload !== null && 'data' in payload
            ? (payload as { data?: unknown }).data
            : null;
        const yFromData =
          typeof data === 'object' && data !== null && 'clientY' in data
            ? Number((data as { clientY?: unknown }).clientY)
            : typeof data === 'object' && data !== null && 'y' in data
              ? Number((data as { y?: unknown }).y)
              : NaN;

        if (Number.isFinite(yFromData)) {
          lastMouseYRef.current = yFromData;
          applyMouseVisibility(yFromData);
        } else {
          // data 为空时，按“主区域移动”处理（等价于靠上区域）
          applyMouseVisibility(0);
        }
        return;
      }

      // 来自 iframe 底部热区：等价鼠标在底部，显示 toolbar
      if (msgType === 'Kloud-onBottomAreaMouseMove') {
        if (isMobile) return; // 移动端不需要 hover 热区

        bottomAreaPriorityUntilRef.current = Date.now() + 220;
        lastMouseYRef.current = window.innerHeight;
        applyMouseVisibility(window.innerHeight);
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

  return (
    <>
      {/* Toast */}
      {toastMsg && <div className={styles.toast}>{toastMsg}</div>}

      {/* Chevron handle when hidden */}
      {!visible && !isMobile && (
        <div className={styles.chevronHandle}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 15l-6-6-6 6" />
          </svg>
        </div>
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
                  className={`${styles.controlBtn} ${!micEnabled ? styles.controlBtnOff : ''}`}
                  onClick={onToggleMic}
                  title={micEnabled ? t('toolbar.muteMic') : t('toolbar.unmuteMic')}
                >
                  {micEnabled ? (
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z" />
                      <line x1="4" y1="4" x2="20" y2="20" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" />
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
                    style={{ opacity: canShareScreen ? 1 : 0.5, cursor: canShareScreen ? 'pointer' : 'not-allowed' }}
                    title={!canShareScreen ? t('toolbar.shareScreenTooltip') : t('toolbar.shareScreen')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    {t('toolbar.shareScreen')}
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
          <button className={`${styles.actionSheetItem} ${activeView === 'shareScreen' ? styles.active : ''}`} onClick={() => { handleShareScreenClick(); setActiveSheet(null); }} style={{ opacity: canShareScreen ? 1 : 0.5 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            {t('toolbar.screenShareLayout')}
          </button>
        </>
      )}

      {activeSheet === 'more' && (
        <>
          <button className={styles.actionSheetItem} onClick={() => {
            const chatBtn = document.querySelector('[ref="chatMenuBtnRef"]') as HTMLButtonElement;
            if (chatBtn) chatBtn.click();
            setActiveSheet('chat_redirect');
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {t('toolbar.chats')}
          </button>

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
              onClick={() => { onToggleCaptions?.(); setActiveSheet(null); }}
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
          <button className={`${styles.actionSheetItem} ${attendeeOpen ? styles.active : ''}`} onClick={() => { handleToggleAttendee(); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            {t('toolbar.peopleAttendees')}
          </button>
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
          <button className={styles.actionSheetItem} onClick={() => {
            const currentUrl = new URL(window.location.href);
            const rn = currentUrl.pathname.split('/').filter(Boolean).pop() || '';
            window.location.href = `kloudmeet://join/${encodeURIComponent(rn)}${currentUrl.search}`;
            setActiveSheet(null);
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            {t('toolbar.launchInApp')}
          </button>
          <button className={styles.actionSheetItem} onClick={() => { showComingSoon(t('toolbar.appDeviceSettings')); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" /><circle cx="12" cy="12" r="3" /></svg>
            {t('toolbar.appDeviceSettings')}
          </button>
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
