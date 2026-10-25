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
  | { type: 'laserOff' };

const MAX_POINTS_PER_MESSAGE = 400;

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
      if (!Array.isArray(d.points) || d.points.length > MAX_POINTS_PER_MESSAGE * 2 || d.points.length % 2 !== 0) return null;
      if (!d.points.every((p) => typeof p === 'number' && Number.isFinite(p))) return null;
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

/** Screen position inside the frame box → document position of the design page. */
export function toDocPoint(
  local: { x: number; y: number },
  scroll: { x: number; y: number },
  scale: number,
): { x: number; y: number } {
  return { x: Math.round(scroll.x + local.x / scale), y: Math.round(scroll.y + local.y / scale) };
}
