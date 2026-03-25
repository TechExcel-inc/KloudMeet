'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useRoomContext, useDataChannel } from '@livekit/components-react';

export type RemoteControlMessage = {
  type: 'mousemove' | 'mousedown' | 'mouseup';
  x: number;
  y: number;
  button: number; // 0 for left, 2 for right
};

interface RemoteControlOverlayProps {
  isActive: boolean;
  isPresenter: boolean; // Are we the one sharing the screen?
  className?: string;
}

export function RemoteControlOverlay({ isActive, isPresenter, className }: RemoteControlOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const room = useRoomContext();
  const [isControlling, setIsControlling] = useState(false);

  // For the Presenter (User A) receiving remote control actions
  const onDataReceived = useCallback((msg: any) => {
    if (!isPresenter) return; // Only process if we are the one sharing

    try {
      const decoder = new TextDecoder();
      const str = decoder.decode(msg.payload);
      const data = JSON.parse(str) as RemoteControlMessage;

      // Forward to Desktop app context if running in Electron
      if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.sendRemoteControlMessage) {
        window.electronAPI.sendRemoteControlMessage(data);
      }
    } catch (e) {
      console.error('Failed to parse remote control data', e);
    }
  }, [isPresenter]);

  useDataChannel('remote-control', onDataReceived);

  // For the Viewer (User B) sending relative remote control actions
  const sendControlEvent = (type: RemoteControlMessage['type'], e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    if (!room || !isActive || isPresenter) return;

    let x = 0;
    let y = 0;

    if (e && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const absX = e.clientX - rect.left;
      const absY = e.clientY - rect.top;
      // Normalize to 0.0 - 1.0 based on the video wrapper
      x = absX / containerRef.current.clientWidth;
      y = absY / containerRef.current.clientHeight;

      // Ensure clamped between 0 and 1 just in case
      x = Math.max(0, Math.min(1, x));
      y = Math.max(0, Math.min(1, y));
    }

    const msg: RemoteControlMessage = { type, x, y, button: e.button };
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(msg));

    room.localParticipant.publishData(data, { reliable: true, topic: 'remote-control' }).catch(() => {
      // Ignore if reliable isn't supported, fallback to default DataPublishOptions
      room.localParticipant.publishData(data, { topic: 'remote-control' }).catch(console.error);
    });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isActive || isPresenter) return;
    e.preventDefault();
    setIsControlling(true);
    sendControlEvent('mousedown', e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isActive || !isControlling || isPresenter) return;
    e.preventDefault();
    // In a production app you'd throttle/debounce the mousemove to avoid flooding DataChannel
    // For local dev/fast connection, raw is usually okay, but let's just send it.
    sendControlEvent('mousemove', e);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isActive || !isControlling || isPresenter) return;
    e.preventDefault();
    setIsControlling(false);
    sendControlEvent('mouseup', e);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isActive || isPresenter) return;
    e.preventDefault(); // Prevent native right-click menu over the video
  };

  if (!isActive && !isPresenter) return null;

  return (
    <div
      ref={containerRef}
      className={className}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onContextMenu={handleContextMenu}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 1000, // Same level as AnnotationCanvas
        pointerEvents: isActive && !isPresenter ? 'auto' : 'none',
        cursor: isActive && !isPresenter ? 'crosshair' : 'default',
        // Visual indicator that control is active
        boxShadow: isActive && !isPresenter ? 'inset 0 0 0 4px rgba(59, 130, 246, 0.5)' : 'none',
      }}
    >
      {isActive && !isPresenter && (
        <div style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(37, 99, 235, 0.9)',
          color: 'white',
          padding: '4px 12px',
          borderRadius: '16px',
          fontSize: '12px',
          fontWeight: 600,
          pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          Controlling Screen
        </div>
      )}
    </div>
  );
}
