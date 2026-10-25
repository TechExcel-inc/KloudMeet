'use client';

import React from 'react';
import type { DesignViewport } from '@/lib/designLink';
import {
  chunkStrokePoints,
  type DesignLaser,
  type DesignScroll,
  type DesignStroke,
  type DesignSyncMessage,
} from '@/lib/designSync';

/** How Design mode messages travel: LiveKit data channel in a meeting, BroadcastChannel in /dev/tiles. */
export interface DesignSyncTransport {
  send: (msg: DesignSyncMessage, opts?: { lossy?: boolean }) => void;
  subscribe: (handler: (msg: DesignSyncMessage, sender: { identity: string; name: string }) => void) => () => void;
}

const VIEWPORT_THROTTLE_MS = 200;
const SCROLL_THROTTLE_MS = 100;
const STROKE_FLUSH_MS = 60;
const LASER_THROTTLE_MS = 40;
const LASER_TTL_MS = 1500;
const HEARTBEAT_MS = 3000;

function useThrottled<T>(send: (value: T) => void, ms: number) {
  const latest = React.useRef<T | null>(null);
  const timer = React.useRef<number | null>(null);
  const lastAt = React.useRef(0);
  const sendRef = React.useRef(send);
  sendRef.current = send;
  const fire = React.useCallback(() => {
    timer.current = null;
    if (latest.current === null) return;
    lastAt.current = Date.now();
    sendRef.current(latest.current);
  }, []);
  const push = React.useCallback(
    (value: T) => {
      latest.current = value;
      if (timer.current !== null) return;
      timer.current = window.setTimeout(fire, Math.max(0, ms - (Date.now() - lastAt.current)));
    },
    [fire, ms],
  );
  React.useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  return { push, latest, resend: fire };
}

/**
 * Design mode sync between participants: the driver's frame size, zoom and scroll position,
 * plus annotations and laser pointers. Only messages from people allowed to switch the stage
 * are applied.
 */
