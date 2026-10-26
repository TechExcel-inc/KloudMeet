'use client';

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type Participant, type Room } from 'livekit-client';
import { useI18n } from '@/lib/i18n';
import { findShareVideo, shareContentClientRect, toContentNormalized, type Rect } from '@/lib/shareContentRect';
import {
  RC_CAP_KEYS,
  RC_CAP_WHEEL,
  WheelAccumulator,
  decideKey,
  isMacPlatform,
  wheelPixels,
  type RcMod,
} from '@/lib/remoteControlInput';
import { STOP_SHORTCUT, isAllowedKey, sanitizeText } from '@/remote-input';

export type RemoteControlMessage = {
  type: 'mousemove' | 'mousedown' | 'mouseup' | 'dblclick' | 'screen-info' | 'wheel' | 'key' | 'text';
  // For mouse events:
  x?: number; // normalized 0-1 relative to video CONTENT (not container, letterbox-corrected)
  y?: number;
  button?: number; // 0 = left, 2 = right
  // Absolute pixels on presenter's screen (legacy)
  absX?: number;
  absY?: number;
  // Wheel: browser pixels, positive = down / right
  dx?: number;
  dy?: number;
  // Key press (allowlisted, see remote-input.js) and typed text
  key?: string;
  mods?: RcMod[];
  text?: string;
  // For screen-info broadcast (from presenter to controllers):
  screenW?: number;
  screenH?: number;
  videoW?: number;
  videoH?: number;
  shareKind?: 'screen' | 'window';
  /** The presenter shares from the desktop app (a browser presenter can't be controlled). */
  desktop?: boolean;
  /** Extra input the presenter's desktop app executes: 'wheel', 'keys'. */
  caps?: string[];
};

// Pending request info for the presenter's approval dialog
export type RemoteControlRequest = {
  requesterIdentity: string;
  requesterName: string;
};

/** How remote-control messages travel (LiveKit in a room, BroadcastChannel in the dev preview). */
export type RemoteControlTransport = {
  readonly localIdentity: string;
  send: (msg: RemoteControlMessage) => void;
  subscribe: (handler: (msg: RemoteControlMessage, from: string) => void) => () => void;
  nameOf: (identity: string) => string;
};

interface RemoteControlOverlayProps {
  isActive: boolean;
  isPresenter: boolean;
  /** Presenter: the approved controller. Input from anyone else is ignored. */
  controllerIdentity?: string | null;
  /** Presenter: stop control (banner button, desktop bar or shortcut). */
  onPresenterStop?: () => void;
  /** Controller: give control back (chip's Stop button). */
  onStopControl?: () => void;
  className?: string;
}

const RC_TOPIC = 'remote-control';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

const POINTER_TYPES = new Set(['mousemove', 'mousedown', 'mouseup', 'dblclick']);
const isUnit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Presenter side: keep only well-formed input (absolute positions are never accepted from peers). */
export function sanitizeControlMessage(raw: unknown): RemoteControlMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const type = m.type as RemoteControlMessage['type'];
  if (POINTER_TYPES.has(type)) {
    if (!isUnit(m.x) || !isUnit(m.y)) return null;
    return { type, x: m.x as number, y: m.y as number, button: m.button === 2 ? 2 : 0 };
  }
  if (type === 'wheel') {
    if (!isUnit(m.x) || !isUnit(m.y) || !isFiniteNum(m.dx) || !isFiniteNum(m.dy)) return null;
    const clamp = (v: number) => Math.max(-2000, Math.min(2000, v));
    return { type, x: m.x as number, y: m.y as number, dx: clamp(m.dx), dy: clamp(m.dy) };
  }
  if (type === 'key') {
    const combo = { key: String(m.key ?? ''), mods: Array.isArray(m.mods) ? (m.mods as RcMod[]) : [] };
    return isAllowedKey(combo) ? { type, key: combo.key, mods: combo.mods } : null;
  }
  if (type === 'text') {
    const text = sanitizeText(m.text);
    return text ? { type, text } : null;
  }
  return null;
}

