/**
 * Design mode sync: messages between the meeting and a design page running
 * public/design-sync.js (postMessage), and between participants (data channel).
 * Positions are document pixels of the design page, which lays out the same for everyone
 * (same frame size and zoom), so they mean the same spot on every screen.
 */

import { parseDesignViewport, type DesignViewport } from '@/lib/designLink';

/* ── Page ↔ meeting (postMessage) ── */

export interface DesignPageState {
  href: string;
  title: string;
  scrollX: number;
  scrollY: number;
  docWidth: number;
  docHeight: number;
  viewWidth: number;
  viewHeight: number;
}

export type DesignPageMessage =
  | ({ type: 'hello' | 'size' } & DesignPageState)
  | { type: 'scroll'; href: string; scrollX: number; scrollY: number };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Parse a message from the design page; null if it isn't one. */
export function parseDesignPageMessage(data: unknown): DesignPageMessage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.source !== 'kloud-design' || typeof d.href !== 'string') return null;
  const scrollX = num(d.scrollX);
  const scrollY = num(d.scrollY);
  if (scrollX === null || scrollY === null) return null;
  if (d.type === 'scroll') return { type: 'scroll', href: d.href, scrollX, scrollY };
  if (d.type !== 'hello' && d.type !== 'size') return null;
  const docWidth = num(d.docWidth);
  const docHeight = num(d.docHeight);
  const viewWidth = num(d.viewWidth);
  const viewHeight = num(d.viewHeight);
  if (docWidth === null || docHeight === null || viewWidth === null || viewHeight === null) return null;
  return {
    type: d.type,
    href: d.href,
    title: typeof d.title === 'string' ? d.title.slice(0, 200) : '',
    scrollX,
    scrollY,
    docWidth,
    docHeight,
    viewWidth,
    viewHeight,
  };
}

/** A page inside the design may only be a page of the same site as the link. */
export function isSameSiteHref(href: string, linkUrl: string): boolean {
  try {
    return new URL(href).origin === new URL(linkUrl).origin;
  } catch {
    return false;
  }
}

/** Pages are told apart by path + query (not #hash, which is a scroll position). */
export function designPageKey(href: string): string {
  try {
    const url = new URL(href);
    return url.origin + url.pathname + url.search;
  } catch {
    return href;
  }
}

/* ── Participant ↔ participant (data channel, topic DESIGN_TOPIC) ── */

export const DESIGN_TOPIC = 'kloud-design';
export const DESIGN_STROKE_COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff'] as const;

export interface DesignScroll {
  href: string;
  x: number;
  y: number;
}

export interface DesignStroke {
  id: string;
  /** Page key (designPageKey) the stroke belongs to */
  page: string;
  by: string;
  color: string;
  /** Flat [x0, y0, x1, y1, …] in document pixels */
  points: number[];
}

export interface DesignLaser {
  page: string;
  x: number;
  y: number;
  name: string;
  at: number;
}

export type DesignSyncMessage =
  | { type: 'viewport'; viewport: DesignViewport }
  | { type: 'scroll'; scroll: DesignScroll }
  | { type: 'stroke'; id: string; page: string; color: string; points: number[]; start?: boolean }
  | { type: 'clear'; page: string }
  | { type: 'laser'; page: string; x: number; y: number; name: string }
  | { type: 'laserOff' }
  /**
   * Someone just opened the stage (joined late, reconnected): ask for the drawings so far.
   * `driver`: the asker drives the stage (so the driver can't answer); `again`: an earlier ask
   * went unanswered. Either way the others who can draw answer too.
   */
  | { type: 'hello'; req: string; driver?: true; again?: true }
  /** Answer to hello: every drawing for this link, in parts; `req` is the hello's, or '*' for several */
  | { type: 'replay'; req: string; part: number; last: boolean; strokes: DesignReplayStroke[] };

/** A stroke (or, with cont, the next piece of the previous one) inside a replay message */
export interface DesignReplayStroke {
  /** Stroke key as everyone stores it (author identity + ':' + the author's id) */
  id: string;
  by: string;
  page: string;
  color: string;
  points: number[];
  cont?: boolean;
}

const MAX_POINTS_PER_MESSAGE = 400;
/** A replay message stays well under the data channel's reliable message size */
const REPLAY_MESSAGE_CHARS = 12_000;
/** Replays keep the newest drawings up to this many coordinates (x and y each count) */
export const MAX_REPLAY_NUMBERS = 60_000;
const MAX_REPLAY_PARTS = 400;

