/**
 * Shared-screen annotation: the wire protocol and the stroke list every participant keeps.
 *
 * Points are 0–1 positions within the shared picture (see shareContentRect.ts), so a stroke
 * lands on the same spot for everyone. Each stroke belongs to one sender and is drawn as its
 * own path, so two people drawing at once don't join each other's lines. Points travel in
 * small batches ("seg") instead of one reliable message per pointer move, and a participant
 * who arrives mid-share asks the presenter for the strokes already on screen ("sync-req").
 */

export const ANNOTATION_TOPIC = 'annotations-v2';

/** Line widths are in pixels at this content width and scale with the shared picture. */
export const REFERENCE_CONTENT_WIDTH = 1280;

/** A stroke as it travels in a sync reply. */
export type WireStroke = {
  /** Sender identity */
  f: string;
  /** Sender-local stroke number */
  id: number;
  c: string;
  w: number;
  /** Flat [x0, y0, x1, y1, …] */
  p: number[];
  /** Finished */
  d?: 1;
};

export type AnnotationMsg =
  /** Points `i`… of the sender's stroke `id`; `s` = first batch, `e` = stroke finished */
  | { t: 'seg'; id: number; c: string; w: number; i: number; p: number[]; s?: 1; e?: 1 }
  | { t: 'clear' }
  | { t: 'sync-req' }
  /** Reply to a sync request; large lists arrive in several parts */
  | { t: 'sync'; strokes: WireStroke[]; part: number; parts: number };

export type Stroke = {
  key: string;
  from: string;
  id: number;
  color: string;
  width: number;
  /** Index of pts[0..1] within the sender's stroke (non-zero when we joined mid-stroke) */
  base: number;
  pts: number[];
  done: boolean;
};

const MAX_POINTS_PER_STROKE = 20_000;
const MAX_STROKES = 2_000;
const COLOR_RE = /^#[0-9a-f]{3,8}$/i;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isUnit = (v: unknown) => isNum(v) && v >= 0 && v <= 1;
const isPointList = (p: unknown): p is number[] =>
  Array.isArray(p) && p.length % 2 === 0 && p.length <= 4_000 && p.every(isUnit);
const isStrokeId = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 0;
const isWidth = (v: unknown): v is number => isNum(v) && v > 0 && v <= 64;

/** Validate a decoded message; anything malformed or out of range is dropped. */
export function parseAnnotationMsg(raw: unknown): AnnotationMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'clear':
      return { t: 'clear' };
    case 'sync-req':
      return { t: 'sync-req' };
    case 'seg': {
      if (!isStrokeId(m.id) || typeof m.c !== 'string' || !COLOR_RE.test(m.c) || !isWidth(m.w)) return null;
      if (!isNum(m.i) || !Number.isInteger(m.i) || m.i < 0 || !isPointList(m.p)) return null;
      const seg: AnnotationMsg = { t: 'seg', id: m.id, c: m.c, w: m.w, i: m.i, p: m.p };
      if (m.s) seg.s = 1;
      if (m.e) seg.e = 1;
      return seg;
    }
    case 'sync': {
      if (!Array.isArray(m.strokes) || !isNum(m.part) || !isNum(m.parts)) return null;
      const strokes: WireStroke[] = [];
      for (const s of m.strokes as Record<string, unknown>[]) {
        if (!s || typeof s.f !== 'string' || !isStrokeId(s.id)) continue;
        if (typeof s.c !== 'string' || !COLOR_RE.test(s.c) || !isWidth(s.w)) continue;
        if (!Array.isArray(s.p) || s.p.length % 2 !== 0 || !s.p.every(isUnit)) continue;
        strokes.push({ f: s.f, id: s.id, c: s.c, w: s.w, p: s.p as number[], ...(s.d ? { d: 1 as const } : {}) });
      }
      return { t: 'sync', strokes, part: m.part, parts: m.parts };
    }
    default:
      return null;
  }
}

export const strokeKey = (from: string, id: number) => `${from}\u0000${id}`;

/** What a model change needs redrawn. */
export type ModelChange =
  | { kind: 'append'; stroke: Stroke; fromPoint: number }
  | { kind: 'reset' }
  | { kind: 'none' };