function useLiveKitRcTransport(room: Room | undefined): RemoteControlTransport | null {
  return useMemo(() => {
    if (!room) return null;
    return {
      get localIdentity() {
        return room.localParticipant.identity;
      },
      send: (msg) => {
        const data = encoder.encode(JSON.stringify(msg));
        room.localParticipant.publishData(data, { reliable: true, topic: RC_TOPIC }).catch(() => {
          room.localParticipant.publishData(data, { topic: RC_TOPIC }).catch(console.error);
        });
      },
      subscribe: (handler) => {
        const onData = (payload: Uint8Array, participant?: Participant, _kind?: unknown, topic?: string) => {
          if (topic !== RC_TOPIC || !participant) return;
          try {
            handler(JSON.parse(decoder.decode(payload)) as RemoteControlMessage, participant.identity);
          } catch (e) {
            console.error('Failed to parse remote control data', e);
          }
        };
        room.on(RoomEvent.DataReceived, onData);
        return () => {
          room.off(RoomEvent.DataReceived, onData);
        };
      },
      nameOf: (identity) => {
        const p = room.getParticipantByIdentity(identity);
        return p?.name || identity;
      },
    };
  }, [room]);
}

export function RemoteControlOverlay(props: RemoteControlOverlayProps) {
  const room = useRoomContext();
  const transport = useLiveKitRcTransport(room);
  if (!transport) return null;
  return <RemoteControlLayer {...props} transport={transport} />;
}

type PresenterInfo = {
  identity: string;
  screenW: number;
  screenH: number;
  videoW: number;
  videoH: number;
  desktop: boolean;
  caps: string[];
};

type RemoteControlLayerProps = RemoteControlOverlayProps & {
  transport: RemoteControlTransport;
  getShareVideo?: () => HTMLVideoElement | null;
  /** Presenter: where the desktop app executes input (defaults to window.electronAPI). */
  executeInput?: (msg: RemoteControlMessage) => void;
};