const isPoints = (v: unknown, max: number): v is number[] =>
  Array.isArray(v) && v.length <= max && v.length % 2 === 0 && v.every((p) => typeof p === 'number' && Number.isFinite(p));

function parseReplayStroke(value: unknown): DesignReplayStroke | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Record<string, unknown>;
  if (typeof s.id !== 'string' || !s.id || s.id.length > 300) return null;
  if (typeof s.by !== 'string' || s.by.length > 200 || typeof s.page !== 'string' || s.page.length > 2100) return null;
  if (typeof s.color !== 'string' || !(DESIGN_STROKE_COLORS as readonly string[]).includes(s.color)) return null;
  if (!isPoints(s.points, MAX_POINTS_PER_MESSAGE * 2)) return null;
  return { id: s.id, by: s.by, page: s.page, color: s.color, points: s.points, ...(s.cont ? { cont: true } : {}) };
}

/** Parse a data-channel message on DESIGN_TOPIC; null if invalid. */
export function parseDesignSyncMessage(data: unknown): DesignSyncMessage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  switch (d.type) {
    case 'viewport': {
      const viewport = parseDesignViewport(d.viewport);
      return viewport ? { type: 'viewport', viewport } : null;
    }
    case 'scroll': {
      const s = d.scroll as Record<string, unknown> | undefined;
      const x = num(s?.x);
      const y = num(s?.y);
      if (!s || typeof s.href !== 'string' || s.href.length > 2048 || x === null || y === null) return null;
      return { type: 'scroll', scroll: { href: s.href, x: Math.max(0, x), y: Math.max(0, y) } };
    }
    case 'stroke': {
      if (typeof d.id !== 'string' || d.id.length > 64 || typeof d.page !== 'string' || typeof d.color !== 'string') return null;
      if (!isPoints(d.points, MAX_POINTS_PER_MESSAGE * 2)) return null;
      if (!(DESIGN_STROKE_COLORS as readonly string[]).includes(d.color)) return null;
      return { type: 'stroke', id: d.id, page: d.page, color: d.color, points: d.points as number[], ...(d.start ? { start: true } : {}) };
    }
    case 'clear':
      return typeof d.page === 'string' ? { type: 'clear', page: d.page } : null;
    case 'laser': {
      const x = num(d.x);
      const y = num(d.y);
      if (typeof d.page !== 'string' || x === null || y === null) return null;
      return { type: 'laser', page: d.page, x, y, name: typeof d.name === 'string' ? d.name.slice(0, 60) : '' };
    }
    case 'laserOff':
      return { type: 'laserOff' };
    case 'hello':
      if (typeof d.req !== 'string' || !d.req || d.req.length > 40) return null;
      return { type: 'hello', req: d.req, ...(d.driver === true ? { driver: true } : {}), ...(d.again === true ? { again: true } : {}) };
    case 'replay': {
      if (typeof d.req !== 'string' || !d.req || d.req.length > 40) return null;
      if (typeof d.part !== 'number' || !Number.isInteger(d.part) || d.part < 0 || d.part >= MAX_REPLAY_PARTS) return null;
      if (!Array.isArray(d.strokes) || d.strokes.length > MAX_POINTS_PER_MESSAGE) return null;
      const strokes = d.strokes.map(parseReplayStroke);
      if (strokes.some((s) => s === null)) return null;
      const list = strokes as DesignReplayStroke[];
      if (list.reduce((n, s) => n + s.points.length, 0) > MAX_POINTS_PER_MESSAGE * 2) return null;
      return { type: 'replay', req: d.req, part: d.part, last: d.last === true, strokes: list };
    }
    default:
      return null;
  }
}

/** Split a long stroke into data-channel sized chunks (the first carries start=true). */
export function chunkStrokePoints(points: number[]): number[][] {
  const size = MAX_POINTS_PER_MESSAGE * 2;
  const chunks: number[][] = [];
  for (let i = 0; i < points.length; i += size) chunks.push(points.slice(i, i + size));
  return chunks;
}

/** Hellos arriving together (everyone opening the stage at once) wait this long for one answer */
const HELLO_ANSWER_MS = 250;
/** Others who can draw answer a little later, so the driver's answer usually comes first */
const HELLO_BACKUP_ANSWER_MS = 700;

/**
 * Should this participant answer a hello, and after how long (ms)? null = stay quiet.
 * Only people who can draw hold drawings others accept. The driver answers first; the others
 * only when the driver can't (the asker is the driver, or the driver didn't answer the first ask),
 * so one hello normally gets one answer.
 */
