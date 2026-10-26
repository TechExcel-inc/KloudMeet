'use client';

import React from 'react';
import type { DesignViewport } from '@/lib/designLink';
import {
  assembleReplay,
  buildReplayMessages,
  chunkStrokePoints,
  helloAnswerDelay,
  mergeReplay,
  type DesignLaser,
  type DesignReplayStroke,
  type DesignScroll,
  type DesignStroke,
  type DesignSyncMessage,
} from '@/lib/designSync';

/** How Design mode messages travel: LiveKit data channel in a meeting, BroadcastChannel in /dev/tiles. */
export interface DesignSyncTransport {
  /** `to`: only this participant needs it (others may still receive it and ignore it) */
  send: (msg: DesignSyncMessage, opts?: { lossy?: boolean; to?: string }) => void;
  subscribe: (handler: (msg: DesignSyncMessage, sender: { identity: string; name: string }) => void) => () => void;
  /** Called when the connection comes up, and again after it drops and comes back (messages may have been missed) */
  onConnected?: (handler: () => void) => () => void;
}

const VIEWPORT_THROTTLE_MS = 200;
const SCROLL_THROTTLE_MS = 100;
const STROKE_FLUSH_MS = 60;
const LASER_THROTTLE_MS = 40;
const LASER_TTL_MS = 1500;
const HEARTBEAT_MS = 3000;
/** Ask again when no one answered (the hello or its answer was lost, or no one had joined yet) */
const HELLO_RETRY_MS = 4000;
const HELLO_TRIES = 3;
/** One answer per participant this often, however often they ask */
const REPLY_MIN_INTERVAL_MS = 2000;
/** At most one answer this often in all: hellos arriving meanwhile share the next one */
const REPLY_COOLDOWN_MS = 1000;

