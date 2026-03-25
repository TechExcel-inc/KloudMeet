'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useRoomContext, useDataChannel } from '@livekit/components-react';

declare global {
  interface Window {
    electronAPI?: {
      sendDrawMessage: (data: any) => void;
      onDrawMessage: (callback: (data: any) => void) => void;
      sendRemoteControlMessage?: (data: any) => void;
    };
  }
}

export type DrawMessage = {
  type: 'start' | 'draw' | 'end' | 'clear';
  x: number;
  y: number;
  color: string;
};

interface AnnotationCanvasProps {
  isDrawingMode: boolean;
  participantName?: string;
  className?: string;
}

export function AnnotationCanvas({ isDrawingMode, className }: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const room = useRoomContext();
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#ef4444'); // Default red

  // Handle incoming drawing data from DataChannel
  const onDataReceived = useCallback((msg: any) => {
    try {
      const decoder = new TextDecoder();
      const str = decoder.decode(msg.payload);
      const data = JSON.parse(str) as DrawMessage;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (data.type === 'clear') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        // Convert normalized coords back to absolute pixels based on current canvas size
        const absX = data.x * canvas.width;
        const absY = data.y * canvas.height;

        ctx.strokeStyle = data.color;
        ctx.lineWidth = 4;
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
      }

      // Forward to Desktop app context if running in Electron
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.sendDrawMessage(data);
      }
    } catch (e) {
      console.error('Failed to parse annotation data', e);
    }
  }, []);

  useDataChannel('annotations', onDataReceived);

  // Resize canvas to match its container exactly
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas || !canvas.parentElement) return;

      // Save current drawing
      const ctx = canvas.getContext('2d');
      let tmpData: ImageData | null = null;
      if (ctx && canvas.width > 0 && canvas.height > 0) {
        tmpData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }

      // We measure the direct parent, which should perfectly mirror the lk-focus-layout
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;

      // Restore drawing inside the bounds
      if (ctx && tmpData) {
        ctx.putImageData(tmpData, 0, 0);
      }
    };
    
    // We delay the initial measurement slightly to ensure DOM has fully injected the LiveKit layout
    const timeoutIds = [
      setTimeout(handleResize, 100),
      setTimeout(handleResize, 500),
      setTimeout(handleResize, 1000)
    ];

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      timeoutIds.forEach(clearTimeout);
    };
  }, []);

  const sendDrawData = (type: DrawMessage['type'], e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (!room) return;
    
    let x = 0;
    let y = 0;

    if (e && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const absX = e.clientX - rect.left;
      const absY = e.clientY - rect.top;
      // Normalize to 0.0 - 1.0!
      x = absX / canvasRef.current.width;
      y = absY / canvasRef.current.height;
    }

    const msg: DrawMessage = { type, x, y, color };
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(msg));

    room.localParticipant.publishData(data, { reliable: true, topic: 'annotations' }).catch(() => {
      // Ignore if reliable isn't supported, fallback to default DataPublishOptions
      room.localParticipant.publishData(data, { topic: 'annotations' }).catch(console.error);
    });
    
    // Also draw locally immediately
    onDataReceived({ payload: data });
  };

  const clearCanvas = () => {
    sendDrawData('clear');
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode) return;
    e.preventDefault();
    setIsDrawing(true);
    sendDrawData('start', e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode || !isDrawing) return;
    e.preventDefault();
    sendDrawData('draw', e);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode || !isDrawing) return;
    e.preventDefault();
    setIsDrawing(false);
    sendDrawData('end', e);
  };

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
          top: 0, // Injected perfectly over the Video Wrapper
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 1000,
          pointerEvents: isDrawingMode ? 'auto' : 'none',
          cursor: isDrawingMode ? 'crosshair' : 'default',
        }}
      />
      
      {/* Dynamic Overlay Floating Tool Palette */}
      {isDrawingMode && (
        <div style={{
          position: 'absolute',
          top: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1001,
          display: 'flex',
          gap: 12,
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(10px)',
          padding: '10px 14px',
          borderRadius: '24px',
          border: '1px solid rgba(255,255,255,0.15)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          {['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#ec4899', '#ffffff'].map(c => (
            <div
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: c,
                cursor: 'pointer',
                border: color === c ? '2px solid white' : '2px solid transparent',
                boxShadow: color === c ? '0 0 10px rgba(255,255,255,0.4)' : 'none',
                transition: 'all 0.2s',
                transform: color === c ? 'scale(1.1)' : 'scale(1)'
              }}
            />
          ))}
          <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.2)', margin: '0 4px' }} />
          <button 
            onClick={clearCanvas}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#f87171',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              transition: 'color 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.color = '#fff'}
            onMouseOut={(e) => e.currentTarget.style.color = '#f87171'}
            title="Clear canvas"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
