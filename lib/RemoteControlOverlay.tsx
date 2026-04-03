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

// Pending request info for the presenter's approval dialog
export type RemoteControlRequest = {
  requesterIdentity: string;
  requesterName: string;
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
 * Given raw cursor position and the video element's CSS bounding box, compute
 * content-normalized (0-1) coordinates that account for object-fit: contain
 * letterboxing. The actual video content may be smaller than the CSS box.
 *
 * Returns x/y in 0-1 range relative to the actual video CONTENT, not the CSS box.
 */
function toContentNormalized(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  videoW: number,
  videoH: number,
): { x: number; y: number } {
  // Compute how object-fit: contain positions the content within the CSS box
  const videoAspect = videoW / videoH;
  const boxAspect = rect.width / rect.height;

  let contentW: number, contentH: number, offsetX: number, offsetY: number;
  if (videoAspect > boxAspect) {
    // Video is wider than box → content fills width, bars on top/bottom
    contentW = rect.width;
    contentH = rect.width / videoAspect;
    offsetX = 0;
    offsetY = (rect.height - contentH) / 2;
  } else {
    // Video is taller than box → content fills height, bars on left/right
    contentH = rect.height;
    contentW = rect.height * videoAspect;
    offsetY = 0;
    offsetX = (rect.width - contentW) / 2;
  }

  // Map from CSS box space to content space (0-1)
  const x = (clientX - rect.left - offsetX) / contentW;
  const y = (clientY - rect.top - offsetY) / contentH;

  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
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
      // Find the actual screen share video element for accurate coordinate mapping
      const video =
        document.querySelector<HTMLVideoElement>('[data-lk-source="screen_share"] video') ||
        document.querySelector<HTMLVideoElement>('[data-lk-source="screen_share_audio"] video') ||
        document.querySelector<HTMLVideoElement>('.lk-focus-layout .lk-participant-tile video') ||
        document.querySelector<HTMLVideoElement>('.lk-focus-layout video');

      const rect = video
        ? video.getBoundingClientRect()
        : containerRef.current?.getBoundingClientRect();
      if (!rect) return { type, x: 0, y: 0, button };

      // Get actual video content dimensions for letterbox correction
      const videoW = video?.videoWidth || rect.width;
      const videoH = video?.videoHeight || rect.height;

      // Compute content-normalized 0-1 coordinates (corrected for object-fit: contain)
      const { x, y } = toContentNormalized(e.clientX, e.clientY, rect, videoW, videoH);

      // Only send normalized 0-1 coords — the presenter's Electron main process
      // will map these to physical screen pixels using its own screen dimensions.
      // This avoids DPI scaling mismatches between controller and presenter.
      return { type, x, y, button };
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

  // Auto-hide badge after 3 seconds
  const [showBadge, setShowBadge] = useState(true);
  useEffect(() => {
    if (isActive && !isPresenter) {
      setShowBadge(true);
      const timer = setTimeout(() => setShowBadge(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isActive, isPresenter]);

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
        boxShadow: isController ? 'inset 0 0 0 2px rgba(59, 130, 246, 0.4)' : 'none',
        borderRadius: 'inherit',
        transition: 'box-shadow 0.2s ease',
      }}
    >
      {/* Controller badge — bottom-right, auto-fades after 3s */}
      {isController && showBadge && (
        <div
          style={{
            position: 'absolute',
            bottom: 60,
            right: 12,
            background: 'rgba(29, 78, 216, 0.85)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            color: 'white',
            padding: '4px 10px',
            borderRadius: '14px',
            fontSize: '11px',
            fontWeight: 600,
            pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)',
            border: '1px solid rgba(147, 197, 253, 0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            whiteSpace: 'nowrap',
            zIndex: 1001,
            opacity: 0.9,
            transition: 'opacity 0.5s ease',
          }}
        >
          <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" style={{ opacity: 0.8 }}>
            <path d="M4 0l16 12.279-6.951 1.17 4.325 8.817-2.123 1.034-4.285-8.745-5.966 5.014z" />
          </svg>
          Controlling
          {!presenterInfoRef.current && (
            <span style={{ opacity: 0.6, fontSize: 9, marginLeft: 2 }}>(syncing...)</span>
          )}
        </div>
      )}
    </div>
  );
}
