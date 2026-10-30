'use client';

import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RoomContext } from '@livekit/components-react';
import { RoomEvent, type Room } from 'livekit-client';
import {
  copyDocumentStyles,
  getDesktopMiniWindow,
  getDocumentPictureInPicture,
  isMiniWindowEligible,
  isWebDocumentPipEligible,
  setMediaSessionActionHandler,
  type DesktopMiniWindow,
} from '@/lib/documentPipSupport';
import type { KloudTileMediaRestrictionProps } from '@/app/rooms/[roomName]/roomVideoLayouts';
import { I18nScope, useI18n } from '@/lib/i18n';
import { visibleRemoteParticipants } from '@/lib/recorderParticipant';
import {
  ParticipantRoleMenuProvider,
  type ParticipantRoleActionsConfig,
} from '@/lib/ParticipantRoleMenu';
import {
  MeetingDocumentPipPanel,
  PIP_EXPANDED_H,
  PIP_EXPANDED_W,
  PIP_MINIMIZED_H,
  type MeetingDocumentPipLabels,
} from '@/lib/MeetingDocumentPipPanel';

function sessionFlag(key: string): boolean | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
}

function writeSessionFlag(key: string, value: boolean): void {
  try {
    sessionStorage.setItem(key, value ? '1' : '0');
  } catch {
    // 无存储权限时跳过
  }
}

function pipOpenedKey(roomName: string): string {
  return `skymeet:doc-pip:${roomName}:opened`;
}

/** Alternates the pill's requested height so Chrome can't restore a cached (expanded) size */
const PIP_PILL_FLIP_KEY = 'skymeet:doc-pip:pill-flip';

function pipMiniKey(roomName: string): string {
  return `skymeet:doc-pip:${roomName}:mini`;
}

function pipDismissKey(roomName: string): string {
  return `skymeet:doc-pip:${roomName}:dismissed`;
}

/** Closing an automatically opened SmartCam twice in a meeting stops it popping up there. */
const AUTO_OPEN_DISMISS_LIMIT = 2;

function readDismissCount(roomName: string): number {
  try {
    return Number(sessionStorage.getItem(pipDismissKey(roomName))) || 0;
  } catch {
    return 0;
  }
}

function bumpDismissCount(roomName: string): void {
  try {
    sessionStorage.setItem(pipDismissKey(roomName), String(readDismissCount(roomName) + 1));
  } catch {
    // 无存储权限时跳过
  }
}

export interface UseMeetingDocumentPipOptions {
  /** 入会且允许时开启监听（网页端由调用方排除手机/Electron） */
  enabled: boolean;
  room: Room;
  micEnabled: boolean;
  camEnabled: boolean;
  labels: MeetingDocumentPipLabels;
  localName: string;
  mediaRestrictions: KloudTileMediaRestrictionProps;
  /** 与主界面同一套 ⋯ 角色菜单配置 */
  roleActions: ParticipantRoleActionsConfig;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleShare: () => void;
  shareActive: boolean;
  hasScreenShare: boolean;
  onLeave: () => void;
  onEndForAll?: () => void;
  onMuteParticipant: (identity: string, disable: boolean) => void;
  onDisableParticipantVideo: (identity: string, disable: boolean) => void;
  /** Header: meeting name (instant meetings have none), start time, recording */
  meetingTitle?: string;
  startedAtMs?: number | null;
  isRecording?: boolean;
  /** Webcam view: the room already shows everyone, so an open SmartCam folds into the slim pill */
  keepMinimized?: boolean;
}

export interface MeetingDocumentPipApi {
  open: (opts?: {
    sticky?: boolean;
    minimized?: boolean;
    auto?: boolean;
    /** Web: open at the default spot and requested size, not where Chrome last left it */
    resetPlacement?: boolean;
  }) => Promise<boolean>;
  close: () => void;
  isOpen: boolean;
}

