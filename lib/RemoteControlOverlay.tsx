'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useRoomContext, useDataChannel } from '@livekit/components-react';

export type RemoteControlMessage = {
  type: 'mousemove' | 'mousedown' | 'mouseup' | 'dblclick' | 'screen-info';
  // For mouse events:
  x?: number;       // normalized 0-1 relative to video CONTENT (not container, letterbox-corrected)
  y?: number;
  button?: number;  // 0 = left, 2 = right
  // Absolute pixels on presenter's screen (computed client-side using screen info)
  absX?: number;
  absY?: number;
  // For screen-info broadcast (from presenter to controllers):
  screenW?: number;
  screenH?: number;
  videoW?: number;  // actual video content resolution
  videoH?: number;
};

interface RemoteControlOverlayProps {
  isActive: boolean;
  isPresenter: boolean;
  className?: string;
}

/** Simple throttle */
function throttle<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let last = 0;
  return ((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  }) as T;
}

/**
 * Given normalized (0-1) coordinates relative to the VIDEO CONTAINER (which may have
 * letterbox bars), and the presenter's screen + video resolution info, compute the
 * absolute pixel position on the presenter's screen.
 *
 * The overlay div fills the whole video container. The actual video content is
 * letterboxed inside (object-fit: contain). We need to compute where the content
 * starts/ends inside the container to get accurate coordinates.
 */
function toAbsolute(
  normX: number,
  normY: number,
  containerW: number,
  containerH: number,
  presenterScreenW: number,
  presenterScreenH: number,
  presenterVideoW: number,
  presenterVideoH: number,
): { absX: number; absY: number } {
  // Compute letterbox offsets: the video content aspect ratio vs container aspect ratio
  const videoAspect = presenterVideoW / presenterVideoH;
  const containerAspect = containerW / containerH;

  let contentW: number, contentH: number, offsetX: number, offsetY: number;
  if (videoAspect > containerAspect) {
    // Pillarbox (black bars on top/bottom)
    contentW = containerW;
    contentH = containerW / videoAspect;
    offsetX = 0;
    offsetY = (containerH - contentH) / 2;
  } else {
    // Letterbox (black bars on left/right)
    contentH = containerH;
    contentW = containerH * videoAspect;
    offsetY = 0;
    offsetX = (containerW - contentW) / 2;
  }

  // Map click position from container space to content space
  const contentX = (normX * containerW - offsetX) / contentW;
  const contentY = (normY * containerH - offsetY) / contentH;

  // Map from content-normalized to presenter screen pixels
  const absX = Math.round(Math.max(0, Math.min(1, contentX)) * presenterScreenW);
  const absY = Math.round(Math.max(0, Math.min(1, contentY)) * presenterScreenH);
  return { absX, absY };
}

