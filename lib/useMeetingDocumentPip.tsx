'use client';

import { useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RoomEvent, Track, type Room } from 'livekit-client';
import {
  copyDocumentStyles,
  getDocumentPictureInPicture,
  isWebDocumentPipEligible,
  setMediaSessionActionHandler,
  updateMediaSessionCaptureState,
} from '@/lib/documentPipSupport';
import {
  MeetingDocumentPipPanel,
  type MeetingDocumentPipLabels,
} from '@/lib/MeetingDocumentPipPanel';

const PIP_WIDTH = 300;
const PIP_HEIGHT = 420;

export interface UseMeetingDocumentPipOptions {
  /** 入会且允许时开启监听（网页端由调用方排除手机/Electron） */
  enabled: boolean;
  room: Room;
  micEnabled: boolean;
  camEnabled: boolean;
  labels: MeetingDocumentPipLabels;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onLeave: () => void;
}

function hasLiveCapture(room: Room): boolean {
  const local = room.localParticipant;
  const sources = [Track.Source.Microphone, Track.Source.Camera, Track.Source.ScreenShare];
  return sources.some((source) => {
    const track = local.getTrackPublication(source)?.track;
    return track?.mediaStreamTrack.readyState === 'live';
  });
}

/**
 * useMeetingDocumentPip — 对齐 Google Meet：切 tab 由 MediaSession enterpictureinpicture 打开 Document PiP，回到会议 tab 再关。
 */
export function useMeetingDocumentPip({
  enabled,
  room,
  micEnabled,
  camEnabled,
  labels,
  onToggleMic,
  onToggleCam,
  onLeave,
}: UseMeetingDocumentPipOptions): void {
  const pipWindowRef = useRef<Window | null>(null);
  const rootRef = useRef<Root | null>(null);
  const openingRef = useRef(false);

  const micRef = useRef(micEnabled);
  const camRef = useRef(camEnabled);
  const labelsRef = useRef(labels);
  const onToggleMicRef = useRef(onToggleMic);
  const onToggleCamRef = useRef(onToggleCam);
  const onLeaveRef = useRef(onLeave);
  const roomRef = useRef(room);

  micRef.current = micEnabled;
  camRef.current = camEnabled;
  labelsRef.current = labels;
  onToggleMicRef.current = onToggleMic;
  onToggleCamRef.current = onToggleCam;
  onLeaveRef.current = onLeave;
  roomRef.current = room;

  const closePip = useRef(() => {
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
        // ignore
      }
    }
  }).current;

  const renderPanel = useRef(() => {
    const root = rootRef.current;
    const win = pipWindowRef.current;
    if (!root || !win || win.closed) return;

    root.render(
      <MeetingDocumentPipPanel
        room={roomRef.current}
        micEnabled={micRef.current}
        camEnabled={camRef.current}
        labels={labelsRef.current}
        onToggleMic={() => onToggleMicRef.current()}
        onToggleCam={() => onToggleCamRef.current()}
        onLeave={() => {
          onLeaveRef.current();
          closePip();
        }}
        onBackToTab={() => {
          closePip();
          try {
            window.focus();
          } catch {
            // ignore
          }
        }}
      />,
    );
  }).current;

  const openPip = useRef(async () => {
    if (!isWebDocumentPipEligible()) return;
    if (pipWindowRef.current && !pipWindowRef.current.closed) return;
    if (openingRef.current) return;

    const api = getDocumentPictureInPicture();
    if (!api) return;

    openingRef.current = true;
    try {
      const pipWindow = await api.requestWindow({
        width: PIP_WIDTH,
        height: PIP_HEIGHT,
      });

      pipWindowRef.current = pipWindow;
      copyDocumentStyles(document, pipWindow.document);

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

      pipWindow.addEventListener('pagehide', () => {
        if (pipWindowRef.current === pipWindow) {
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
        }
      });
    } catch {
      closePip();
    } finally {
      openingRef.current = false;
    }
  }).current;

  useEffect(() => {
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      renderPanel();
    }
  }, [micEnabled, camEnabled, labels, room, renderPanel]);

  useEffect(() => {
    if (!enabled || !isWebDocumentPipEligible()) return;
    updateMediaSessionCaptureState(micEnabled, camEnabled);
  }, [enabled, micEnabled, camEnabled]);

  useEffect(() => {
    if (!enabled || !isWebDocumentPipEligible()) {
      closePip();
      return;
    }

    setMediaSessionActionHandler('enterpictureinpicture', () => {
      void openPip();
    });
    setMediaSessionActionHandler('togglemicrophone', () => {
      onToggleMicRef.current();
    });
    setMediaSessionActionHandler('togglecamera', () => {
      onToggleCamRef.current();
    });
    setMediaSessionActionHandler('hangup', () => {
      onLeaveRef.current();
      closePip();
    });

    const onVisibility = () => {
      if (!document.hidden) {
        closePip();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      setMediaSessionActionHandler('enterpictureinpicture', null);
      setMediaSessionActionHandler('togglemicrophone', null);
      setMediaSessionActionHandler('togglecamera', null);
      setMediaSessionActionHandler('hangup', null);
      document.removeEventListener('visibilitychange', onVisibility);
      closePip();
    };
  }, [enabled, openPip, closePip]);

  // Chrome 自动 PiP 要求页面正在 getUserMedia（与 Meet 入会后保持采集一致）
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
}