function bindPipTileClicks(
  pipDoc: Document,
  getLocalId: () => string,
  canOperate: () => boolean,
  onMuteParticipant: (identity: string, disable: boolean) => void,
  onDisableParticipantVideo: (identity: string, disable: boolean) => void,
  onToggleMic: () => void,
  onToggleCam: () => void,
): () => void {
  const onPointer = (e: Event) => {
    const target = e.target as Element | null;
    if (!target) return;
    const localId = getLocalId();

    const selfMic = target.closest('.kloud-custom-mic-indicator.self-interactive');
    if (selfMic) {
      const identity = selfMic.getAttribute('data-kloud-identity');
      if (identity === localId) {
        e.preventDefault();
        e.stopPropagation();
        onToggleMic();
        return;
      }
    }

    const selfCam = target.closest('.kloud-custom-cam-indicator.self-interactive');
    if (selfCam) {
      const identity = selfCam.getAttribute('data-kloud-identity');
      if (identity === localId) {
        e.preventDefault();
        e.stopPropagation();
        onToggleCam();
        return;
      }
    }

    if (!canOperate()) return;

    const micArea = target.closest('.kloud-custom-mic-indicator');
    if (micArea && target.closest('.lk-participant-tile')) {
      const identity = micArea.getAttribute('data-kloud-identity');
      if (identity && identity !== localId) {
        const restricted = micArea.getAttribute('data-kloud-host-restricted') === 'true';
        e.preventDefault();
        e.stopPropagation();
        onMuteParticipant(identity, !restricted);
        return;
      }
    }

    const camArea = target.closest('.kloud-custom-cam-indicator');
    if (camArea && target.closest('.lk-participant-tile')) {
      const identity = camArea.getAttribute('data-kloud-identity');
      if (identity && identity !== localId) {
        const restricted = camArea.getAttribute('data-kloud-host-restricted') === 'true';
        e.preventDefault();
        e.stopPropagation();
        onDisableParticipantVideo(identity, !restricted);
      }
    }
  };

  pipDoc.addEventListener('pointerdown', onPointer, true);
  return () => pipDoc.removeEventListener('pointerdown', onPointer, true);
}

/**
 * The desktop app's mini window: opened hidden as the meeting starts and kept until it ends, so
 * it already exists when a share starts (macOS keeps it out of the capture only then).
 */
function openDesktopMiniWindow(desktop: DesktopMiniWindow): Window | null {
  try {
    return window.open(
      'about:blank',
      desktop.name,
      `popup=yes,width=${PIP_EXPANDED_W},height=${Math.round(PIP_MINIMIZED_H)}`,
    );
  } catch {
    return null;
  }
}

/**
 * useMeetingDocumentPip — 网页端切 tab 打开 Document PiP；人员列表与主界面静音机制一致。
 * In the desktop app the same panel goes into the app's own mini window, which a screen share
 * leaves out (lib/documentPipSupport.ts getDesktopMiniWindow).
 */