export function RemoteControlOverlay({
  isActive,
  isPresenter,
  className,
}: RemoteControlOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const room = useRoomContext();
  const [isControlling, setIsControlling] = useState(false);

  // Presenter's screen/video resolution (received from presenter's screen-info broadcast)
  const presenterInfoRef = useRef<{
    screenW: number;
    screenH: number;
    videoW: number;
    videoH: number;
  } | null>(null);

  // ─── Presenter: broadcast own screen info so controllers can map coordinates ─
  useEffect(() => {
    if (!isPresenter || !room) return;

    const broadcast = () => {
      const sw = window.screen.width;
      const sh = window.screen.height;
      // Try to get actual video resolution from the screenshare video element
      const video = document.querySelector<HTMLVideoElement>(
        '.lk-focus-layout video, [data-lk-source="screen_share"] video',
      );
      const vw = video?.videoWidth || sw;
      const vh = video?.videoHeight || sh;

      const msg: RemoteControlMessage = {
        type: 'screen-info',
        screenW: sw,
        screenH: sh,
        videoW: vw,
        videoH: vh,
      };
      const data = new TextEncoder().encode(JSON.stringify(msg));
      room.localParticipant
        .publishData(data, { reliable: true, topic: 'remote-control' })
        .catch(console.error);
    };

    // Broadcast immediately and every 5 s (video resolution may change)
    broadcast();
    const interval = setInterval(broadcast, 5000);
    return () => clearInterval(interval);
  }, [isPresenter, room]);

  // ─── Presenter: receive mouse events from controller and execute via IPC ──
  const onDataReceived = useCallback(
    (msg: any) => {
      try {
        const decoder = new TextDecoder();
        const data = JSON.parse(decoder.decode(msg.payload)) as RemoteControlMessage;

        if (data.type === 'screen-info') {
          // Controller stores presenter's screen info for coordinate mapping
          if (!isPresenter && data.screenW && data.screenH) {
            presenterInfoRef.current = {
              screenW: data.screenW,
              screenH: data.screenH,
              videoW: data.videoW || data.screenW,
              videoH: data.videoH || data.screenH,
            };
          }
          return;
        }

        // Only the presenter executes the mouse actions
        if (!isPresenter) return;
        if (
          typeof window !== 'undefined' &&
          window.electronAPI &&
          window.electronAPI.sendRemoteControlMessage
        ) {
          window.electronAPI.sendRemoteControlMessage(data);
        }
      } catch (e) {
        console.error('Failed to parse remote control data', e);
      }
    },
    [isPresenter],
  );

  useDataChannel('remote-control', onDataReceived);

  // ─── Controller: publish pointer events with corrected coordinates ─────────
  const publishMsg = useCallback(
    (msg: RemoteControlMessage) => {
      if (!room) return;
      const data = new TextEncoder().encode(JSON.stringify(msg));
      room.localParticipant
        .publishData(data, { reliable: true, topic: 'remote-control' })
        .catch(() => {
          room.localParticipant
            .publishData(data, { topic: 'remote-control' })
            .catch(console.error);
        });
    },
    [room],
  );

  const buildMsg = useCallback(
    (
      type: RemoteControlMessage['type'],
      e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
      button = 0,
    ): RemoteControlMessage => {
      const container = containerRef.current;
      if (!container) return { type, x: 0, y: 0, button };

      const rect = container.getBoundingClientRect();
      const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      const info = presenterInfoRef.current;
      if (info) {
        const { absX, absY } = toAbsolute(
          normX,
          normY,
          rect.width,
          rect.height,
          info.screenW,
          info.screenH,
          info.videoW,
          info.videoH,
        );
        return { type, x: normX, y: normY, absX, absY, button };
      }

      // Fallback: no presenter info yet, use raw normalized coords
      return { type, x: normX, y: normY, button };
    },
    [],
  );

  // Throttled mousemove ~60fps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sendMove = useCallback(
    throttle(
      (msg: RemoteControlMessage) => {
        publishMsg(msg);
      },
      16,
    ),
    [publishMsg],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isActive || isPresenter) return;
    e.preventDefault();
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    setIsControlling(true);
    publishMsg(buildMsg('mousedown', e, e.button));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isActive || !isControlling || isPresenter) return;
    e.preventDefault();
    sendMove(buildMsg('mousemove', e, 0));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isActive || isPresenter) return;
    e.preventDefault();
    if (isControlling) {
      (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
      setIsControlling(false);
    }
    publishMsg(buildMsg('mouseup', e, e.button));
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isActive || isPresenter) return;
    e.preventDefault();
    publishMsg(buildMsg('dblclick', e, 0));
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isActive || isPresenter) return;
    e.preventDefault();
  };

  if (!isActive && !isPresenter) return null;

  const isController = isActive && !isPresenter;

  return (
    <div
      ref={containerRef}
      className={className}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 1000,
        pointerEvents: isController ? 'auto' : 'none',
        cursor: isController ? (isControlling ? 'grabbing' : 'crosshair') : 'default',
        boxShadow: isController ? 'inset 0 0 0 3px rgba(59, 130, 246, 0.55)' : 'none',
        borderRadius: 'inherit',
        transition: 'box-shadow 0.2s ease',
      }}
    >
      {/* Controller badge */}
      {isController && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(29, 78, 216, 0.92)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            color: 'white',
            padding: '5px 14px',
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: '0.3px',
            pointerEvents: 'none',
            boxShadow: '0 4px 16px rgba(37, 99, 235, 0.4)',
            border: '1px solid rgba(147, 197, 253, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
            zIndex: 1001,
          }}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style={{ opacity: 0.9 }}>
            <path d="M4 0l16 12.279-6.951 1.17 4.325 8.817-2.123 1.034-4.285-8.745-5.966 5.014z" />
          </svg>
          Controlling Screen
          {!presenterInfoRef.current && (
            <span style={{ opacity: 0.6, fontSize: 10, marginLeft: 4 }}>(syncing...)</span>
          )}
        </div>
      )}
    </div>
  );
}
