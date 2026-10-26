'use client';

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type Participant, type Room } from 'livekit-client';
import { useI18n } from '@/lib/i18n';
import {
  ANNOTATION_TOPIC,
  AnnotationModel,
  REFERENCE_CONTENT_WIDTH,
  StrokeBatcher,
  SyncAssembler,
  chunkSnapshot,
  parseAnnotationMsg,
  type AnnotationMsg,
  type ModelChange,
  type Stroke,
} from '@/lib/annotationModel';
import { findShareVideo, shareContentClientRect, toContentNormalized, type Rect } from '@/lib/shareContentRect';

declare global {
  interface Window {
    electronAPI?: {
      sendDrawMessage: (data: any) => void;
      onDrawMessage: (callback: (data: any) => void) => void;
      sendRemoteControlMessage?: (data: any) => void;
      getShareTargetBounds?: () => Promise<ShareTargetBounds | null>;
      clearShareTarget?: () => Promise<void>;
      /** Desktop builds with wheel/keyboard support list them here. */
      remoteControlCaps?: string[];
      /** Tells the desktop app a control session started or ended (shows its banner, arms the stop shortcut). */
      setRemoteControlSession?: (session: { active: boolean; controllerName?: string }) => void;
      /** The presenter stopped control from the desktop banner or shortcut. Returns an unsubscribe. */
      onRemoteControlStopped?: (callback: (reason: string) => void) => () => void;
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

/** Message format of the desktop overlay window (public/overlay.html): one point per message. */
export type DrawMessage = {
  type: 'start' | 'draw' | 'end' | 'clear';
  x: number;
  y: number;
  color: string;
  lineWidth?: number;
  /** Stroke key, so the overlay keeps one path per stroke (older overlays ignore it). */
  sid?: string;
};

/** How annotation messages reach the other participants (LiveKit in a room, BroadcastChannel in dev). */
export type AnnotationTransport = {
  readonly localIdentity: string;
  /** True for the participant whose screen is shared; it answers late joiners' sync requests. */
  isSharer: () => boolean;
  send: (msg: AnnotationMsg, to?: string[]) => void;
  subscribe: (handler: (msg: AnnotationMsg, from: string) => void) => () => void;
};

const LINE_WIDTHS = [3, 6, 12];
const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#ec4899', '#ffffff'];
/** i18n keys for COLORS, same order (toolbar swatch labels) */
const COLOR_LABEL_KEYS = [
  'annotation.colorRed',
  'annotation.colorBlue',
  'annotation.colorGreen',
  'annotation.colorYellow',
  'annotation.colorPink',
  'annotation.colorWhite',
];

interface AnnotationCanvasProps {
  isDrawingMode: boolean;
  /** When true: only bridge DataChannel → Electron overlay (no interactive UI). */
  bridgeOnly?: boolean;
  /** Only the screen-share presenter should paint the system overlay. */
  forwardToOverlay?: boolean;
  participantName?: string;
  className?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function useLiveKitAnnotationTransport(room: Room | undefined): AnnotationTransport | null {
  return useMemo(() => {
    if (!room) return null;
    return {
      get localIdentity() {
        return room.localParticipant.identity;
      },
      isSharer: () => room.localParticipant.isScreenShareEnabled,
      send: (msg, to) => {
        const data = encoder.encode(JSON.stringify(msg));
        room.localParticipant
          .publishData(data, { reliable: true, topic: ANNOTATION_TOPIC, destinationIdentities: to })
          .catch(() => {
            room.localParticipant
              .publishData(data, { topic: ANNOTATION_TOPIC, destinationIdentities: to })
              .catch(console.error);
          });
      },
      subscribe: (handler) => {
        const onData = (payload: Uint8Array, participant?: Participant, _kind?: unknown, topic?: string) => {
          if (topic !== ANNOTATION_TOPIC || !participant) return;
          let raw: unknown;
          try {
            raw = JSON.parse(decoder.decode(payload));
          } catch {
            return;
          }
          const msg = parseAnnotationMsg(raw);
          if (msg) handler(msg, participant.identity);
        };
        room.on(RoomEvent.DataReceived, onData);
        return () => {
          room.off(RoomEvent.DataReceived, onData);
        };
      },
    };
  }, [room]);
}

export function AnnotationCanvas(props: AnnotationCanvasProps) {
  const room = useRoomContext();
  const transport = useLiveKitAnnotationTransport(room);
  if (!transport) return null;
  return <AnnotationLayer {...props} transport={transport} />;
}

/** Line width in canvas pixels for a stroke drawn over a picture `contentWidth` wide. */
export function strokePixelWidth(width: number, contentWidth: number) {
  return Math.max(1, (width * contentWidth) / REFERENCE_CONTENT_WIDTH);
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, fromPoint: number, content: Rect) {
  const n = stroke.pts.length / 2;
  if (n === 0 || fromPoint >= n) return;
  const px = (i: number) => content.left + stroke.pts[i * 2] * content.width;
  const py = (i: number) => content.top + stroke.pts[i * 2 + 1] * content.height;
  const lw = strokePixelWidth(stroke.width, content.width);
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(px(0), py(0), lw / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const start = Math.max(0, fromPoint - 1);
  ctx.beginPath();
  ctx.moveTo(px(start), py(start));
  for (let i = start + 1; i < n; i++) ctx.lineTo(px(i), py(i));
  ctx.stroke();
}

type AnnotationLayerProps = AnnotationCanvasProps & {
  transport: AnnotationTransport;
  /** Finds the shared picture; defaults to the room's screen-share video. */
  getShareVideo?: () => HTMLVideoElement | null;
};

export function AnnotationLayer({
  isDrawingMode,
  bridgeOnly = false,
  forwardToOverlay = false,
  className,
  transport,
  getShareVideo = findShareVideo,
}: AnnotationLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { t } = useI18n();
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#ef4444');
  const [lineWidthIdx, setLineWidthIdx] = useState(0);
  const [overContent, setOverContent] = useState(true);

  const modelRef = useRef(new AnnotationModel());
  const batcherRef = useRef<StrokeBatcher | null>(null);
  const localStrokeRef = useRef<{ id: number; count: number } | null>(null);
  const nextStrokeIdRef = useRef(Math.floor(Math.random() * 1_000_000));
  const contentRef = useRef<Rect | null>(null);
  const overlayScaleRef = useRef(1.5);
  const awaitingSyncRef = useRef(false);
  const assemblerRef = useRef(new SyncAssembler());
  const getShareVideoRef = useRef(getShareVideo);
  getShareVideoRef.current = getShareVideo;
  const forwardRef = useRef(forwardToOverlay);
  forwardRef.current = forwardToOverlay;

  /** The shared picture's box in canvas CSS pixels (whole canvas when no video is found). */
  const measureContent = useCallback((): Rect | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    const cr = shareContentClientRect(getShareVideoRef.current());
    if (!cr) return { left: 0, top: 0, width: box.width, height: box.height };
    return { left: cr.left - box.left, top: cr.top - box.top, width: cr.width, height: cr.height };
  }, []);

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.parentElement.clientWidth;
    const h = canvas.parentElement.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const content = measureContent();
    contentRef.current = content;
    if (!content) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(content.left, content.top, content.width, content.height);
    ctx.clip();
    for (const s of modelRef.current.list()) drawStroke(ctx, s, 0, content);
    ctx.restore();
  }, [measureContent]);

  const render = useCallback(
    (change: ModelChange) => {
      if (change.kind === 'none') return;
      if (change.kind === 'reset' || !contentRef.current) {
        redrawAll();
        return;
      }
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx) return;
      const content = contentRef.current;
      ctx.save();
      ctx.beginPath();
      ctx.rect(content.left, content.top, content.width, content.height);
      ctx.clip();
      drawStroke(ctx, change.stroke, change.fromPoint, content);
      ctx.restore();
    },
    [redrawAll],
  );

  /* ── Presenter's desktop overlay (Electron): same 0–1 content coordinates, one message per point ── */
  const refreshOverlayScale = useCallback(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.getShareTargetBounds) return;
    api
      .getShareTargetBounds()
      .then((b) => {
        if (b && b.width > 0) overlayScaleRef.current = b.width / REFERENCE_CONTENT_WIDTH;
      })
      .catch(() => {});
  }, []);

  const forwardToDesktopOverlay = useCallback((change: ModelChange, ended = false, stroke?: Stroke) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!forwardRef.current || !api?.sendDrawMessage) return;
    if (change.kind === 'reset') {
      api.sendDrawMessage({ type: 'clear', x: 0, y: 0, color: '' } satisfies DrawMessage);
      for (const s of modelRef.current.list()) forwardToDesktopOverlay({ kind: 'append', stroke: s, fromPoint: 0 }, s.done);
      return;
    }
    const s = change.kind === 'append' ? change.stroke : stroke;
    if (!s) return;
    const lineWidth = Math.max(1, s.width * overlayScaleRef.current);
    if (change.kind === 'append') {
      const n = s.pts.length / 2;
      for (let k = change.fromPoint; k < n; k++) {
        api.sendDrawMessage({
          type: k === 0 ? 'start' : 'draw',
          x: s.pts[k * 2],
          y: s.pts[k * 2 + 1],
          color: s.color,
          lineWidth,
          sid: s.key,
        } satisfies DrawMessage);
      }
    }
    if (ended) {
      const n = s.pts.length / 2;
      api.sendDrawMessage({
        type: 'end',
        x: n ? s.pts[(n - 1) * 2] : 0,
        y: n ? s.pts[(n - 1) * 2 + 1] : 0,
        color: s.color,
        lineWidth,
        sid: s.key,
      } satisfies DrawMessage);
    }
  }, []);

  useEffect(() => {
    if (forwardToOverlay) refreshOverlayScale();
  }, [forwardToOverlay, refreshOverlayScale]);

  /* ── Incoming messages ── */
  useEffect(() => {
    const unsubscribe = transport.subscribe((msg, from) => {
      if (from === transport.localIdentity) return;
      const model = modelRef.current;
      if (msg.t === 'seg') {
        const change = model.applySeg(from, msg);
        render(change);
        const stroke = change.kind === 'append' ? change.stroke : model.list().find((s) => s.from === from && s.id === msg.id);
        forwardToDesktopOverlay(change, !!msg.e, stroke);
      } else if (msg.t === 'clear') {
        render(model.clear());
        forwardToDesktopOverlay({ kind: 'reset' });
      } else if (msg.t === 'sync-req') {
        if (!transport.isSharer()) return;
        for (const part of chunkSnapshot(model.snapshot())) transport.send(part, [from]);
      } else if (msg.t === 'sync') {
        if (!awaitingSyncRef.current) return;
        const strokes = assemblerRef.current.add(msg);
        if (!strokes) return;
        awaitingSyncRef.current = false;
        render(model.mergeSync(strokes));
      }
    });

    // Arriving mid-share: ask the presenter for what is already drawn (once more if no answer).
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (!transport.isSharer()) {
      awaitingSyncRef.current = true;
      const ask = () => {
        if (awaitingSyncRef.current) transport.send({ t: 'sync-req' });
      };
      timers.push(setTimeout(ask, 300), setTimeout(ask, 2500));
      timers.push(setTimeout(() => (awaitingSyncRef.current = false), 6000));
    }
    return () => {
      unsubscribe();
      timers.forEach(clearTimeout);
    };
  }, [transport, render, forwardToDesktopOverlay]);

  /* ── Keep strokes on the picture when the window, the layout or the shared video's size changes ── */
  useEffect(() => {
    if (bridgeOnly) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(redrawAll);
    };
    schedule();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (canvas.parentElement) ro?.observe(canvas.parentElement);
    let video: HTMLVideoElement | null = null;
    const watchVideo = () => {
      const v = getShareVideoRef.current();
      if (v === video) return;
      if (video) {
        ro?.unobserve(video);
        video.removeEventListener('resize', schedule);
        video.removeEventListener('loadedmetadata', schedule);
      }
      video = v;
      if (video) {
        ro?.observe(video);
        video.addEventListener('resize', schedule);
        video.addEventListener('loadedmetadata', schedule);
      }
      schedule();
    };
    watchVideo();
    // The share tile can be swapped or moved (layout changes) without resizing the stage.
    const poll = setInterval(() => {
      watchVideo();
      const now = measureContent();
      const was = contentRef.current;
      if (
        now &&
        (!was ||
          Math.abs(now.left - was.left) > 0.5 ||
          Math.abs(now.top - was.top) > 0.5 ||
          Math.abs(now.width - was.width) > 0.5 ||
          Math.abs(now.height - was.height) > 0.5)
      ) {
        schedule();
      }
    }, 500);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(poll);
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      if (video) {
        video.removeEventListener('resize', schedule);
        video.removeEventListener('loadedmetadata', schedule);
      }
    };
  }, [bridgeOnly, redrawAll, measureContent]);

  /* ── Local drawing ── */
  const pointerToContent = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const content = contentRef.current ?? measureContent();
    if (!canvas || !content) return null;
    const box = canvas.getBoundingClientRect();
    return toContentNormalized(clientX - box.left, clientY - box.top, content);
  };

  const addLocalPoint = (x: number, y: number, force = false) => {
    const batcher = batcherRef.current;
    const local = localStrokeRef.current;
    if (!batcher || !local) return;
    const kept = batcher.add(x, y, force);
    if (!kept) return;
    const change = modelRef.current.applySeg(transport.localIdentity, {
      t: 'seg',
      id: local.id,
      c: color,
      w: LINE_WIDTHS[lineWidthIdx],
      i: local.count,
      p: kept,
    });
    local.count += 1;
    render(change);
    forwardToDesktopOverlay(change);
  };

  const finishLocalStroke = () => {
    const local = localStrokeRef.current;
    batcherRef.current?.end();
    batcherRef.current = null;
    localStrokeRef.current = null;
    if (!local) return;
    const stroke = modelRef.current.list().find((s) => s.from === transport.localIdentity && s.id === local.id);
    if (stroke) {
      stroke.done = true;
      forwardToDesktopOverlay({ kind: 'none' }, true, stroke);
    }
  };

  const clearCanvas = () => {
    render(modelRef.current.clear());
    forwardToDesktopOverlay({ kind: 'reset' });
    transport.send({ t: 'clear' });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode || bridgeOnly) return;
    const pos = pointerToContent(e.clientX, e.clientY);
    // Only the shared picture is drawable, not the bars or the camera strip.
    if (!pos?.inside) return;
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    setIsDrawing(true);
    const id = nextStrokeIdRef.current++;
    localStrokeRef.current = { id, count: 0 };
    batcherRef.current = new StrokeBatcher(id, color, LINE_WIDTHS[lineWidthIdx], (seg) => transport.send(seg));
    if (forwardToOverlay) refreshOverlayScale();
    addLocalPoint(pos.x, pos.y, true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode || bridgeOnly) return;
    if (!isDrawing) {
      const pos = pointerToContent(e.clientX, e.clientY);
      const inside = !!pos?.inside;
      if (inside !== overContent) setOverContent(inside);
      return;
    }
    e.preventDefault();
    const native = e.nativeEvent as PointerEvent;
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [native]) {
      const pos = pointerToContent(ev.clientX, ev.clientY);
      if (pos) addLocalPoint(pos.x, pos.y);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode || !isDrawing || bridgeOnly) return;
    e.preventDefault();
    setIsDrawing(false);
    const pos = pointerToContent(e.clientX, e.clientY);
    if (pos) addLocalPoint(pos.x, pos.y);
    finishLocalStroke();
  };

  // Leaving drawing mode mid-stroke still finishes the stroke for everyone.
  useEffect(() => {
    if (!isDrawingMode && localStrokeRef.current) {
      setIsDrawing(false);
      finishLocalStroke();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDrawingMode]);

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
          cursor: isDrawingMode ? (overContent || isDrawing ? 'crosshair' : 'default') : 'default',
          touchAction: isDrawingMode ? 'none' : undefined,
        }}
      />

      {isDrawingMode && (
        <div
          className="kloud-anno-bar"
          role="toolbar"
          aria-label={t('annotation.toolbar')}
          style={{
            position: 'absolute',
            top: 14,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1001,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 8,
            maxWidth: 'calc(100% - 24px)',
            boxSizing: 'border-box',
            background: 'rgba(30, 31, 36, 0.95)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            padding: '8px 12px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
            fontFamily: 'var(--km-font)',
            userSelect: 'none',
            pointerEvents: 'auto',
          }}
        >
          <style>{`
            .kloud-anno-bar button {
              appearance: none;
              -webkit-appearance: none;
              margin: 0;
              font: inherit;
            }
            .kloud-anno-bar button:focus-visible {
              outline: 2px solid var(--km-on-dark-accent, #c9c8ff);
              outline-offset: 2px;
            }
            .kloud-anno-bar .kloud-anno-width:hover {
              background: rgba(255, 255, 255, 0.1);
            }
            .kloud-anno-bar .kloud-anno-clear {
              color: rgba(248, 113, 113, 0.85);
              background: transparent;
            }
            .kloud-anno-bar .kloud-anno-clear:hover {
              color: #f87171;
              background: rgba(248, 113, 113, 0.12);
            }
            @media (prefers-reduced-motion: reduce) {
              .kloud-anno-bar button {
                transition: none !important;
              }
            }
          `}</style>
          {COLORS.map((c, i) => (
            <button
              type="button"
              key={c}
              onClick={() => setColor(c)}
              title={t(COLOR_LABEL_KEYS[i])}
              aria-label={t(COLOR_LABEL_KEYS[i])}
              aria-pressed={color === c}
              style={{
                width: 22,
                height: 22,
                padding: 0,
                borderRadius: '50%',
                background: c,
                cursor: 'pointer',
                border: color === c ? '2.5px solid #fff' : '2px solid rgba(255,255,255,0.15)',
                boxShadow: color === c ? `0 0 0 2px rgba(255,255,255,0.25), 0 0 10px ${c}99` : 'none',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                transform: color === c ? 'scale(1.2)' : 'scale(1)',
                flexShrink: 0,
              }}
            />
          ))}

          <span
            aria-hidden
            style={{
              width: 1,
              height: 22,
              background: 'rgba(255,255,255,0.15)',
              flexShrink: 0,
            }}
          />

          {LINE_WIDTHS.map((w, i) => (
            <button
              type="button"
              key={w}
              className="kloud-anno-width"
              onClick={() => setLineWidthIdx(i)}
              title={t('annotation.lineWidth', { px: w })}
              aria-label={t('annotation.lineWidth', { px: w })}
              aria-pressed={lineWidthIdx === i}
              style={{
                width: 28,
                height: 28,
                padding: 0,
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                background: lineWidthIdx === i ? 'rgba(255,255,255,0.16)' : 'transparent',
                border: 'none',
                transition: 'background 0.15s ease',
                flexShrink: 0,
              }}
            >
              <span
                aria-hidden
                style={{
                  display: 'block',
                  width: 6 + i * 3,
                  height: 6 + i * 3,
                  borderRadius: '50%',
                  background: color,
                  opacity: 0.9,
                }}
              />
            </button>
          ))}

          <span
            aria-hidden
            style={{
              width: 1,
              height: 22,
              background: 'rgba(255,255,255,0.15)',
              flexShrink: 0,
            }}
          />

          <button
            type="button"
            className="kloud-anno-clear"
            onClick={clearCanvas}
            title={t('annotation.clearAll')}
            aria-label={t('annotation.clearAll')}
            style={{
              width: 32,
              height: 32,
              padding: 0,
              border: 'none',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              transition: 'background 0.15s ease, color 0.15s ease',
              flexShrink: 0,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