export function useMeetingDocumentPip({
  enabled,
  room,
  micEnabled,
  camEnabled,
  labels,
  localName,
  mediaRestrictions,
  roleActions,
  onToggleMic,
  onToggleCam,
  onToggleShare,
  shareActive,
  hasScreenShare,
  onLeave,
  onEndForAll,
  onMuteParticipant,
  onDisableParticipantVideo,
  meetingTitle,
  startedAtMs,
  isRecording = false,
  keepMinimized = false,
}: UseMeetingDocumentPipOptions): MeetingDocumentPipApi {
  const i18n = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const pipWindowRef = useRef<Window | null>(null);
  /** Desktop app: the mini window, open (shown or hidden) for the whole meeting */
  const desktopWindowRef = useRef<Window | null>(null);
  const rootRef = useRef<Root | null>(null);
  const openingRef = useRef(false);
  const closingFromApiRef = useRef(false);
  const unbindClicksRef = useRef<(() => void) | null>(null);
  const stickyRef = useRef(false);

  const micRef = useRef(micEnabled);
  const camRef = useRef(camEnabled);
  const labelsRef = useRef(labels);
  const localNameRef = useRef(localName);
  const restrictionsRef = useRef(mediaRestrictions);
  const roleActionsRef = useRef(roleActions);
  const onToggleMicRef = useRef(onToggleMic);
  const onToggleCamRef = useRef(onToggleCam);
  const onToggleShareRef = useRef(onToggleShare);
  const shareActiveRef = useRef(shareActive);
  const hasScreenShareRef = useRef(hasScreenShare);
  const onLeaveRef = useRef(onLeave);
  const onEndForAllRef = useRef(onEndForAll);
  const onMuteRef = useRef(onMuteParticipant);
  const onDisableVideoRef = useRef(onDisableParticipantVideo);
  const roomRef = useRef(room);
  const minimizedRef = useRef(false);
  const collapseSignalRef = useRef(0);
  const openedInMeetingRef = useRef(false);
  /** Opened by Chrome's automatic picture-in-picture (switching tabs), not by a click */
  const autoOpenedRef = useRef(false);
  const i18nRef = useRef(i18n);
  const meetingTitleRef = useRef(meetingTitle);
  const startedAtRef = useRef(startedAtMs);
  const recordingRef = useRef(isRecording);
  meetingTitleRef.current = meetingTitle;
  startedAtRef.current = startedAtMs;
  recordingRef.current = isRecording;

  micRef.current = micEnabled;
  camRef.current = camEnabled;
  labelsRef.current = labels;
  localNameRef.current = localName;
  restrictionsRef.current = mediaRestrictions;
  roleActionsRef.current = roleActions;
  onToggleMicRef.current = onToggleMic;
  onToggleCamRef.current = onToggleCam;
  onToggleShareRef.current = onToggleShare;
  shareActiveRef.current = shareActive;
  hasScreenShareRef.current = hasScreenShare;
  onLeaveRef.current = onLeave;
  onEndForAllRef.current = onEndForAll;
  onMuteRef.current = onMuteParticipant;
  onDisableVideoRef.current = onDisableParticipantVideo;
  roomRef.current = room;
  i18nRef.current = i18n;

  const closePip = useRef(() => {
    const win = pipWindowRef.current;
    stickyRef.current = false;
    setIsOpen(false);
    closingFromApiRef.current = true;
    unbindClicksRef.current?.();
    unbindClicksRef.current = null;
    const root = rootRef.current;
    rootRef.current = null;
    if (root) {
      try {
        root.unmount();
      } catch {
        // ignore
      }
    }
    pipWindowRef.current = null;
    const desktop = getDesktopMiniWindow();
    if (desktop && win && win === desktopWindowRef.current && !win.closed) {
      // Hidden, not closed: it has to exist before the next share starts
      win.document.getElementById('meeting-document-pip-root')?.remove();
      desktop.hide();
      closingFromApiRef.current = false;
      return;
    }
    if (win && !win.closed) {
      try {
        win.close();
      } catch {
        closingFromApiRef.current = false;
      }
    } else {
      closingFromApiRef.current = false;
    }
  }).current;

  /** Desktop app: leaving the meeting closes the mini window for real */
  const disposeDesktopWindow = useRef(() => {
    const win = desktopWindowRef.current;
    desktopWindowRef.current = null;
    const desktop = getDesktopMiniWindow();
    if (!desktop || !win || win.closed) return;
    desktop.dispose();
    try {
      win.close();
    } catch {
      // ignore
    }
  }).current;

  const ensureDesktopWindow = useRef((): Window | null => {
    const desktop = getDesktopMiniWindow();
    if (!desktop) return null;
    const existing = desktopWindowRef.current;
    if (existing && !existing.closed) return existing;
    const win = openDesktopMiniWindow(desktop);
    desktopWindowRef.current = win;
    return win;
  }).current;

  const renderPanel = useRef(() => {
    const root = rootRef.current;
    const win = pipWindowRef.current;
    if (!root || !win || win.closed) return;

    root.render(
      <I18nScope value={i18nRef.current}>
        <RoomContext.Provider value={roomRef.current}>
          <ParticipantRoleMenuProvider
            {...roleActionsRef.current}
            doc={win.document}
            registerBridge={false}
          >
            <MeetingDocumentPipPanel
              room={roomRef.current}
              pipWindow={win}
              micEnabled={micRef.current}
              camEnabled={camRef.current}
              labels={labelsRef.current}
              localName={localNameRef.current}
              mediaRestrictions={restrictionsRef.current}
              meetingTitle={meetingTitleRef.current}
              startedAtMs={startedAtRef.current ?? null}
              isRecording={recordingRef.current}
              initialMinimized={minimizedRef.current}
              onMinimizedChange={(next) => {
                minimizedRef.current = next;
                writeSessionFlag(pipMiniKey(roomRef.current.name), next);
              }}
              collapseSignal={collapseSignalRef.current}
              onToggleMic={() => onToggleMicRef.current()}
              onToggleCam={() => onToggleCamRef.current()}
              onToggleShare={() => {
                if (!shareActiveRef.current) {
                  stickyRef.current = true;
                  const pip = pipWindowRef.current;
                  const opener = pip?.opener;
                  if (opener && !opener.closed) {
                    try {
                      opener.focus();
                    } catch {
                      // 部分环境不允许跨窗 focus
                    }
                  }
                }
                onToggleShareRef.current();
              }}
              shareActive={shareActiveRef.current}
              hasScreenShare={hasScreenShareRef.current}
              onLeave={() => {
                onLeaveRef.current();
                closePip();
              }}
              onEndForAll={
                onEndForAllRef.current
                  ? () => {
                      onEndForAllRef.current?.();
                      closePip();
                    }
                  : undefined
              }
              // The browser's PiP window has its own close button; the desktop one is frameless
              onClose={getDesktopMiniWindow() ? () => closePip() : undefined}
            />
          </ParticipantRoleMenuProvider>
        </RoomContext.Provider>
      </I18nScope>,
    );
  }).current;

  const openPip = useRef(async (opts?: {
    sticky?: boolean;
    minimized?: boolean;
    auto?: boolean;
    resetPlacement?: boolean;
  }): Promise<boolean> => {
    if (!isMiniWindowEligible()) return false;
    if (opts?.sticky) stickyRef.current = true;
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      if (!opts?.auto) autoOpenedRef.current = false;
      setIsOpen(true);
      return true;
    }
    if (openingRef.current) return false;

    const desktop = getDesktopMiniWindow();
    const api = desktop ? null : getDocumentPictureInPicture();
    if (!desktop && !api) return false;

    const roomName = roomRef.current.name;
    // First time in a meeting it opens with people showing; after that it keeps the
    // shape the person last left it in (full or the slim pill).
    if (opts?.minimized !== undefined) {
      minimizedRef.current = opts.minimized;
    } else {
      minimizedRef.current = sessionFlag(pipMiniKey(roomName)) === true;
    }
    const firstOpen = sessionFlag(pipOpenedKey(roomName)) !== true && !openedInMeetingRef.current;

    openingRef.current = true;
    try {
      // Chrome 用 requestWindow 的宽高当位置缓存键，变了就丢；moveTo 禁用，打开后 resizeTo 也常无效。
      // 本场第一次：按展开（或上次缩小）的尺寸打开。之后不再传宽高，让 Chrome 还原上次关闭时的位置和大小。
      // 切到摄像头视图时（resetPlacement）按细条尺寸、默认位置重开。Chrome 130 前不认
      // preferInitialWindowPlacement，同一宽高会还原缓存的大小，所以细条高度每次差 1px，让缓存键对不上。
      let pillH = Math.round(PIP_MINIMIZED_H);
      if (opts?.resetPlacement && !firstOpen) {
        const flip = sessionFlag(PIP_PILL_FLIP_KEY) !== true;
        writeSessionFlag(PIP_PILL_FLIP_KEY, flip);
        if (flip) pillH += 1;
      }
      const pipWindow = desktop
        ? ensureDesktopWindow()
        : firstOpen || opts?.resetPlacement
          ? await api!.requestWindow({
              width: PIP_EXPANDED_W,
              height: minimizedRef.current ? pillH : PIP_EXPANDED_H,
              preferInitialWindowPlacement: true,
              disallowReturnToOpener: true,
            })
          : await api!.requestWindow({ disallowReturnToOpener: true });
      if (!pipWindow) return false;
      if (desktop) {
        // The same document every time: start from a clean one
        pipWindow.document.head.replaceChildren();
        pipWindow.document.body.replaceChildren();
        pipWindow.document.title = labelsRef.current.meeting;
      }

      pipWindowRef.current = pipWindow;
      openedInMeetingRef.current = true;
      autoOpenedRef.current = Boolean(opts?.auto);
      writeSessionFlag(pipOpenedKey(roomName), true);
      writeSessionFlag(pipMiniKey(roomName), minimizedRef.current);
      copyDocumentStyles(document, pipWindow.document);

      pipWindow.document.documentElement.setAttribute('data-lk-theme', 'default');
      pipWindow.document.documentElement.setAttribute('data-kloud-pip', 'true');
      pipWindow.document.documentElement.style.height = '100%';
      pipWindow.document.body.style.margin = '0';
      pipWindow.document.body.style.height = '100%';
      pipWindow.document.body.style.overflow = 'hidden';
      // The desktop window is transparent: the pill keeps its round ends
      pipWindow.document.body.style.background = desktop ? 'transparent' : '#1a1b1e';
      if (desktop) pipWindow.document.documentElement.setAttribute('data-kloud-desktop-mini', 'true');

      const mount = pipWindow.document.createElement('div');
      mount.id = 'meeting-document-pip-root';
      mount.style.height = '100%';
      mount.style.width = '100%';
      pipWindow.document.body.appendChild(mount);

      rootRef.current = createRoot(mount);
      renderPanel();

      unbindClicksRef.current = bindPipTileClicks(
        pipWindow.document,
        () => roomRef.current.localParticipant.identity,
        () => restrictionsRef.current.isHost || restrictionsRef.current.isCohost,
        (identity, disable) => onMuteRef.current(identity, disable),
        (identity, disable) => onDisableVideoRef.current(identity, disable),
        () => onToggleMicRef.current(),
        () => onToggleCamRef.current(),
      );

      if (desktop) {
        desktop.setSize(PIP_EXPANDED_W, minimizedRef.current ? PIP_MINIMIZED_H : PIP_EXPANDED_H);
        desktop.show();
      }

      pipWindow.addEventListener('pagehide', () => {
        if (pipWindowRef.current !== pipWindow) return;
        const fromApi = closingFromApiRef.current;
        unbindClicksRef.current?.();
        unbindClicksRef.current = null;
        const root = rootRef.current;
        rootRef.current = null;
        pipWindowRef.current = null;
        if (root) {
          try {
            root.unmount();
          } catch {
            // ignore
          }
        }
        if (!fromApi) {
          stickyRef.current = false;
          // The person closed a window that popped up on its own: count it
          if (autoOpenedRef.current) bumpDismissCount(roomRef.current.name);
        }
        autoOpenedRef.current = false;
        setIsOpen(false);
        closingFromApiRef.current = false;
      });
      setIsOpen(true);
      return true;
    } catch {
      closePip();
      return false;
    } finally {
      openingRef.current = false;
    }
  }).current;

  useEffect(() => {
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      renderPanel();
    }
  }, [micEnabled, camEnabled, shareActive, hasScreenShare, labels, localName, room, mediaRestrictions, roleActions, i18n, meetingTitle, startedAtMs, isRecording, renderPanel]);

  // Switching to the webcam view folds an open SmartCam; the person can still expand it.
  // Reopening it later brings back whatever shape and place it was last left in.
  useEffect(() => {
    if (!keepMinimized) return;
    const win = pipWindowRef.current;
    if (!win || win.closed) return;
    minimizedRef.current = true;
    writeSessionFlag(pipMiniKey(roomRef.current.name), true);
    // Chrome only resizes its PiP window on a click inside it, so folding in place leaves a
    // tall empty window when the switch was clicked in the meeting. That click does let us
    // open the window again at the pill's size; try it before anything uses the click up.
    if (
      !getDesktopMiniWindow() &&
      win.innerHeight > PIP_MINIMIZED_H + 8 &&
      navigator.userActivation?.isActive
    ) {
      const sticky = stickyRef.current;
      closePip();
      void openPip({ sticky, minimized: true, resetPlacement: true });
      return;
    }
    collapseSignalRef.current += 1;
    renderPanel();
  }, [keepMinimized, renderPanel, closePip, openPip]);

  useEffect(() => {
    if (!enabled || !isMiniWindowEligible()) {
      closePip();
      disposeDesktopWindow();
      return;
    }

    const desktop = getDesktopMiniWindow();
    const web = isWebDocumentPipEligible();
    // Desktop: there before any share starts
    if (desktop) ensureDesktopWindow();

    if (web) {
      // Chrome's automatic picture-in-picture (switching tabs): only when there is someone
      // to keep an eye on, or you're presenting, and not after being closed twice here.
      setMediaSessionActionHandler('enterpictureinpicture', () => {
        const r = roomRef.current;
        if (visibleRemoteParticipants(r.remoteParticipants.values()).length === 0 && !shareActiveRef.current) return;
        if (readDismissCount(r.name) >= AUTO_OPEN_DISMISS_LIMIT) return;
        void openPip({ auto: true });
      });
      setMediaSessionActionHandler('togglemicrophone', null);
      setMediaSessionActionHandler('hangup', () => {
        onLeaveRef.current();
        closePip();
      });
    }

    const onVisibility = () => {
      // Chrome opens its PiP by itself when the tab goes; the desktop app does it here
      if (document.hidden) {
        if (desktop && !pipWindowRef.current) void openPip();
        return;
      }
      if (stickyRef.current) return;
      closePip();
    };

    document.addEventListener('visibilitychange', onVisibility);
    // ⌘W on the desktop mini window hides it; the panel goes with it
    const offHidden = desktop?.onHidden(() => {
      if (!pipWindowRef.current) return;
      closePip();
    });

    return () => {
      if (web) {
        setMediaSessionActionHandler('enterpictureinpicture', null);
        setMediaSessionActionHandler('togglemicrophone', null);
        setMediaSessionActionHandler('hangup', null);
      }
      document.removeEventListener('visibilitychange', onVisibility);
      offHidden?.();
      closePip();
      disposeDesktopWindow();
    };
  }, [enabled, openPip, closePip, disposeDesktopWindow, ensureDesktopWindow]);

  useEffect(() => {
    if (!enabled) return;
    const bump = () => {
      if (pipWindowRef.current && !pipWindowRef.current.closed) {
        renderPanel();
      }
    };
    const evs = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.ParticipantNameChanged,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
    ] as const;
    for (const e of evs) {
      room.on(e, bump);
    }
    return () => {
      for (const e of evs) {
        room.off(e, bump);
      }
    };
  }, [enabled, room, renderPanel]);

  return { open: openPip, close: closePip, isOpen };
}
