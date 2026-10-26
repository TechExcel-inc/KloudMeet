'use client';

/**
 * Development-only harness for screen-share annotation and remote control, without a meeting.
 * Open it in two or more windows (or tabs) of the same browser; they talk over a
 * BroadcastChannel instead of LiveKit.
 *
 *   /dev/share?role=presenter&name=Ying          – the presenter: a fake desktop as the shared
 *        screen, with the desktop app's annotation overlay (public/overlay.html) and control
 *        bar (rc-bar.html) on top, and a mock electronAPI that executes remote input on it.
 *   /dev/share?role=viewer&name=Alex             – a viewer: the share as a <video>, letterboxed
 *        beside a camera strip, with the real AnnotationLayer and RemoteControlLayer.
 *   &layout=bottom&w=640                         – camera strip below and a narrower stage.
 *
 * Not served in production.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { AnnotationLayer, type AnnotationTransport } from '@/lib/AnnotationCanvas';
import { parseAnnotationMsg } from '@/lib/annotationModel';
import {
  RemoteControlLayer,
  type RemoteControlMessage,
  type RemoteControlTransport,
} from '@/lib/RemoteControlOverlay';
import { toNutKeys, wheelSteps } from '@/remote-input';

const SCREEN_W = 1600;
const SCREEN_H = 1000;
const CHANNEL = 'km-dev-share';

type Envelope = { topic: string; from: string; to?: string[]; msg: unknown };

/* ── Fake desktop: drawn the same way in every window from the presenter's state ── */

type Desk = {
  text: string;
  scroll: number;
  cursor: { x: number; y: number };
  lastInput: string;
  clicks: { x: number; y: number; at: number; right?: boolean }[];
  selectAll: boolean;
};

const INITIAL_DESK: Desk = {
  text: 'Q3 launch notes\n',
  scroll: 0,
  cursor: { x: 800, y: 500 },
  lastInput: '—',
  clicks: [],
  selectAll: false,
};

const LIST = Array.from({ length: 60 }, (_, i) => `Row ${i + 1} · Customer ${String.fromCharCode(65 + (i % 26))}${i} · ${(i * 37) % 100}%`);