export function helloAnswerDelay(
  hello: { driver?: boolean; again?: boolean },
  me: { canDraw: boolean; isDriver: boolean; hasStrokes: boolean },
): number | null {
  if (!me.canDraw) return null;
  if (me.isDriver) return HELLO_ANSWER_MS;
  if (!me.hasStrokes || !(hello.driver || hello.again)) return null;
  return HELLO_BACKUP_ANSWER_MS;
}

/**
 * Everything drawn so far, as replay messages for someone who just arrived. Long strokes are
 * split (the pieces after the first carry cont), each message stays small, and when there is
 * more than MAX_REPLAY_NUMBERS the oldest strokes are left out. Always at least one message, so
 * an empty answer still says "nothing drawn".
 */
export function buildReplayMessages(
  strokes: DesignStroke[],
  req: string,
): Extract<DesignSyncMessage, { type: 'replay' }>[] {
  // Newest strokes first until the budget runs out, then back in drawing order.
  const kept: DesignStroke[] = [];
  let budget = MAX_REPLAY_NUMBERS;
  for (let i = strokes.length - 1; i >= 0; i -= 1) {
    const n = strokes[i].points.length;
    if (n === 0) continue;
    if (n > budget) break;
    budget -= n;
    kept.unshift(strokes[i]);
  }

  const size = MAX_POINTS_PER_MESSAGE * 2;
  const messages: Extract<DesignSyncMessage, { type: 'replay' }>[] = [];
  let current: DesignReplayStroke[] = [];
  let numbers = 0;
  let chars = 0;
  const push = () => {
    messages.push({ type: 'replay', req, part: messages.length, last: false, strokes: current });
    current = [];
    numbers = 0;
    chars = 0;
  };
  for (const stroke of kept) {
    for (let i = 0; i < stroke.points.length; i += size) {
      const piece: DesignReplayStroke = {
        id: stroke.id,
        by: stroke.by,
        page: stroke.page,
        color: stroke.color,
        points: stroke.points.slice(i, i + size),
        ...(i > 0 ? { cont: true } : {}),
      };
      const cost = JSON.stringify(piece).length;
      if (current.length > 0 && (numbers + piece.points.length > size || chars + cost > REPLAY_MESSAGE_CHARS)) push();
      current.push(piece);
      numbers += piece.points.length;
      chars += cost;
    }
  }
  if (current.length > 0 || messages.length === 0) push();
  messages[messages.length - 1].last = true;
  return messages;
}

/** Put the pieces of a replay back together (parts in the order they were sent). */
export function assembleReplay(parts: DesignReplayStroke[][]): DesignStroke[] {
  const strokes: DesignStroke[] = [];
  const byId = new Map<string, DesignStroke>();
  for (const part of parts) {
    for (const piece of part) {
      const existing = byId.get(piece.id);
      if (piece.cont && existing) {
        existing.points = existing.points.concat(piece.points);
        continue;
      }
      if (piece.cont) continue; // the start of this stroke was cut off: skip the rest of it
      const stroke: DesignStroke = { id: piece.id, page: piece.page, by: piece.by, color: piece.color, points: piece.points.slice() };
      if (existing) strokes.splice(strokes.indexOf(existing), 1);
      byId.set(piece.id, stroke);
      strokes.push(stroke);
    }
  }
  return strokes;
}

/**
 * Apply a replay to what this screen already shows. The replay is the truth for everything up
 * to when it was asked for (drawings cleared meanwhile disappear); strokes that started after
 * that are kept. A stroke in both keeps the longer copy — both are the same line, one just
 * has more of it.
 */
export function mergeReplay(
  current: DesignStroke[],
  replay: DesignStroke[],
  keptSinceRequest: (stroke: DesignStroke) => boolean,
): DesignStroke[] {
  const currentById = new Map(current.map((s) => [s.id, s]));
  const replayIds = new Set(replay.map((s) => s.id));
  const merged = replay.map((s) => {
    const mine = currentById.get(s.id);
    return mine && mine.points.length > s.points.length ? mine : s;
  });
  return merged.concat(current.filter((s) => !replayIds.has(s.id) && keptSinceRequest(s)));
}

/** Screen position inside the frame box → document position of the design page. */
export function toDocPoint(
  local: { x: number; y: number },
  scroll: { x: number; y: number },
  scale: number,
): { x: number; y: number } {
  return { x: Math.round(scroll.x + local.x / scale), y: Math.round(scroll.y + local.y / scale) };
}