/** The strokes on screen, in drawing order. */
export class AnnotationModel {
  private strokes = new Map<string, Stroke>();

  list(): Stroke[] {
    return Array.from(this.strokes.values());
  }

  get size() {
    return this.strokes.size;
  }

  /**
   * Add a batch of points from `from`. Points are placed by their index, so a batch that
   * repeats points we already have (e.g. after a sync) is not drawn twice.
   */
  applySeg(from: string, seg: Extract<AnnotationMsg, { t: 'seg' }>): ModelChange {
    const key = strokeKey(from, seg.id);
    let stroke = this.strokes.get(key);
    if (!stroke) {
      if (this.strokes.size >= MAX_STROKES) return { kind: 'none' };
      stroke = { key, from, id: seg.id, color: seg.c, width: seg.w, base: seg.i, pts: [], done: false };
      this.strokes.set(key, stroke);
    }
    const have = stroke.base + stroke.pts.length / 2;
    const skip = Math.max(0, have - seg.i);
    const fresh = seg.p.slice(skip * 2);
    const room = MAX_POINTS_PER_STROKE * 2 - stroke.pts.length;
    const added = fresh.slice(0, Math.max(0, room));
    const fromPoint = stroke.pts.length / 2;
    for (const v of added) stroke.pts.push(v);
    if (seg.e) stroke.done = true;
    return added.length ? { kind: 'append', stroke, fromPoint } : { kind: 'none' };
  }

  clear(): ModelChange {
    this.strokes.clear();
    return { kind: 'reset' };
  }

  /** Strokes to send to a late joiner. Only strokes we hold from their first point. */
  snapshot(): WireStroke[] {
    const out: WireStroke[] = [];
    for (const s of this.strokes.values()) {
      if (s.base !== 0 || s.pts.length === 0) continue;
      out.push({ f: s.from, id: s.id, c: s.color, w: s.width, p: s.pts.slice(), ...(s.done ? { d: 1 as const } : {}) });
    }
    return out;
  }

  /**
   * Merge a sync reply. Strokes we already hold from point 0 are kept; strokes we only saw
   * the tail of get their beginning filled in. Synced strokes go before live ones so the
   * stacking order matches the presenter's.
   */
  mergeSync(strokes: WireStroke[]): ModelChange {
    if (!strokes.length) return { kind: 'none' };
    const merged = new Map<string, Stroke>();
    for (const w of strokes) {
      const key = strokeKey(w.f, w.id);
      const local = this.strokes.get(key);
      let pts = w.p.slice(0, MAX_POINTS_PER_STROKE * 2);
      let done = !!w.d;
      if (local) {
        if (local.base === 0 && local.pts.length >= pts.length) {
          pts = local.pts;
        } else {
          const syncedCount = pts.length / 2;
          const tailFrom = Math.max(0, syncedCount - local.base);
          pts = pts.concat(local.pts.slice(tailFrom * 2));
        }
        done = done || local.done;
      }
      merged.set(key, { key, from: w.f, id: w.id, color: w.c, width: w.w, base: 0, pts, done });
    }
    for (const [key, s] of this.strokes) if (!merged.has(key)) merged.set(key, s);
    this.strokes = merged;
    return { kind: 'reset' };
  }
}