function drawDesk(ctx: CanvasRenderingContext2D, d: Desk) {
  const g = ctx.createLinearGradient(0, 0, SCREEN_W, SCREEN_H);
  g.addColorStop(0, '#1e3a5f');
  g.addColorStop(1, '#3b1f5f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  // menu bar
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(0, 0, SCREEN_W, 34);
  ctx.fillStyle = '#111';
  ctx.font = '600 17px -apple-system, Segoe UI, sans-serif';
  ctx.fillText('Presenter’s screen (1600 × 1000)', 18, 23);
  // a 4×3 grid of reference marks to check where strokes land
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo((SCREEN_W * i) / 4, 34);
    ctx.lineTo((SCREEN_W * i) / 4, SCREEN_H);
    ctx.stroke();
  }
  for (let j = 1; j < 3; j++) {
    ctx.beginPath();
    ctx.moveTo(0, (SCREEN_H * j) / 3);
    ctx.lineTo(SCREEN_W, (SCREEN_H * j) / 3);
    ctx.stroke();
  }
  // editor window
  const ex = 120, ey = 90, ew = 760, eh = 520;
  ctx.fillStyle = '#fff';
  ctx.fillRect(ex, ey, ew, eh);
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(ex, ey, ew, 36);
  ctx.fillStyle = '#111';
  ctx.font = '600 15px -apple-system, Segoe UI, sans-serif';
  ctx.fillText('Notes — click here, then type', ex + 14, ey + 24);
  ctx.font = '20px -apple-system, Segoe UI, sans-serif';
  const lines = d.text.split('\n');
  if (d.selectAll) {
    ctx.fillStyle = 'rgba(59,130,246,0.25)';
    ctx.fillRect(ex + 14, ey + 50, ew - 28, lines.length * 30);
  }
  ctx.fillStyle = '#111';
  lines.forEach((ln, i) => ctx.fillText(ln + (i === lines.length - 1 ? '▏' : ''), ex + 18, ey + 74 + i * 30));
  // scrollable list window
  const lx = 960, ly = 90, lw = 520, lh = 760;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(lx, ly, lw, lh);
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(lx, ly, lw, 36);
  ctx.fillStyle = '#111';
  ctx.font = '600 15px -apple-system, Segoe UI, sans-serif';
  ctx.fillText('Customers — scroll me', lx + 14, ly + 24);
  ctx.save();
  ctx.beginPath();
  ctx.rect(lx, ly + 36, lw, lh - 36);
  ctx.clip();
  ctx.font = '17px -apple-system, Segoe UI, sans-serif';
  LIST.forEach((row, i) => {
    const y = ly + 70 + i * 34 - d.scroll;
    ctx.fillStyle = i % 2 ? '#f1f5f9' : '#fff';
    ctx.fillRect(lx, y - 22, lw, 34);
    ctx.fillStyle = '#334155';
    ctx.fillText(row, lx + 16, y);
  });
  ctx.restore();
  // status line
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(120, 900, 760, 50);
  ctx.fillStyle = '#fff';
  ctx.font = '600 20px -apple-system, Segoe UI, sans-serif';
  ctx.fillText(`Last remote input: ${d.lastInput}`, 140, 933);
  // click ripples
  const now = Date.now();
  for (const c of d.clicks) {
    const age = (now - c.at) / 600;
    if (age > 1) continue;
    ctx.strokeStyle = c.right ? `rgba(250,204,21,${1 - age})` : `rgba(96,165,250,${1 - age})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 10 + age * 24, 0, Math.PI * 2);
    ctx.stroke();
  }
  // presenter's mouse pointer
  const { x, y } = d.cursor;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + 26);
  ctx.lineTo(x + 7, y + 20);
  ctx.lineTo(x + 12, y + 31);
  ctx.lineTo(x + 16, y + 29);
  ctx.lineTo(x + 11, y + 18);
  ctx.lineTo(x + 19, y + 18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** Apply one remote event to the fake desktop, through the same policy the desktop app uses. */
const FAKE_KEY = new Proxy({} as Record<string, number>, { get: (_t, k) => (typeof k === 'string' ? 1 : undefined) });
function applyInput(d: Desk, m: RemoteControlMessage): Desk {
  const at = (msg: RemoteControlMessage) => ({ x: (msg.x ?? 0) * SCREEN_W, y: (msg.y ?? 0) * SCREEN_H });
  switch (m.type) {
    case 'mousemove':
      return { ...d, cursor: at(m) };
    case 'mousedown':
      return { ...d, cursor: at(m), lastInput: m.button === 2 ? 'right click' : 'click', clicks: [...d.clicks.slice(-5), { ...at(m), at: Date.now(), right: m.button === 2 }] };
    case 'mouseup':
      return { ...d, cursor: at(m) };
    case 'dblclick':
      return { ...d, cursor: at(m), lastInput: 'double-click' };
    case 'wheel': {
      const steps = wheelSteps(m.dx ?? 0, m.dy ?? 0, 'darwin');
      return { ...d, cursor: at(m), scroll: Math.max(0, Math.min(LIST.length * 34 - 700, d.scroll + steps.down)), lastInput: `scroll ${steps.down > 0 ? '↓' : '↑'} ${Math.abs(steps.down)}px` };
    }
    case 'text':
      return { ...d, text: (d.selectAll ? '' : d.text) + (m.text ?? ''), selectAll: false, lastInput: `typed “${m.text}”` };
    case 'key': {
      if (!toNutKeys({ key: m.key!, mods: m.mods }, 'darwin', FAKE_KEY)) return { ...d, lastInput: `refused ${m.key}` };
      const label = `${(m.mods ?? []).map((x) => (x === 'primary' ? '⌘' : x === 'shift' ? '⇧' : '⌥')).join('')}${m.key}`;
      const primary = m.mods?.includes('primary');
      if (m.key === 'Enter' && !primary) return { ...d, text: d.text + '\n', selectAll: false, lastInput: label };
      if (m.key === 'Backspace' && !primary) return { ...d, text: d.selectAll ? '' : d.text.slice(0, -1), selectAll: false, lastInput: label };
      if (m.key === 'a' && primary) return { ...d, selectAll: true, lastInput: label };
      if (m.key === 'PageDown') return { ...d, scroll: Math.min(LIST.length * 34 - 700, d.scroll + 600), lastInput: label };
      if (m.key === 'PageUp') return { ...d, scroll: Math.max(0, d.scroll - 600), lastInput: label };
      return { ...d, lastInput: label };
    }
    default:
      return d;
  }
}

/* ── Transports over the BroadcastChannel ── */

function useChannel() {
  return React.useMemo(
    () => (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null),
    [],
  );
}

function subscribeTopic(channel: BroadcastChannel, me: string, topic: string, fn: (msg: unknown, from: string) => void) {
  const on = (e: MessageEvent<Envelope>) => {
    const env = e.data;
    if (!env || env.topic !== topic || env.from === me) return;
    if (env.to && !env.to.includes(me)) return;
    fn(env.msg, env.from);
  };
  channel.addEventListener('message', on);
  return () => channel.removeEventListener('message', on);
}

function useAnnoTransport(channel: BroadcastChannel | null, me: string, isSharer: boolean): AnnotationTransport | null {
  return React.useMemo(() => {
    if (!channel) return null;
    return {
      localIdentity: me,
      isSharer: () => isSharer,
      send: (msg, to) => channel.postMessage({ topic: 'anno', from: me, to, msg } satisfies Envelope),
      subscribe: (handler) =>
        subscribeTopic(channel, me, 'anno', (raw, from) => {
          const msg = parseAnnotationMsg(raw);
          if (msg) handler(msg, from);
        }),
    };
  }, [channel, me, isSharer]);
}

function useRcTransport(channel: BroadcastChannel | null, me: string): RemoteControlTransport | null {
  return React.useMemo(() => {
    if (!channel) return null;
    return {
      localIdentity: me,
      send: (msg) => channel.postMessage({ topic: 'rc', from: me, msg } satisfies Envelope),
      subscribe: (handler) => subscribeTopic(channel, me, 'rc', (raw, from) => handler(raw as RemoteControlMessage, from)),
      nameOf: (id) => id,
    };
  }, [channel, me]);
}

/* ── Page ── */

export default function DevSharePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [params, setParams] = React.useState<URLSearchParams | null>(null);
  React.useEffect(() => setParams(new URLSearchParams(window.location.search)), []);
  if (!params) return null;
  const role = params.get('role') === 'presenter' ? 'presenter' : 'viewer';
  const name = params.get('name') || (role === 'presenter' ? 'Ying' : 'Alex');
  return role === 'presenter' ? (
    <PresenterView name={name} />
  ) : (
    <ViewerView name={name} layout={params.get('layout') === 'bottom' ? 'bottom' : 'side'} stageWidth={Number(params.get('w')) || 0} />
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#0f1115',
  color: '#e5e7eb',
  fontFamily: 'var(--km-font, -apple-system, Segoe UI, sans-serif)',
  padding: 16,
  boxSizing: 'border-box',
};

const btn = (on = false): React.CSSProperties => ({
  appearance: 'none',
  border: '1px solid rgba(255,255,255,0.15)',
  background: on ? '#3b82f6' : 'rgba(255,255,255,0.06)',
  color: '#fff',
  borderRadius: 8,
  padding: '7px 12px',
  font: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
});

/** Load a desktop page (overlay.html / rc-bar.html) into an iframe with a bridge object installed first. */
function BridgedFrame({ src, global, bridge, style, title }: { src: string; global: string; bridge: unknown; style: React.CSSProperties; title: string }) {
  const [doc, setDoc] = React.useState<string | null>(null);
  React.useEffect(() => {
    (window as any)[`__${global}Bridge`] = bridge;
    fetch(src)
      .then((r) => r.text())
      .then((html) => setDoc(html.replace('<head>', `<head><script>window.${global} = parent.__${global}Bridge;</script>`)))
      .catch(() => setDoc('<p>failed</p>'));
  }, [src, global, bridge]);
  // colorScheme matches the desktop pages (light), or Chrome paints an opaque backdrop behind the
  // iframe on this dark page; the real overlay and bar are transparent windows.
  return doc ? <iframe title={title} srcDoc={doc} style={{ border: 0, background: 'transparent', colorScheme: 'light', ...style }} /> : null;
}

function PresenterView({ name }: { name: string }) {
  const channel = useChannel();
  const annoTransport = useAnnoTransport(channel, name, true);
  const rcTransport = useRcTransport(channel, name);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [desk, setDesk] = React.useState<Desk>(INITIAL_DESK);
  const deskRef = React.useRef(desk);
  deskRef.current = desk;
  const [requests, setRequests] = React.useState<string[]>([]);
  const [controller, setController] = React.useState<string | null>(null);
  const [barState, setBarState] = React.useState<{ name: string } | null>(null);

  // Overlay + control bar listeners, as the desktop app's windows would get them over IPC.
  const overlayListeners = React.useRef(new Set<(d: unknown) => void>());
  const barListeners = React.useRef(new Set<(s: unknown) => void>());
  const stopListeners = React.useRef(new Set<(r: string) => void>());

  const overlayBridge = React.useMemo(
    () => ({
      onDrawMessage: (cb: (d: unknown) => void) => {
        overlayListeners.current.add(cb);
        return () => overlayListeners.current.delete(cb);
      },
    }),
    [],
  );
  const barBridge = React.useMemo(
    () => ({
      onState: (cb: (s: unknown) => void) => {
        barListeners.current.add(cb);
        return () => barListeners.current.delete(cb);
      },
      stop: () => stopListeners.current.forEach((fn) => fn('bar')),
    }),
    [],
  );

  // Mock of the desktop app's preload API (see preload.js). Installed during the first render,
  // like a preload script, so the layers below see it in their own first effects.
  const installMock = React.useCallback(() => {
    window.electronAPI = {
      sendDrawMessage: (d) => overlayListeners.current.forEach((fn) => fn(d)),
      onDrawMessage: () => {},
      sendRemoteControlMessage: (m) => setDesk((prev) => applyInput(prev, m)),
      getShareTargetBounds: async () => ({ sourceId: 'screen:0', x: 0, y: 0, width: SCREEN_W, height: SCREEN_H, scaleFactor: 2, kind: 'screen' }),
      clearShareTarget: async () => {},
      remoteControlCaps: ['wheel', 'keys'],
      setRemoteControlSession: (s) => setBarState(s.active ? { name: s.controllerName || 'Someone' } : null),
      onRemoteControlStopped: (cb) => {
        stopListeners.current.add(cb);
        return () => stopListeners.current.delete(cb);
      },
    };
  }, []);
  const mockInstalled = React.useRef(false);
  if (!mockInstalled.current && typeof window !== 'undefined') {
    mockInstalled.current = true;
    installMock();
  }
  React.useEffect(() => {
    if (!window.electronAPI) installMock();
    return () => {
      delete window.electronAPI;
    };
  }, [installMock]);

  React.useEffect(() => {
    if (!barState) return;
    const shortcut = '⌃⌥S';
    const send = () => barListeners.current.forEach((fn) => fn({ name: barState.name, paused: false, shortcut }));
    send();
    // The desktop app sends on did-finish-load; here the iframe may still be loading, so repeat.
    const t = setInterval(send, 400);
    return () => clearInterval(t);
  }, [barState]);

  // Draw the desktop and publish its state to viewers.
  React.useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawDesk(ctx, desk);
    channel?.postMessage({ topic: 'desk', from: name, msg: desk } satisfies Envelope);
  }, [desk, channel, name]);
  React.useEffect(() => {
    // keep click ripples animating
    const id = setInterval(() => {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && deskRef.current.clicks.some((c) => Date.now() - c.at < 700)) drawDesk(ctx, deskRef.current);
    }, 50);
    return () => clearInterval(id);
  }, []);

  // Control requests (stand-in for RC_REQUEST / RC_APPROVED / RC_REVOKED / RC_STOP).
  React.useEffect(() => {
    if (!channel) return;
    const offDesk = subscribeTopic(channel, name, 'desk-req', (_m, from) =>
      channel.postMessage({ topic: 'desk', from: name, to: [from], msg: deskRef.current } satisfies Envelope),
    );
    const offCtl = subscribeTopic(channel, name, 'ctl', (raw, from) => {
      const m = raw as { type: string };
      if (m.type === 'request') setRequests((r) => (r.includes(from) ? r : [...r, from]));
      if (m.type === 'stop') setController((c) => (c === from ? null : c));
    });
    return () => {
      offDesk();
      offCtl();
    };
  }, [channel, name]);

  const sendCtl = (to: string, type: string) => channel?.postMessage({ topic: 'ctl', from: name, to: [to], msg: { type } } satisfies Envelope);
  const revoke = React.useCallback(() => {
    setController((c) => {
      if (c) sendCtl(c, 'revoked');
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  if (!annoTransport || !rcTransport) return <div style={pageStyle}>BroadcastChannel unavailable</div>;

  return (
    <div style={pageStyle}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <strong>Presenter · {name}</strong>
        <span style={{ opacity: 0.6, fontSize: 13 }}>The panel below is this person’s real screen, with the desktop app’s overlay and control bar on it.</span>
        {requests.map((r) => (
          <span key={r} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            {r} asks for control
            <button
              style={btn(true)}
              onClick={() => {
                setRequests((x) => x.filter((y) => y !== r));
                setController(r);
                sendCtl(r, 'approved');
              }}
            >
              Approve
            </button>
          </span>
        ))}
      </div>
      <div style={{ position: 'relative', width: '100%', maxWidth: 1200, aspectRatio: `${SCREEN_W} / ${SCREEN_H}` }}>
        <canvas ref={canvasRef} width={SCREEN_W} height={SCREEN_H} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        <BridgedFrame title="Annotation overlay" src="/overlay.html" global="electronAPI" bridge={overlayBridge} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
        {barState && (
          <BridgedFrame
            title="Remote control bar"
            src="/dev/share/rc-bar"
            global="rcBar"
            bridge={barBridge}
            style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', width: 460, height: 52 }}
          />
        )}
      </div>
      {/* The meeting page's own layers: bridge-only annotation (answers late joiners), RC presenter (banner + input) */}
      <AnnotationLayer isDrawingMode={false} bridgeOnly forwardToOverlay transport={annoTransport} />
      <RemoteControlLayer isActive={false} isPresenter controllerIdentity={controller} onPresenterStop={revoke} transport={rcTransport} />
    </div>
  );
}

function ViewerView({ name, layout, stageWidth }: { name: string; layout: 'side' | 'bottom'; stageWidth: number }) {
  const channel = useChannel();
  const annoTransport = useAnnoTransport(channel, name, false);
  const rcTransport = useRcTransport(channel, name);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const deskCanvas = React.useMemo(() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = SCREEN_W;
    c.height = SCREEN_H;
    return c;
  }, []);
  const [drawing, setDrawing] = React.useState(false);
  const [rc, setRc] = React.useState<'off' | 'pending' | 'on'>('off');
  const [presenter, setPresenter] = React.useState<string | null>(null);

  // The share "video": the presenter's desktop state rendered locally and captured as a stream.
  React.useEffect(() => {
    if (!channel || !deskCanvas) return;
    const ctx = deskCanvas.getContext('2d')!;
    drawDesk(ctx, INITIAL_DESK);
    let last = INITIAL_DESK;
    const stream = deskCanvas.captureStream(30);
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => {});
    }
    const off = subscribeTopic(channel, name, 'desk', (raw, from) => {
      last = raw as Desk;
      setPresenter(from);
      drawDesk(ctx, last);
    });
    const tick = setInterval(() => drawDesk(ctx, last), 100);
    channel.postMessage({ topic: 'desk-req', from: name, msg: null } satisfies Envelope);
    const offCtl = subscribeTopic(channel, name, 'ctl', (raw) => {
      const m = raw as { type: string };
      if (m.type === 'approved') setRc('on');
      if (m.type === 'revoked') setRc('off');
    });
    return () => {
      off();
      offCtl();
      clearInterval(tick);
    };
  }, [channel, deskCanvas, name]);

  const getShareVideo = React.useCallback(() => videoRef.current, []);
  if (!annoTransport || !rcTransport) return <div style={pageStyle}>BroadcastChannel unavailable</div>;

  const toggleRc = () => {
    if (rc === 'off') {
      setRc('pending');
      setDrawing(false);
      channel?.postMessage({ topic: 'ctl', from: name, msg: { type: 'request' } } satisfies Envelope);
    } else {
      setRc('off');
      channel?.postMessage({ topic: 'ctl', from: name, msg: { type: 'stop' } } satisfies Envelope);
    }
  };

  const tiles = ['Ying', 'Mark', name].map((n) => (
    <div key={n} style={{ flex: '0 0 auto', width: layout === 'side' ? '100%' : 140, aspectRatio: '16 / 10', borderRadius: 10, background: '#272a33', display: 'grid', placeItems: 'center', fontSize: 13, color: '#cbd5e1' }}>
      {n}
    </div>
  ));

  return (
    <div style={pageStyle}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <strong>Viewer · {name}</strong>
        <button style={btn(drawing)} onClick={() => { setDrawing((d) => !d); if (rc === 'on') toggleRc(); }}>
          {drawing ? 'Stop annotating' : 'Annotate'}
        </button>
        <button style={btn(rc === 'on')} onClick={toggleRc}>
          {rc === 'off' ? 'Request control' : rc === 'pending' ? 'Waiting… (cancel)' : 'Stop control'}
        </button>
        <span style={{ opacity: 0.6, fontSize: 13 }}>{presenter ? `Watching ${presenter}’s screen` : 'Waiting for the presenter window…'}</span>
      </div>
      {/* Like the room: the overlay covers the whole stage (share + camera strip) */}
      <div
        style={{
          position: 'relative',
          width: stageWidth ? stageWidth : '100%',
          height: layout === 'side' ? 'calc(100vh - 80px)' : Math.round((stageWidth || 800) * 1.05),
          display: 'flex',
          flexDirection: layout === 'side' ? 'row' : 'column',
          gap: 10,
          background: '#16181d',
          borderRadius: 12,
          padding: 10,
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        <div data-lk-source="screen_share" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
          <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', borderRadius: 8 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: layout === 'side' ? 'column' : 'row', gap: 8, width: layout === 'side' ? 200 : 'auto' }}>{tiles}</div>
        <AnnotationLayer isDrawingMode={drawing} transport={annoTransport} getShareVideo={getShareVideo} />
        <RemoteControlLayer
          isActive={rc === 'on'}
          isPresenter={false}
          onStopControl={toggleRc}
          transport={rcTransport}
          getShareVideo={getShareVideo}
        />
      </div>
    </div>
  );
}
