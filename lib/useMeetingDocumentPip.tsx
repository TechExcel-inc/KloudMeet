'use client';

import { useEffect, useRef } from 'react';
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
  MeetingDocumentPipPanel,
  pipPillWindowSize,
  PIP_EXPANDED_H,
  PIP_EXPANDED_W,
  type MeetingDocumentPipLabels,
} from '@/lib/MeetingDocumentPipPanel';

export interface UseMeetingDocumentPipOptions {
  /** 入会且允许时开启监听（网页端由调用方排除手机/Electron） */
  enabled: boolean;
  /** 为 true 时浮窗保持打开，切回本 tab 也不自动关掉 */
  stayOpen: boolean;
  room: Room;
  micEnabled: boolean;
  camEnabled: boolean;
  labels: MeetingDocumentPipLabels;
  localName: string;
  mediaRestrictions: KloudTileMediaRestrictionProps;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onLeave: () => void;
  onMuteParticipant: (identity: string, disable: boolean) => void;
  onDisableParticipantVideo: (identity: string, disable: boolean) => void;
  onWindowClosed?: () => void;
}

export interface MeetingDocumentPipApi {
  open: () => Promise<boolean>;
  close: () => void;
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
  stayOpen,
  room,
  micEnabled,
  camEnabled,
  labels,
  localName,
  mediaRestrictions,
  onToggleMic,
  onToggleCam,
  onLeave,
  onMuteParticipant,
  onDisableParticipantVideo,
  onWindowClosed,
}: UseMeetingDocumentPipOptions): MeetingDocumentPipApi {
  const pipWindowRef = useRef<Window | null>(null);
  const rootRef = useRef<Root | null>(null);
  const openingRef = useRef(false);
  const closingFromApiRef = useRef(false);
  const unbindClicksRef = useRef<(() => void) | null>(null);

  const micRef = useRef(micEnabled);
  const camRef = useRef(camEnabled);
  const labelsRef = useRef(labels);
  const localNameRef = useRef(localName);
  const restrictionsRef = useRef(mediaRestrictions);
  const onToggleMicRef = useRef(onToggleMic);
  const onToggleCamRef = useRef(onToggleCam);
  const onLeaveRef = useRef(onLeave);
  const onMuteRef = useRef(onMuteParticipant);
  const onDisableVideoRef = useRef(onDisableParticipantVideo);
  const onWindowClosedRef = useRef(onWindowClosed);
  const stayOpenRef = useRef(stayOpen);
  const roomRef = useRef(room);
  const minimizedRef = useRef(false);

  micRef.current = micEnabled;
  camRef.current = camEnabled;
  labelsRef.current = labels;
  localNameRef.current = localName;
  restrictionsRef.current = mediaRestrictions;
  onToggleMicRef.current = onToggleMic;
  onToggleCamRef.current = onToggleCam;
  onLeaveRef.current = onLeave;
  onMuteRef.current = onMuteParticipant;
  onDisableVideoRef.current = onDisableParticipantVideo;
  onWindowClosedRef.current = onWindowClosed;
  stayOpenRef.current = stayOpen;
  roomRef.current = room;

  const closePip = useRef(() => {
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
    const win = pipWindowRef.current;
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
          }}
          onToggleMic={() => onToggleMicRef.current()}
          onToggleCam={() => onToggleCamRef.current()}
          onLeave={() => {
            onLeaveRef.current();
            closePip();
          }}
        />
      </RoomContext.Provider>,
    );
  }).current;

  const openPip = useRef(async (): Promise<boolean> => {
    if (!isWebDocumentPipEligible()) return false;
    if (pipWindowRef.current && !pipWindowRef.current.closed) return true;
    if (openingRef.current) return false;

    const api = getDocumentPictureInPicture();
    if (!api) return false;

    openingRef.current = true;
    try {
      const count = 1 + roomRef.current.remoteParticipants.size;
      const pill = pipPillWindowSize(count);
      const pipWindow = await api.requestWindow(
        minimizedRef.current
          ? { width: pill.w, height: pill.h }
          : { width: PIP_EXPANDED_W, height: PIP_EXPANDED_H },
      );

      pipWindowRef.current = pipWindow;
      copyDocumentStyles(document, pipWindow.document);

      pipWindow.document.documentElement.setAttribute('data-lk-theme', 'default');
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
        () => onToggleMicRef.current(),
        () => onToggleCamRef.current(),
      );

      pipWindow.addEventListener('pagehide', () => {
        if (pipWindowRef.current !== pipWindow) return;
        const userClosed = !closingFromApiRef.current;
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
        if (userClosed) {
          onWindowClosedRef.current?.();
        }
        closingFromApiRef.current = false;
      });
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
  }, [micEnabled, camEnabled, labels, localName, room, mediaRestrictions, renderPanel]);

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
      if (stayOpenRef.current) return;
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
    if (hasLiveCapture(room)) return;

    let cancelled = false;
    let stream: MediaStream | null = null;

    const start = async () => {
      try {
        const next = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        if (cancelled) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = next;
      } catch {
        // 无麦克风权限时 Chrome 不会走自动 PiP
      }
    };

    void start();

    const onLocalTrack = () => {
      if (!stream) return;
      if (!hasLiveCapture(room)) return;
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    room.on(RoomEvent.LocalTrackPublished, onLocalTrack);

    return () => {
      cancelled = true;
      room.off(RoomEvent.LocalTrackPublished, onLocalTrack);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
    };
  }, [enabled, room, micEnabled, camEnabled]);

  return { open: openPip, close: closePip };
}
