'use client';

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MediaDeviceMenu } from '@livekit/components-react';
import styles from '../styles/KloudMeetToolbar.module.css';
import { useToolbarIsMobile } from './useToolbarIsMobile';

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
}

export function KloudMeetToolbar({
  activeView,
  onViewChange,
  onExit,
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
}: KloudMeetToolbarProps) {
  const [visible, setVisible] = useState(true);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const moreMenuBtnRef = useRef<HTMLButtonElement | null>(null);
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

  type ActionSheetType = 'views' | 'more' | 'exit' | null;
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
  const lastMouseYRef = useRef<number>(window.innerHeight);
  const bottomAreaPriorityUntilRef = useRef<number>(0);

  type DesktopAnchorKind = 'more' | 'exit' | 'chat' | 'attendee';
  const desktopAnchorBubbleKind: DesktopAnchorKind | null =
    !isMobile
      ? activeSheet === 'more'
        ? 'more'
        : activeSheet === 'exit'
          ? 'exit'
          : chatOpen && chatPanelSlot
            ? 'chat'
            : attendeeOpen && attendeePanelSlot
              ? 'attendee'
              : null
      : null;

  const applyMouseVisibility = (clientY: number) => {
    if (isMobile) {
      setVisible(true); // Always visible on mobile
      return;
    }
    if (activeSheetRef.current || chatOpen || attendeeOpen) {
      setVisible(true);
      return;
    }
    const threshold = window.innerHeight - 90;
    setVisible(clientY >= threshold);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      lastMouseYRef.current = e.clientY;
      applyMouseVisibility(e.clientY);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [isMobile, chatOpen, attendeeOpen]);

  // 接收 iframe postMessage：mousemove 事件沿用同一套显示/隐藏逻辑
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data;
      const msgType =
        typeof payload === 'object' && payload !== null && 'type' in payload
          ? String((payload as { type?: unknown }).type ?? '')
          : '';
      if (msgType === 'mousemove') {
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
      if (!(e as MouseEvent).relatedTarget) hideByLeave();
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
      desktopAnchorBubbleKind === 'more'
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
      desktopAnchorBubbleKind === 'more'
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
    setToastMsg(`${feature} — Coming soon`);
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
        className={`${styles.toolbar} ${isMobile ? styles.mobileToolbar : ''} ${!visible && !isMobile ? styles.toolbarHidden : ''}`}
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
                    <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/>
                  ) : (
                    <>
                      <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/>
                      <line x1="4" y1="4" x2="20" y2="20" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" />
                    </>
                  )}
                </svg>
              </button>
              <MediaDeviceMenu kind="audioinput" className={styles.chevron} style={{ padding: '0 2px', color: '#fff' }} title="Microphone Settings">
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
                    <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                  ) : (
                    <>
                      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                      <line x1="4" y1="4" x2="20" y2="20" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" />
                    </>
                  )}
                </svg>
              </button>
              <MediaDeviceMenu kind="videoinput" className={styles.chevron} style={{ padding: '0 2px', color: '#fff' }} title="Camera Settings">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ width: '12px', height: '12px' }}><path d="M18 15l-6-6-6 6" /></svg>
              </MediaDeviceMenu>
            </div>

            {/* 3. Views */}
            {canSwitchViews && (
              <div className={styles.controlGroup} style={{ gap: '4px' }}>
                <button
                  className={`${styles.controlBtn} ${styles.controlBtnOff}`}
                  onClick={() => openSheet('views')}
                  style={{ width: '36px', height: '36px' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: '16px', height: '16px' }}>
                    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                  </svg>
                </button>
                <button className={styles.chevron} onClick={() => openSheet('views')} style={{ padding: '0 2px', color: '#fff' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ width: '10px', height: '10px' }}><path d="M18 15l-6-6-6 6" /></svg>
                </button>
              </div>
            )}

            {/* 4. Exit */}
            <button 
              className={styles.mobileBtn}
              onClick={() => openSheet('exit')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>Exit</span>
            </button>

            {/* 5. Chat */}
            <button 
              className={`${styles.mobileBtn} ${chatOpen ? styles.active : ''}`}
              onClick={handleToggleChat}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span>Chats</span>
            </button>

            {/* 6. More */}
            <button 
              className={styles.mobileBtn}
              onClick={() => openSheet('more')}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
              </svg>
              <span>More</span>
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
              title={micEnabled ? 'Mute Mic' : 'Unmute Mic'}
            >
              {micEnabled ? (
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/>
                  <line x1="4" y1="4" x2="20" y2="20" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              )}
            </button>
            <MediaDeviceMenu kind="audioinput" className={styles.chevron} title="Microphone Settings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>
            </MediaDeviceMenu>
          </div>

          <div className={styles.controlGroup}>
            <button
              className={`${styles.controlBtn} ${!camEnabled ? styles.controlBtnOff : ''}`}
              onClick={onToggleCam}
              title={camEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
            >
              {camEnabled ? (
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                  <line x1="4" y1="4" x2="20" y2="20" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              )}
            </button>
            <MediaDeviceMenu kind="videoinput" className={styles.chevron} title="Camera Settings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>
            </MediaDeviceMenu>
          </div>

          <div className={styles.controlGroup}>
            <button className={`${styles.controlBtn} ${styles.controlBtnSpeaker}`} title="Speaker Settings" onClick={() => showComingSoon('Speaker Settings')}>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            </button>
            <MediaDeviceMenu kind="audiooutput" className={styles.chevron} title="Speaker Settings">
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
            Live Doc
          </button>

          <button
            className={`${styles.tabBtn} ${activeView === 'webcam' ? styles.tabBtnActive : ''}`}
            onClick={() => onViewChange('webcam')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Webcam
          </button>

          <button
            className={`${styles.tabBtn} ${activeView === 'shareScreen' ? styles.tabBtnActive : ''}`}
            onClick={handleShareScreenClick}
            style={{ opacity: canShareScreen ? 1 : 0.5, cursor: canShareScreen ? 'pointer' : 'not-allowed' }}
            title={!canShareScreen ? 'Someone else is already sharing' : 'Share Screen'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Share Screen
          </button>

          {isDesktop && (
            <>
              <button
                className={`${styles.tabBtn} ${isDrawingMode ? styles.tabBtnActive : ''}`}
                onClick={onToggleDrawingMode}
                style={{ opacity: hasScreenShare ? 1 : 0.5, cursor: hasScreenShare ? 'pointer' : 'not-allowed' }}
                title={!hasScreenShare ? 'No active screenshare to annotate' : 'Annotate Screenshare'}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                </svg>
                Annotate
              </button>

              <button
                className={`${styles.tabBtn} ${isRemoteControlMode ? styles.tabBtnActive : ''}`}
                onClick={onToggleRemoteControlMode}
                style={{ opacity: hasScreenShare ? 1 : 0.5, cursor: hasScreenShare ? 'pointer' : 'not-allowed' }}
                title={!hasScreenShare ? 'No active screenshare to control' : 'Remote Control'}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zm-7.518-.267A8.25 8.25 0 1120.25 10.5M8.288 14.212A5.25 5.25 0 1117.25 10.5" />
                </svg>
                Control
              </button>
            </>
          )}
          </>
          )}
          <button ref={attendeeMenuBtnRef} className={`${styles.tabBtn} ${attendeeOpen ? styles.tabBtnActive : ''}`} onClick={handleToggleAttendee}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Attendees
          </button>

          <button
            className={`${styles.tabBtn} ${styles.tabBtnGreen}`}
            onClick={() => {
              navigator.clipboard.writeText(buildInviteLinkForClipboard(isDesktop));
              setToastMsg('Invite Link Copied to Clipboard!');
              if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
              toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
            </svg>
            Invite
          </button>

          <button ref={chatMenuBtnRef} className={`${styles.tabBtn} ${chatOpen ? styles.tabBtnActive : ''}`} onClick={handleToggleChat}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Chats
          </button>

          <button ref={moreMenuBtnRef} type="button" className={styles.tabBtn} onClick={() => openSheet('more')}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
            </svg>
            More
          </button>
        </div>

        <div className={styles.rightControls}>
          <button ref={exitMenuBtnRef} type="button" className={styles.exitBtn} onClick={() => openSheet('exit')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Exit
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
                {activeSheet === 'views' ? 'Select View Layout' : activeSheet === 'exit' ? 'Leave Meeting?' : 'More Options'}
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
                isDesktop={isDesktop}
                canEndForAll={canEndForAll}
              />
            </div>
          </div>
        </>
      )}

      {activeSheet === 'views' && !isMobile && (
        <div className={styles.desktopPopupMenu}>
          <div className={styles.desktopPopupMenuHeader}>
            <span className={styles.desktopPopupMenuTitle}>Select View Layout</span>
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
              isDesktop={isDesktop}
              canEndForAll={canEndForAll}
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
                    if (desktopAnchorBubbleKind === 'more' || desktopAnchorBubbleKind === 'exit') {
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
                  className={`${styles.toolbarBubble} ${
                    desktopAnchorBubbleKind === 'chat' || desktopAnchorBubbleKind === 'attendee' ? styles.toolbarBubblePanel : ''
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
                        ? 'Leave Meeting?'
                        : desktopAnchorBubbleKind === 'chat'
                          ? 'Chats'
                          : desktopAnchorBubbleKind === 'attendee'
                            ? 'Participants'
                            : 'More Options'}
                    </span>
                    <button
                      type="button"
                      className={styles.toolbarBubbleClose}
                      onClick={() => {
                        if (desktopAnchorBubbleKind === 'more' || desktopAnchorBubbleKind === 'exit') {
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
                        isDesktop={isDesktop}
                        canEndForAll={canEndForAll}
                      />
                    </div>
                  )}
                </div>
              </>,
              document.body,
            )
          : null)}
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
  isDesktop,
  canEndForAll,
}: any) {
  const showComingSoon = (feature: string) => {
    setToastMsg(`${feature} coming soon!`);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000);
  };

  return (
    <>
      {activeSheet === 'views' && (
        <>
          <button className={`${styles.actionSheetItem} ${activeView === 'liveDoc' ? styles.active : ''}`} onClick={() => { onViewChange('liveDoc'); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Live Doc & Collaborative Canvas
          </button>
          <button className={`${styles.actionSheetItem} ${activeView === 'webcam' ? styles.active : ''}`} onClick={() => { onViewChange('webcam'); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            Webcam Grid Video
          </button>
          <button className={`${styles.actionSheetItem} ${activeView === 'shareScreen' ? styles.active : ''}`} onClick={() => { handleShareScreenClick(); setActiveSheet(null); }} style={{ opacity: canShareScreen ? 1 : 0.5 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            Screen Share Layout
          </button>
        </>
      )}

      {activeSheet === 'more' && (
        <>
          <button className={`${styles.actionSheetItem} ${attendeeOpen ? styles.active : ''}`} onClick={() => { handleToggleAttendee(); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            People & Attendees
          </button>
          <button className={styles.actionSheetItem} onClick={() => { 
            navigator.clipboard.writeText(buildInviteLinkForClipboard(isDesktop));
            setToastMsg('Invite Link Copied to Clipboard!');
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
            toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000);
            setActiveSheet(null);
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
            Copy Invite Link
          </button>
          <button className={styles.actionSheetItem} onClick={() => {
            const currentUrl = new URL(window.location.href);
            const rn = currentUrl.pathname.split('/').filter(Boolean).pop() || '';
            window.location.href = `kloudmeet://join/${encodeURIComponent(rn)}${currentUrl.search}`;
            setActiveSheet(null);
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            Launch in App
          </button>
          <button className={styles.actionSheetItem} onClick={() => { showComingSoon('Setting'); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" /><circle cx="12" cy="12" r="3" /></svg>
            App & Device Settings
          </button>
        </>
      )}

      {activeSheet === 'exit' && (
        <>
          <button className={styles.actionSheetItem} onClick={() => { onExit(); setActiveSheet(null); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            Leave the meeting
          </button>
          {canEndForAll && (
            <button className={styles.actionSheetItem} onClick={() => { showComingSoon('End for All'); onExit(); setActiveSheet(null); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              End meeting for everyone
            </button>
          )}
        </>
      )}
    </>
  );
}