const newReq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

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
  const [strokes, setStrokesState] = React.useState<DesignStroke[]>([]);
  const [lasers, setLasers] = React.useState<Record<string, DesignLaser>>({});

  // Strokes live in a ref too, so a replay sent right after a change includes it.
  const strokesRef = React.useRef<DesignStroke[]>([]);
  /** When each stroke first appeared here (a replay keeps strokes newer than its request) */
  const seenAt = React.useRef(new Map<string, number>());
  const setStrokes = React.useCallback((update: (prev: DesignStroke[]) => DesignStroke[]) => {
    const next = update(strokesRef.current);
    if (next === strokesRef.current) return;
    const now = Date.now();
    for (const s of next) if (!seenAt.current.has(s.id)) seenAt.current.set(s.id, now);
    strokesRef.current = next;
    setStrokesState(next);
  }, []);

  const allowedRef = React.useRef(isAllowedSender);
  allowedRef.current = isAllowedSender;
  const stateRef = React.useRef({ active, isDriver, localIdentity });
  stateRef.current = { active, isDriver, localIdentity };

  React.useEffect(() => {
    setRemoteViewport(null);
    setRemoteScroll(null);
    strokesRef.current = [];
    seenAt.current.clear();
    setStrokesState([]);
    setLasers({});
  }, [linkUrl]);

  /* ── Catching up: hello → replay ── */
  /**
   * The current round of asking: every hello sent in it (an answer to any of them will do, even
   * one that arrives after we stopped asking) and when the round began. null once answered.
   */
  const pendingHello = React.useRef<{ reqs: Set<string>; at: number } | null>(null);
  /** Replay parts per sender, until the last one arrives */
  const replayParts = React.useRef(new Map<string, { req: string; parts: DesignReplayStroke[][] }>());
  /** Hellos waiting for one combined answer */
  const helloQueue = React.useRef(new Map<string, string>());
  const replyTimer = React.useRef<number | null>(null);
  const lastReplyAt = React.useRef(0);
  const lastReplyTo = React.useRef(new Map<string, number>());
  const answerHellosRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    if (!transport) return;
    return transport.subscribe((msg, sender) => {
      if (!sender.identity || sender.identity === localIdentity) return;
      // Anyone may ask to catch up; everything else counts only from people who can switch the stage.
      if (msg.type === 'hello') {
        const { active: on, isDriver: driving, localIdentity: me } = stateRef.current;
        if (!on) return;
        const delay = helloAnswerDelay(msg, {
          canDraw: allowedRef.current(me),
          isDriver: driving,
          hasStrokes: strokesRef.current.length > 0,
        });
        if (delay === null) return;
        if (Date.now() - (lastReplyTo.current.get(sender.identity) ?? 0) < REPLY_MIN_INTERVAL_MS) return;
        helloQueue.current.set(sender.identity, msg.req);
        if (replyTimer.current === null) {
          // However many ask at once (everyone opening the stage), one answer at a time
          const wait = Math.max(delay, lastReplyAt.current + REPLY_COOLDOWN_MS - Date.now());
          replyTimer.current = window.setTimeout(() => answerHellosRef.current(), wait);
        }
        return;
      }
      if (!allowedRef.current(sender.identity)) return;
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
        case 'replay': {
          const pending = pendingHello.current;
          if (!pending || (!pending.reqs.has(msg.req) && msg.req !== '*')) return;
          let entry = replayParts.current.get(sender.identity);
          if (msg.part === 0 || !entry || entry.req !== msg.req) {
            entry = { req: msg.req, parts: [] };
            replayParts.current.set(sender.identity, entry);
          }
          if (entry.parts.length !== msg.part) {
            // A part went missing: drop this answer and ask again later
            replayParts.current.delete(sender.identity);
            return;
          }
          entry.parts.push(msg.strokes);
          if (!msg.last) return;
          replayParts.current.clear();
          pendingHello.current = null;
          const replay = assembleReplay(entry.parts);
          setStrokes((prev) => mergeReplay(prev, replay, (s) => (seenAt.current.get(s.id) ?? 0) > pending.at));
          break;
        }
      }
    });
  }, [transport, localIdentity, setStrokes]);

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

  // On opening the stage, and when the connection comes up or back, ask whoever can draw for
  // what's there so far.
  React.useEffect(() => {
    if (!transport || !active || !linkUrl) return;
    let retry: number | null = null;
    const attempt = (tries: number) => {
      const round = pendingHello.current;
      if (!round) return;
      const req = newReq();
      round.reqs.add(req);
      transport.send({
        type: 'hello',
        req,
        ...(stateRef.current.isDriver ? { driver: true } : {}),
        ...(tries > 1 ? { again: true } : {}),
      });
      retry = window.setTimeout(() => {
        retry = null;
        if (pendingHello.current !== round) return; // answered, or a new round began
        // After the last try, stop asking but still take a late answer
        if (tries < HELLO_TRIES) attempt(tries + 1);
      }, HELLO_RETRY_MS);
    };
    const ask = () => {
      if (retry !== null) window.clearTimeout(retry);
      pendingHello.current = { reqs: new Set(), at: Date.now() };
      replayParts.current.clear();
      attempt(1);
    };
    ask();
    const off = transport.onConnected?.(ask);
    return () => {
      off?.();
      if (retry !== null) window.clearTimeout(retry);
      pendingHello.current = null;
    };
  }, [transport, active, linkUrl]);

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

  // Answer the hellos gathered so far: one targeted replay, or one for everyone if several asked.
  answerHellosRef.current = () => {
    replyTimer.current = null;
    const queue = Array.from(helloQueue.current.entries());
    helloQueue.current.clear();
    if (queue.length === 0 || !transport || !active) return;
    flushStrokes(); // so the replay and the live pieces that follow it line up
    const now = Date.now();
    lastReplyAt.current = now;
    for (const [identity] of queue) lastReplyTo.current.set(identity, now);
    const to = queue.length === 1 ? queue[0][0] : undefined;
    const req = queue.length === 1 ? queue[0][1] : '*';
    if (isDriver) {
      if (viewport.latest.current) transport.send({ type: 'viewport', viewport: viewport.latest.current }, { to });
      if (scroll.latest.current) transport.send({ type: 'scroll', scroll: scroll.latest.current }, { to });
    }
    for (const msg of buildReplayMessages(strokesRef.current, req)) transport.send(msg, { to });
  };
  React.useEffect(
    () => () => {
      if (replyTimer.current !== null) window.clearTimeout(replyTimer.current);
    },
    [],
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
