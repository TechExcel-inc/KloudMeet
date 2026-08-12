'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useRoomContext, useDataChannel } from '@livekit/components-react';

declare global {
  interface Window {
    electronAPI?: {
      sendDrawMessage: (data: any) => void;
      onDrawMessage: (callback: (data: any) => void) => void;
      sendRemoteControlMessage?: (data: any) => void;
      getShareTargetBounds?: () => Promise<ShareTargetBounds | null>;
      clearShareTarget?: () => Promise<void>;
    };
  }
}

export type ShareTargetBounds = {
  sourceId: string;
  displayId?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  kind: 'screen' | 'window';
};

export type DrawMessage = {
  type: 'start' | 'draw' | 'end' | 'clear';
  x: number;
  y: number;
  color: string;
  lineWidth?: number;
};

const LINE_WIDTHS = [3, 6, 12];
const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#ec4899', '#ffffff'];

interface AnnotationCanvasProps {
  isDrawingMode: boolean;
  /** When true: only bridge DataChannel → Electron overlay (no interactive UI). */
  bridgeOnly?: boolean;
  /** Only the screen-share presenter should paint the system overlay. */
  forwardToOverlay?: boolean;
  participantName?: string;
  className?: string;
}

export function AnnotationCanvas({
  isDrawingMode,
  bridgeOnly = false,
  forwardToOverlay = false,
  className,
}: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const room = useRoomContext();
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#ef4444');
  const [lineWidthIdx, setLineWidthIdx] = useState(0);

  /** Draw on local canvas from a DrawMessage (normalized coords). */
  const renderOnCanvas = useCallback((data: DrawMessage) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (data.type === 'clear') {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const absX = data.x * canvas.width;
    const absY = data.y * canvas.height;
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.lineWidth ?? 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (data.type === 'start') {
      ctx.beginPath();
      ctx.moveTo(absX, absY);
    } else if (data.type === 'draw') {
      ctx.lineTo(absX, absY);
      ctx.stroke();
    } else if (data.type === 'end') {
      ctx.closePath();
    }
  }, []);

  // Handle incoming drawing data from DataChannel
  const onDataReceived = useCallback(
    (msg: any) => {
      try {
        const decoder = new TextDecoder();
        const str = decoder.decode(msg.payload);
        const data = JSON.parse(str) as DrawMessage;
        const fromLocal =
          !!msg.participant?.identity &&
          msg.participant.identity === room?.localParticipant?.identity;

        // Interactive view: paint on in-meeting canvas
        if (!bridgeOnly) {
          renderOnCanvas(data);
        }

        // Forward only REMOTE strokes to the presenter's Electron overlay
        if (
          !fromLocal &&
          forwardToOverlay &&
          typeof window !== 'undefined' &&
          window.electronAPI?.sendDrawMessage
        ) {
          window.electronAPI.sendDrawMessage(data);
        }
      } catch (e) {
        console.error('Failed to parse annotation data', e);
      }
    },
    [bridgeOnly, forwardToOverlay, renderOnCanvas, room],
  );

  useDataChannel('annotations', onDataReceived);

  // Resize canvas to match its container exactly, preserving the drawing
  useEffect(() => {
    if (bridgeOnly) return;

    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas || !canvas.parentElement) return;

      const ctx = canvas.getContext('2d');
      let tmpData: ImageData | null = null;
      if (ctx && canvas.width > 0 && canvas.height > 0) {
        tmpData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }

      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;

      if (ctx && tmpData) {
        ctx.putImageData(tmpData, 0, 0);
      }
    };

    const timeoutIds = [
      setTimeout(handleResize, 100),
      setTimeout(handleResize, 500),
      setTimeout(handleResize, 1000),
    ];

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      timeoutIds.forEach(clearTimeout);
    };
  }, [bridgeOnly]);

  /**
   * Publish a draw event to the DataChannel AND render locally.
   * Local strokes: render + IPC once here; remote peers get DataChannel only.
   */
  const sendDrawData = (type: DrawMessage['type'], e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (!room || bridgeOnly) return;

    let x = 0;
    let y = 0;

    if (e && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      x = Math.max(0, Math.min(1, (e.clientX - rect.left) / canvasRef.current.width));
      y = Math.max(0, Math.min(1, (e.clientY - rect.top) / canvasRef.current.height));
    }

    const msg: DrawMessage = { type, x, y, color, lineWidth: LINE_WIDTHS[lineWidthIdx] };

    renderOnCanvas(msg);

    if (typeof window !== 'undefined' && forwardToOverlay && window.electronAPI?.sendDrawMessage) {
      window.electronAPI.sendDrawMessage(msg);
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(msg));
    room.localParticipant.publishData(data, { reliable: true, topic: 'annotations' }).catch(() => {
      room.localParticipant.publishData(data, { topic: 'annotations' }).catch(console.error);
    });
  };

  const clearCanvas = () => sendDrawData('clear');

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode || bridgeOnly) return;
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    setIsDrawing(true);
    sendDrawData('start', e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode || !isDrawing || bridgeOnly) return;
    e.preventDefault();
    sendDrawData('draw', e);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode || !isDrawing || bridgeOnly) return;
    e.preventDefault();
    setIsDrawing(false);
    sendDrawData('end', e);
  };

  if (bridgeOnly) {
    return null;
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={className}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 1000,
          pointerEvents: isDrawingMode ? 'auto' : 'none',
          cursor: isDrawingMode ? 'crosshair' : 'default',
        }}
      />

      {isDrawingMode && (
        <div
          style={{
            position: 'absolute',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1001,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(10, 15, 30, 0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            padding: '8px 14px',
            borderRadius: '28px',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
            userSelect: 'none',
            pointerEvents: 'auto',
          }}
        >
          {COLORS.map((c) => (
            <div
              key={c}
              onClick={() => setColor(c)}
              title={c}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: c,
                cursor: 'pointer',
                border: color === c ? '2.5px solid white' : '2px solid rgba(255,255,255,0.15)',
                boxShadow:
                  color === c
                    ? `0 0 0 2px rgba(255,255,255,0.3), 0 0 10px ${c}99`
                    : 'none',
                transition: 'all 0.18s ease',
                transform: color === c ? 'scale(1.2)' : 'scale(1)',
                flexShrink: 0,
              }}
            />
          ))}

          <div
            style={{
              width: 1,
              height: 22,
              background: 'rgba(255,255,255,0.15)',
              margin: '0 2px',
              flexShrink: 0,
            }}
          />

          {LINE_WIDTHS.map((w, i) => (
            <div
              key={w}
              onClick={() => setLineWidthIdx(i)}
              title={`Line width: ${w}px`}
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                background: lineWidthIdx === i ? 'rgba(255,255,255,0.18)' : 'transparent',
                border:
                  lineWidthIdx === i
                    ? '1.5px solid rgba(255,255,255,0.4)'
                    : '1.5px solid transparent',
                transition: 'all 0.15s ease',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 6 + i * 3,
                  height: 6 + i * 3,
                  borderRadius: '50%',
                  background: color,
                  opacity: 0.9,
                }}
              />
            </div>
          ))}

          <div
            style={{
              width: 1,
              height: 22,
              background: 'rgba(255,255,255,0.15)',
              margin: '0 2px',
              flexShrink: 0,
            }}
          />

          <button
            onClick={clearCanvas}
            title="Clear all annotations"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(248, 113, 113, 0.8)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 4,
              borderRadius: 8,
              transition: 'all 0.15s ease',
              flexShrink: 0,
            }}
            onMouseOver={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = '#f87171';
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(248,113,113,0.12)';
            }}
            onMouseOut={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(248, 113, 113, 0.8)';
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