/** Split a snapshot into sync messages that each stay under `maxBytes` of JSON. */
export function chunkSnapshot(strokes: WireStroke[], maxBytes = 12_000): AnnotationMsg[] {
  const groups: WireStroke[][] = [];
  let cur: WireStroke[] = [];
  let size = 0;
  const pushPiece = (s: WireStroke) => {
    const len = JSON.stringify(s).length + 1;
    if (cur.length && size + len > maxBytes) {
      groups.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(s);
    size += len;
  };
  for (const s of strokes) {
    // A single long stroke is split into consecutive pieces of the same stroke id.
    if (JSON.stringify(s).length + 64 <= maxBytes) {
      pushPiece(s);
      continue;
    }
    const budget = maxBytes - 64 - JSON.stringify({ ...s, p: [] }).length;
    let piece: number[] = [];
    let len = 0;
    for (let k = 0; k < s.p.length; k += 2) {
      const add = String(s.p[k]).length + String(s.p[k + 1]).length + 2;
      if (piece.length && len + add > budget) {
        pushPiece({ f: s.f, id: s.id, c: s.c, w: s.w, p: piece });
        piece = [];
        len = 0;
      }
      piece.push(s.p[k], s.p[k + 1]);
      len += add;
    }
    if (piece.length) pushPiece({ f: s.f, id: s.id, c: s.c, w: s.w, p: piece, ...(s.d ? { d: 1 as const } : {}) });
  }
  if (cur.length) groups.push(cur);
  if (!groups.length) groups.push([]);
  return groups.map((g, i) => ({ t: 'sync', strokes: g, part: i, parts: groups.length }));
}

/**
 * Reassemble the parts of one sync reply (pieces of a long stroke come in order) into a
 * stroke list ready for {@link AnnotationModel.mergeSync}. Returns null until every part is in.
 */
export class SyncAssembler {
  private parts: (WireStroke[] | undefined)[] = [];
  private total = 0;

  add(msg: Extract<AnnotationMsg, { t: 'sync' }>): WireStroke[] | null {
    if (msg.parts < 1 || msg.parts > 500 || msg.part < 0 || msg.part >= msg.parts) return null;
    if (this.total !== msg.parts) {
      this.parts = [];
      this.total = msg.parts;
    }
    this.parts[msg.part] = msg.strokes;
    for (let i = 0; i < this.total; i++) if (!this.parts[i]) return null;
    const joined = new Map<string, WireStroke>();
    for (const part of this.parts) {
      for (const s of part!) {
        const key = strokeKey(s.f, s.id);
        const prev = joined.get(key);
        if (prev) {
          prev.p = prev.p.concat(s.p);
          if (s.d) prev.d = 1;
        } else {
          joined.set(key, { ...s, p: s.p.slice() });
        }
      }
    }
    this.parts = [];
    this.total = 0;
    return Array.from(joined.values());
  }
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/**
 * Collects one local stroke's points and sends them in batches of `intervalMs` instead of
 * one message per pointer move. Points closer than `minStep` to the previous one are dropped.
 */
export class StrokeBatcher {
  private pending: number[] = [];
  private sentCount = 0;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastX = -1;
  private lastY = -1;

  constructor(
    private readonly id: number,
    private readonly color: string,
    private readonly width: number,
    private readonly send: (seg: Extract<AnnotationMsg, { t: 'seg' }>) => void,
    private readonly intervalMs = 40,
    private readonly minStep = 0.0015,
    // Wrapped: browsers throw "Illegal invocation" when setTimeout is called as a method of another object.
    private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) => setTimeout(fn, ms),
    private readonly cancel: (t: ReturnType<typeof setTimeout>) => void = (t) => clearTimeout(t),
  ) {}

  /** Returns the rounded point when it was kept, null when it was too close to the last one. */
  add(x: number, y: number, force = false): [number, number] | null {
    const rx = round4(x);
    const ry = round4(y);
    if (!force && this.lastX >= 0 && Math.hypot(rx - this.lastX, ry - this.lastY) < this.minStep) return null;
    this.lastX = rx;
    this.lastY = ry;
    this.pending.push(rx, ry);
    // Receivers drop batches over 2,000 points; flush well before that if the timer is late.
    if (!this.started || this.pending.length >= 1_000) {
      this.flush();
    } else if (this.timer === null) {
      this.timer = this.schedule(() => this.flush(), this.intervalMs);
    }
    return [rx, ry];
  }

  flush(end = false) {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    if (!this.pending.length && !end) return;
    const seg: Extract<AnnotationMsg, { t: 'seg' }> = {
      t: 'seg',
      id: this.id,
      c: this.color,
      w: this.width,
      i: this.sentCount,
      p: this.pending,
    };
    if (!this.started) seg.s = 1;
    if (end) seg.e = 1;
    this.started = true;
    this.sentCount += this.pending.length / 2;
    this.pending = [];
    this.send(seg);
  }

  end() {
    this.flush(true);
  }
}