export function useDesignSync({
  transport,
  active,
  linkUrl,
  isDriver,
  isAllowedSender,
  localIdentity,
  localName,
}: {
  transport: DesignSyncTransport | null;
  active: boolean;
  /** Everything resets when the link changes */
  linkUrl: string | null;
  isDriver: boolean;
  isAllowedSender: (identity: string) => boolean;
  localIdentity: string;
  localName: string;
}) {
  const [remoteViewport, setRemoteViewport] = React.useState<DesignViewport | null>(null);
  const [remoteScroll, setRemoteScroll] = React.useState<DesignScroll | null>(null);
  const [strokes, setStrokes] = React.useState<DesignStroke[]>([]);
  const [lasers, setLasers] = React.useState<Record<string, DesignLaser>>({});

  const allowedRef = React.useRef(isAllowedSender);
  allowedRef.current = isAllowedSender;

  React.useEffect(() => {
    setRemoteViewport(null);
    setRemoteScroll(null);
    setStrokes([]);
    setLasers({});
  }, [linkUrl]);

  React.useEffect(() => {
    if (!transport) return;
    return transport.subscribe((msg, sender) => {
      if (!sender.identity || sender.identity === localIdentity || !allowedRef.current(sender.identity)) return;
      switch (msg.type) {
        case 'viewport':
          setRemoteViewport(msg.viewport);
          break;
        case 'scroll':
          setRemoteScroll(msg.scroll);
          break;
        case 'stroke': {
          const id = `${sender.identity}:${msg.id}`;
          setStrokes((prev) => {
            const index = prev.findIndex((s) => s.id === id);
            if (index < 0 || msg.start) {
              const rest = index < 0 ? prev : prev.filter((s) => s.id !== id);
              return [...rest, { id, page: msg.page, by: sender.identity, color: msg.color, points: msg.points }];
            }
            const next = prev.slice();
            next[index] = { ...next[index], points: next[index].points.concat(msg.points) };
            return next;
          });
          break;
        }
        case 'clear':
          setStrokes((prev) => prev.filter((s) => s.page !== msg.page));
          break;
        case 'laser':
          setLasers((prev) => ({
            ...prev,
            [sender.identity]: { page: msg.page, x: msg.x, y: msg.y, name: msg.name || sender.name, at: Date.now() },
          }));
          break;
        case 'laserOff':
          setLasers((prev) => {
            if (!prev[sender.identity]) return prev;
            const next = { ...prev };
            delete next[sender.identity];
            return next;
          });
          break;
      }
    });
  }, [transport, localIdentity]);

  // Lasers fade when their owner stops moving them.
  React.useEffect(() => {
    if (Object.keys(lasers).length === 0) return;
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - LASER_TTL_MS;
      setLasers((prev) => {
        const entries = Object.entries(prev).filter(([, l]) => l.at >= cutoff);
        return entries.length === Object.keys(prev).length ? prev : Object.fromEntries(entries);
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [lasers]);

  /* ── Driver: viewport and scroll ── */
  const send = React.useCallback(
    (msg: DesignSyncMessage, opts?: { lossy?: boolean }) => {
      if (transport && active) transport.send(msg, opts);
    },
    [transport, active],
  );
  const viewport = useThrottled<DesignViewport>((v) => send({ type: 'viewport', viewport: v }), VIEWPORT_THROTTLE_MS);
  const scroll = useThrottled<DesignScroll>((s) => send({ type: 'scroll', scroll: s }), SCROLL_THROTTLE_MS);

  const reportViewport = React.useCallback(
    (v: DesignViewport) => {
      if (isDriver) viewport.push(v);
    },
    [isDriver, viewport],
  );
  const reportScroll = React.useCallback(
    (s: DesignScroll) => {
      if (isDriver) scroll.push(s);
    },
    [isDriver, scroll],
  );

  // Repeat the driver's state so late joiners (and lost packets) catch up.
  React.useEffect(() => {
    if (!active || !isDriver) return;
    const timer = window.setInterval(() => {
      if (viewport.latest.current) send({ type: 'viewport', viewport: viewport.latest.current });
      if (scroll.latest.current) send({ type: 'scroll', scroll: scroll.latest.current });
    }, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [active, isDriver, send, viewport.latest, scroll.latest]);

  /* ── Annotations ── */
  const strokeSeq = React.useRef(0);
  const pendingPoints = React.useRef<Record<string, { page: string; color: string; points: number[]; started: boolean }>>({});
  const flushTimer = React.useRef<number | null>(null);

  const flushStrokes = React.useCallback(() => {
    flushTimer.current = null;
    for (const [id, pending] of Object.entries(pendingPoints.current)) {
      if (pending.points.length === 0) continue;
      chunkStrokePoints(pending.points).forEach((points, i) => {
        send({ type: 'stroke', id, page: pending.page, color: pending.color, points, ...(!pending.started && i === 0 ? { start: true } : {}) });
      });
      pending.started = true;
      pending.points = [];
    }
  }, [send]);

  const beginStroke = React.useCallback(
    (page: string, color: string, x: number, y: number): string => {
      strokeSeq.current += 1;
      const id = `${Date.now().toString(36)}${strokeSeq.current}`;
      const key = `${localIdentity}:${id}`;
      setStrokes((prev) => [...prev, { id: key, page, by: localIdentity, color, points: [x, y] }]);
      pendingPoints.current[id] = { page, color, points: [x, y], started: false };
      if (flushTimer.current === null) flushTimer.current = window.setTimeout(flushStrokes, STROKE_FLUSH_MS);
      return id;
    },
    [localIdentity, flushStrokes],
  );

  const extendStroke = React.useCallback(
    (id: string, x: number, y: number) => {
      const pending = pendingPoints.current[id];
      if (!pending) return;
      const key = `${localIdentity}:${id}`;
      setStrokes((prev) => prev.map((s) => (s.id === key ? { ...s, points: s.points.concat(x, y) } : s)));
      pending.points.push(x, y);
      if (flushTimer.current === null) flushTimer.current = window.setTimeout(flushStrokes, STROKE_FLUSH_MS);
    },
    [localIdentity, flushStrokes],
  );

  const endStroke = React.useCallback(
    (id: string) => {
      flushStrokes();
      delete pendingPoints.current[id];
    },
    [flushStrokes],
  );

  const clearPage = React.useCallback(
    (page: string) => {
      setStrokes((prev) => prev.filter((s) => s.page !== page));
      send({ type: 'clear', page });
    },
    [send],
  );

  /* ── Laser ── */
  const laser = useThrottled<{ page: string; x: number; y: number }>(
    (l) => send({ type: 'laser', page: l.page, x: l.x, y: l.y, name: localName }, { lossy: true }),
    LASER_THROTTLE_MS,
  );
  const moveLaser = React.useCallback(
    (page: string, x: number, y: number) => {
      setLasers((prev) => ({ ...prev, [localIdentity]: { page, x, y, name: localName, at: Date.now() } }));
      laser.push({ page, x, y });
    },
    [laser, localIdentity, localName],
  );
  const hideLaser = React.useCallback(() => {
    setLasers((prev) => {
      if (!prev[localIdentity]) return prev;
      const next = { ...prev };
      delete next[localIdentity];
      return next;
    });
    send({ type: 'laserOff' });
  }, [localIdentity, send]);

  return {
    remoteViewport,
    remoteScroll,
    strokes,
    lasers,
    reportViewport,
    reportScroll,
    beginStroke,
    extendStroke,
    endStroke,
    clearPage,
    moveLaser,
    hideLaser,
  };
}

export type DesignSync = ReturnType<typeof useDesignSync>;