export function RemoteControlLayer({
  isActive,
  isPresenter,
  controllerIdentity = null,
  onPresenterStop,
  onStopControl,
  className,
  transport,
  getShareVideo = findShareVideo,
  executeInput,
}: RemoteControlLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useI18n();
  const [isControlling, setIsControlling] = useState(false);
  const [presenter, setPresenter] = useState<PresenterInfo | null>(null);
  const [contentBox, setContentBox] = useState<Rect | null>(null);
  const [keyboardOn, setKeyboardOn] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composingRef = useRef(false);
  const isMac = useMemo(isMacPlatform, []);
  const isController = isActive && !isPresenter;

  const controllerRef = useRef(controllerIdentity);
  controllerRef.current = controllerIdentity;
  const executeRef = useRef(executeInput);
  executeRef.current = executeInput;
  const onPresenterStopRef = useRef(onPresenterStop);
  onPresenterStopRef.current = onPresenterStop;

  // ─── Presenter: broadcast share-target size + what this app can execute ─
  useEffect(() => {
    if (!isPresenter) return;

    let cancelled = false;

    const broadcast = async () => {
      let sw = window.screen.width;
      let sh = window.screen.height;
      let shareKind: 'screen' | 'window' | undefined;
      const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

      try {
        const bounds = api?.getShareTargetBounds ? await api.getShareTargetBounds() : null;
        if (cancelled) return;
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          sw = bounds.width;
          sh = bounds.height;
          shareKind = bounds.kind;
        }
      } catch {
        /* fall back to window.screen */
      }

      const video = document.querySelector<HTMLVideoElement>(
        '.lk-focus-layout video, [data-lk-source="screen_share"] video',
      );
      const vw = video?.videoWidth || sw;
      const vh = video?.videoHeight || sh;

      transport.send({
        type: 'screen-info',
        screenW: sw,
        screenH: sh,
        videoW: vw,
        videoH: vh,
        shareKind,
        desktop: !!(api?.sendRemoteControlMessage || executeRef.current),
        caps: executeRef.current ? [RC_CAP_WHEEL, RC_CAP_KEYS] : (api?.remoteControlCaps ?? []),
      });
    };

    void broadcast();
    const interval = setInterval(() => {
      void broadcast();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isPresenter, transport]);

  // ─── Presenter: execute the approved controller's input via the desktop app ──
  // ─── Controller: learn the presenter's screen size / capabilities ──
  useEffect(() => {
    return transport.subscribe((data, from) => {
      if (data.type === 'screen-info') {
        if (!isPresenter && data.screenW && data.screenH) {
          setPresenter((prev) => {
            const next: PresenterInfo = {
              identity: from,
              screenW: data.screenW!,
              screenH: data.screenH!,
              videoW: data.videoW || data.screenW!,
              videoH: data.videoH || data.screenH!,
              // Pages from before this field existed only ran in the desktop app's bridge.
              desktop: data.desktop ?? true,
              caps: Array.isArray(data.caps) ? data.caps.filter((c) => typeof c === 'string') : [],
            };
            return prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
          });
        }
        return;
      }

      if (!isPresenter) return;
      if (!controllerRef.current || from !== controllerRef.current) return;
      const msg = sanitizeControlMessage(data);
      if (!msg) return;
      if (executeRef.current) {
        executeRef.current(msg);
      } else if (typeof window !== 'undefined' && window.electronAPI?.sendRemoteControlMessage) {
        window.electronAPI.sendRemoteControlMessage(msg);
      }
    });
  }, [isPresenter, transport]);

  // ─── Presenter: tell the desktop app a session is on (banner, stop shortcut, local mouse wins) ──
  const controllerName = controllerIdentity ? transport.nameOf(controllerIdentity) : '';
  useEffect(() => {
    if (!isPresenter) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    api?.setRemoteControlSession?.({ active: !!controllerIdentity, controllerName });
    return () => {
      if (controllerIdentity) api?.setRemoteControlSession?.({ active: false });
    };
  }, [isPresenter, controllerIdentity, controllerName]);

  /** Presenter stops control: ignore input still in flight and tell the desktop app before React re-renders. */
  const stopAsPresenter = useCallback(() => {
    controllerRef.current = null;
    if (typeof window !== 'undefined') window.electronAPI?.setRemoteControlSession?.({ active: false });
    onPresenterStopRef.current?.();
  }, []);

  useEffect(() => {
    if (!isPresenter) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    return api?.onRemoteControlStopped?.(stopAsPresenter);
  }, [isPresenter, stopAsPresenter]);

  // ─── Controller: where the shared picture is, to frame it and map pointer positions ──
  const measure = useCallback((): Rect | null => {
    const el = containerRef.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const cr = shareContentClientRect(getShareVideo());
    if (!cr) return { left: 0, top: 0, width: box.width, height: box.height };
    return { left: cr.left - box.left, top: cr.top - box.top, width: cr.width, height: cr.height };
  }, [getShareVideo]);

  useEffect(() => {
    if (!isController) return;
    const update = () =>
      setContentBox((prev) => {
        const next = measure();
        if (
          prev &&
          next &&
          Math.abs(prev.left - next.left) < 0.5 &&
          Math.abs(prev.top - next.top) < 0.5 &&
          Math.abs(prev.width - next.width) < 0.5 &&
          Math.abs(prev.height - next.height) < 0.5
        ) {
          return prev;
        }
        return next;
      });
    update();
    const poll = setInterval(update, 400);
    window.addEventListener('resize', update);
    return () => {
      clearInterval(poll);
      window.removeEventListener('resize', update);
    };
  }, [isController, measure]);

  const toContent = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      const content = measure();
      if (!el || !content) return { x: 0, y: 0, inside: false };
      const box = el.getBoundingClientRect();
      return toContentNormalized(clientX - box.left, clientY - box.top, content);
    },
    [measure],
  );

  const buildMsg = useCallback(
    (
      type: RemoteControlMessage['type'],
      e: { clientX: number; clientY: number },
      button = 0,
    ): RemoteControlMessage => {
      const { x, y } = toContent(e.clientX, e.clientY);
      return { type, x, y, button };
    },
    [toContent],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sendMove = useCallback(
    throttle((msg: RemoteControlMessage) => {
      transport.send(msg);
    }, 16),
    [transport],
  );

  const showHint = useCallback((text: string) => {
    setHint(text);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHint(null), 2600);
  }, []);
  useEffect(() => () => {
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
  }, []);

  const canWheel = !!presenter?.caps.includes(RC_CAP_WHEEL);
  const canKeys = !!presenter?.caps.includes(RC_CAP_KEYS);
  const presenterName = presenter ? transport.nameOf(presenter.identity) : '';

  // ─── Controller: wheel (needs a non-passive listener to keep the meeting page from scrolling) ──
  useEffect(() => {
    const el = containerRef.current;
    if (!isController || !canWheel || !el) return;
    const acc = new WheelAccumulator((m) => transport.send({ type: 'wheel', ...m }));
    const onWheel = (e: WheelEvent) => {
      const pos = toContent(e.clientX, e.clientY);
      if (!pos.inside) return;
      e.preventDefault();
      const { dx, dy } = wheelPixels(e, el.clientHeight);
      acc.add(pos.x, pos.y, dx, dy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      acc.dispose();
    };
  }, [isController, canWheel, toContent, transport]);

  // ─── Controller: keyboard, through a hidden text field so input methods work ──
  const focusKeyboard = () => {
    if (!canKeys) return;
    const ta = keyboardRef.current;
    if (!ta || document.activeElement === ta) return;
    ta.focus({ preventScroll: true });
    if (!keyboardOn) showHint(t('remoteControl.keyboardHint', { name: presenterName }));
  };

  const sendTextFromField = () => {
    const ta = keyboardRef.current;
    if (!ta || composingRef.current) return;
    const text = sanitizeText(ta.value);
    ta.value = '';
    if (text) transport.send({ type: 'text', text });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const decision = decideKey(
      {
        key: e.key,
        code: e.code,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing || composingRef.current,
      },
      isMac,
    );
    if (decision.kind === 'send') {
      e.preventDefault();
      e.stopPropagation();
      transport.send({ type: 'key', key: decision.combo.key, mods: decision.combo.mods });
    } else if (decision.kind === 'text') {
      // Let the character land in the field; onInput sends it. Keep meeting shortcuts out.
      e.stopPropagation();
    } else if (decision.kind === 'blocked') {
      // Stays on this computer (meeting shortcuts such as mute still work).
      showHint(t('remoteControl.shortcutNotSent', { keys: decision.label }));
    }
  };

  useEffect(() => {
    if (!isController) setKeyboardOn(false);
  }, [isController]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isActive || isPresenter) return;
    if (!toContent(e.clientX, e.clientY).inside) {
      keyboardRef.current?.blur();
      return;
    }
    e.preventDefault();
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    setIsControlling(true);
    transport.send(buildMsg('mousedown', e, e.button));
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
      transport.send(buildMsg('mouseup', e, e.button));
      focusKeyboard();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isActive || isPresenter) return;
    if (!toContent(e.clientX, e.clientY).inside) return;
    e.preventDefault();
    transport.send(buildMsg('dblclick', e, 0));
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isActive || isPresenter) return;
    e.preventDefault();
  };

  // ─── Presenter: banner in the meeting window while someone is in control ──
  if (isPresenter) {
    if (!controllerIdentity || typeof document === 'undefined') return null;
    const hasDesktopShortcut = !!window.electronAPI?.setRemoteControlSession;
    return createPortal(
      <PresenterControlBanner
        name={controllerName}
        shortcut={hasDesktopShortcut ? shortcutLabel(isMac) : null}
        onStop={stopAsPresenter}
      />,
      document.body,
    );
  }

  if (!isController) return null;

  const box = contentBox;
  const modeLabel = !presenter
    ? t('remoteControl.syncing')
    : !presenter.desktop
      ? t('remoteControl.browserPresenter', { name: presenterName })
      : canKeys
        ? keyboardOn
          ? t('remoteControl.keyboardOn')
          : t('remoteControl.clickToType')
        : t('remoteControl.mouseOnly');

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
        pointerEvents: 'auto',
        cursor: isControlling ? 'grabbing' : 'crosshair',
        borderRadius: 'inherit',
        touchAction: 'none',
      }}
    >
      <style>{`
        .km-rc-chip button { appearance: none; -webkit-appearance: none; margin: 0; font: inherit; }
        .km-rc-chip button:focus-visible { outline: 2px solid var(--km-on-dark-accent, #c9c8ff); outline-offset: 2px; }
        .km-rc-stop:hover { background: rgba(248, 113, 113, 0.16) !important; color: #fecaca !important; }
        @keyframes kmRcHintIn { from { opacity: 0; transform: translate(-50%, -4px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @media (prefers-reduced-motion: reduce) { .km-rc-hint { animation: none !important; } }
      `}</style>

      {box && (
        <>
          {/* Frame around the shared picture: this area is the presenter's screen */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              boxShadow: `inset 0 0 0 2px ${keyboardOn ? 'rgba(96, 165, 250, 0.95)' : 'rgba(96, 165, 250, 0.55)'}`,
              pointerEvents: 'none',
              transition: 'box-shadow 0.2s ease',
            }}
          />

          <div
            className="km-rc-chip"
            role="status"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: box.left + box.width / 2,
              top: box.top + 10,
              transform: 'translateX(-50%)',
              zIndex: 1002,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              maxWidth: Math.max(220, box.width - 24),
              boxSizing: 'border-box',
              padding: '6px 6px 6px 12px',
              borderRadius: 999,
              background: 'rgba(30, 31, 36, 0.95)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
              color: '#f1f1f4',
              fontFamily: 'var(--km-font)',
              fontSize: 12.5,
              whiteSpace: 'nowrap',
              cursor: 'default',
              userSelect: 'none',
            }}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="#93c5fd" aria-hidden style={{ flexShrink: 0 }}>
              <path d="M4 0l16 12.279-6.951 1.17 4.325 8.817-2.123 1.034-4.285-8.745-5.966 5.014z" />
            </svg>
            <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {presenterName ? t('remoteControl.controllingName', { name: presenterName }) : t('remoteControl.controlling')}
            </span>
            <span aria-hidden style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color: keyboardOn ? '#bbf7d0' : 'rgba(255,255,255,0.7)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden style={{ flexShrink: 0 }}>
                <rect x="2.5" y="6" width="19" height="12" rx="2" />
                <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10" strokeLinecap="round" />
              </svg>
              {modeLabel}
            </span>
            {onStopControl && (
              <button
                type="button"
                className="km-rc-stop"
                onClick={() => onStopControl()}
                style={{
                  flexShrink: 0,
                  height: 26,
                  padding: '0 12px',
                  borderRadius: 999,
                  border: 'none',
                  cursor: 'pointer',
                  background: 'rgba(248, 113, 113, 0.1)',
                  color: '#fca5a5',
                  fontWeight: 600,
                  fontSize: 12,
                  transition: 'background 0.15s ease, color 0.15s ease',
                }}
              >
                {t('remoteControl.stop')}
              </button>
            )}
          </div>

          {hint && (
            <div
              className="km-rc-hint"
              role="status"
              aria-live="polite"
              style={{
                position: 'absolute',
                left: box.left + box.width / 2,
                top: box.top + 54,
                transform: 'translateX(-50%)',
                zIndex: 1002,
                maxWidth: Math.max(220, box.width - 24),
                padding: '6px 12px',
                borderRadius: 8,
                background: 'rgba(30, 31, 36, 0.92)',
                color: 'rgba(255,255,255,0.88)',
                fontFamily: 'var(--km-font)',
                fontSize: 12,
                lineHeight: 1.4,
                textAlign: 'center',
                pointerEvents: 'none',
                boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
                animation: 'kmRcHintIn 0.18s ease',
              }}
            >
              {hint}
            </div>
          )}
        </>
      )}

      {canKeys && (
        <textarea
          ref={keyboardRef}
          aria-label={t('remoteControl.keyboardField', { name: presenterName })}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onFocus={() => setKeyboardOn(true)}
          onBlur={() => setKeyboardOn(false)}
          onKeyDown={handleKeyDown}
          onKeyUp={(e) => e.stopPropagation()}
          onInput={sendTextFromField}
          onCompositionStart={() => (composingRef.current = true)}
          onCompositionEnd={() => {
            composingRef.current = false;
            sendTextFromField();
          }}
          style={{
            position: 'absolute',
            left: box ? box.left + 4 : 0,
            top: box ? box.top + 4 : 0,
            width: 1,
            height: 1,
            opacity: 0,
            padding: 0,
            border: 0,
            resize: 'none',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

function shortcutLabel(isMac: boolean) {
  return isMac ? '⌃⌥S' : STOP_SHORTCUT.replace('Control', 'Ctrl');
}

/** Presenter's in-app notice: who is in control, and how to take it back. */
function PresenterControlBanner({ name, shortcut, onStop }: { name: string; shortcut: string | null; onStop: () => void }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      className="km-rc-presenter-banner"
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 'calc(100vw - 32px)',
        boxSizing: 'border-box',
        padding: '6px 6px 6px 14px',
        borderRadius: 999,
        background: 'rgba(30, 31, 36, 0.96)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
        color: '#f1f1f4',
        fontFamily: 'var(--km-font)',
        fontSize: 13,
        whiteSpace: 'nowrap',
      }}
    >
      <style>{`
        @keyframes kmRcLive { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .km-rc-presenter-banner button:hover { background: #f87171 !important; }
        .km-rc-presenter-banner button:focus-visible { outline: 2px solid var(--km-on-dark-accent, #c9c8ff); outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { .km-rc-live { animation: none !important; } }
      `}</style>
      <span
        aria-hidden
        className="km-rc-live"
        style={{ width: 8, height: 8, borderRadius: '50%', background: '#60a5fa', flexShrink: 0, animation: 'kmRcLive 1.6s ease-in-out infinite' }}
      />
      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {t('remoteControl.presenterBanner', { name })}
      </span>
      {shortcut && (
        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>{t('remoteControl.stopShortcutHint', { keys: shortcut })}</span>
      )}
      <button
        type="button"
        onClick={onStop}
        style={{
          appearance: 'none',
          flexShrink: 0,
          height: 28,
          padding: '0 14px',
          borderRadius: 999,
          border: 'none',
          cursor: 'pointer',
          background: '#ef4444',
          color: '#fff',
          font: 'inherit',
          fontSize: 12.5,
          fontWeight: 600,
          transition: 'background 0.15s ease',
        }}
      >
        {t('remoteControl.stopControl')}
      </button>
    </div>
  );
}
