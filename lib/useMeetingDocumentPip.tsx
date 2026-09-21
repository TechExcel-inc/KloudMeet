'use client';

import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RoomContext } from '@livekit/components-react';
import { RoomEvent, Track, type Room } from 'livekit-client';
import {
  copyDocumentStyles,
  getDocumentPictureInPicture,
  isWebDocumentPipEligible,
  setMediaSessionActionHandler,
} from '@/lib/documentPipSupport';
import type { KloudTileMediaRestrictionProps } from '@/app/rooms/[roomName]/roomVideoLayouts';
import {
  ParticipantRoleMenuProvider,
  type ParticipantRoleActionsConfig,
} from '@/lib/ParticipantRoleMenu';
import {
  MeetingDocumentPipPanel,
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

function pipMiniKey(roomName: string): string {
  return `skymeet:doc-pip:${roomName}:mini`;
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
}

export interface MeetingDocumentPipApi {
  open: (opts?: { sticky?: boolean; minimized?: boolean }) => Promise<boolean>;
  close: () => void;
  isOpen: boolean;
}

let keepaliveStream: MediaStream | null = null;
let keepaliveGen = 0;

/** 开麦/摄像头前立刻放开占麦，避免和 LiveKit 抢同一设备 */
export function releaseDocumentPipKeepalive(): void {
  keepaliveGen += 1;
  if (!keepaliveStream) return;
  keepaliveStream.getTracks().forEach((track) => track.stop());
  keepaliveStream = null;
}

function hasLiveCapture(room: Room): boolean {
  const local = room.localParticipant;
  const sources = [Track.Source.Microphone, Track.Source.Camera, Track.Source.ScreenShare];
  return sources.some((source) => {
    const track = local.getTrackPublication(source)?.track;
    return track?.mediaStreamTrack.readyState === 'live';
  });
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
 * useMeetingDocumentPip — 网页端切 tab 打开 Document PiP；人员列表与主界面静音机制一致。
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
}: UseMeetingDocumentPipOptions): MeetingDocumentPipApi {
  const [isOpen, setIsOpen] = useState(false);
  const pipWindowRef = useRef<Window | null>(null);
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
  const openedInMeetingRef = useRef(false);

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

  const renderPanel = useRef(() => {
    const root = rootRef.current;
    const win = pipWindowRef.current;
    if (!root || !win || win.closed) return;

    root.render(
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
            initialMinimized={minimizedRef.current}
            onMinimizedChange={(next) => {
              minimizedRef.current = next;
              writeSessionFlag(pipMiniKey(roomRef.current.name), next);
            }}
            onToggleMic={() => {
              releaseDocumentPipKeepalive();
              onToggleMicRef.current();
            }}
            onToggleCam={() => {
              releaseDocumentPipKeepalive();
              onToggleCamRef.current();
            }}
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
          />
        </ParticipantRoleMenuProvider>
      </RoomContext.Provider>,
    );
  }).current;

  const openPip = useRef(async (opts?: {
    sticky?: boolean;
    minimized?: boolean;
  }): Promise<boolean> => {
    if (!isWebDocumentPipEligible()) return false;
    if (opts?.sticky) stickyRef.current = true;
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      setIsOpen(true);
      return true;
    }
    if (openingRef.current) return false;

    const api = getDocumentPictureInPicture();
    if (!api) return false;

    const roomName = roomRef.current.name;
    if (opts?.minimized !== undefined) {
      minimizedRef.current = opts.minimized;
    } else if (sessionFlag(pipOpenedKey(roomName)) !== true) {
      minimizedRef.current = true;
    } else {
      const storedMini = sessionFlag(pipMiniKey(roomName));
      if (storedMini !== null) minimizedRef.current = storedMini;
    }
    const firstOpen = sessionFlag(pipOpenedKey(roomName)) !== true && !openedInMeetingRef.current;

    openingRef.current = true;
    try {
      // Chrome 用 requestWindow 的宽高当位置缓存键，变了就丢；moveTo 禁用，打开后 resizeTo 也常无效。
      // 本场第一次：按缩小固定高度 59.2 打开。之后不再传宽高，让 Chrome 还原上次关闭时的位置和大小。
      const pipWindow = firstOpen
        ? await api.requestWindow({
            width: PIP_EXPANDED_W,
            height: PIP_MINIMIZED_H,
            preferInitialWindowPlacement: true,
          })
        : await api.requestWindow();

      pipWindowRef.current = pipWindow;
      openedInMeetingRef.current = true;
      writeSessionFlag(pipOpenedKey(roomName), true);
      writeSessionFlag(pipMiniKey(roomName), minimizedRef.current);
      copyDocumentStyles(document, pipWindow.document);

      pipWindow.document.documentElement.setAttribute('data-lk-theme', 'default');
      pipWindow.document.documentElement.setAttribute('data-kloud-pip', 'true');
      pipWindow.document.documentElement.style.height = '100%';
      pipWindow.document.body.style.margin = '0';
      pipWindow.document.body.style.height = '100%';
      pipWindow.document.body.style.overflow = 'hidden';
      pipWindow.document.body.style.background = '#1a1b1e';

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
        () => {
          releaseDocumentPipKeepalive();
          onToggleMicRef.current();
        },
        () => {
          releaseDocumentPipKeepalive();
          onToggleCamRef.current();
        },
      );

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
        }
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
  }, [micEnabled, camEnabled, shareActive, hasScreenShare, labels, localName, room, mediaRestrictions, roleActions, renderPanel]);

  useEffect(() => {
    if (!enabled || !isWebDocumentPipEligible()) {
      closePip();
      return;
    }

    setMediaSessionActionHandler('enterpictureinpicture', () => {
      void openPip();
    });
    setMediaSessionActionHandler('togglemicrophone', null);
    setMediaSessionActionHandler('hangup', () => {
      onLeaveRef.current();
      closePip();
    });

    const onVisibility = () => {
      if (stickyRef.current) return;
      if (!document.hidden) {
        closePip();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      setMediaSessionActionHandler('enterpictureinpicture', null);
      setMediaSessionActionHandler('togglemicrophone', null);
      setMediaSessionActionHandler('hangup', null);
      document.removeEventListener('visibilitychange', onVisibility);
      closePip();
    };
  }, [enabled, openPip, closePip]);

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

  useEffect(() => {
    if (!enabled || !isWebDocumentPipEligible()) return;
    if (micEnabled || camEnabled || hasLiveCapture(room)) {
      releaseDocumentPipKeepalive();
      return;
    }

    let cancelled = false;

    const start = async () => {
      const gen = keepaliveGen;
      try {
        const next = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        if (cancelled || gen !== keepaliveGen) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        keepaliveStream?.getTracks().forEach((track) => track.stop());
        keepaliveStream = next;
      } catch {
        // 无麦克风权限时 Chrome 不会走自动 PiP
      }
    };

    void start();

    const onLocalTrack = () => {
      if (!hasLiveCapture(room)) return;
      releaseDocumentPipKeepalive();
    };

    room.on(RoomEvent.LocalTrackPublished, onLocalTrack);

    return () => {
      cancelled = true;
      room.off(RoomEvent.LocalTrackPublished, onLocalTrack);
      releaseDocumentPipKeepalive();
    };
  }, [enabled, room, micEnabled, camEnabled]);

  return { open: openPip, close: closePip, isOpen };
}
