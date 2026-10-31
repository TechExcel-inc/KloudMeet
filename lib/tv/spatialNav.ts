/**
 * D-pad focus movement: from the focused element's box, pick the best box in the pressed
 * direction. Pure geometry, so it is tested without a DOM; useSpatialNav applies it to the page.
 *
 * Rules, the ones TV users expect from Android TV and the YouTube TV app:
 * - only boxes that lie in that direction count (a box overlapping the current one counts
 *   when its centre is past the current centre);
 * - a box in the same row (or column) beats a closer one that is off to the side;
 * - nothing in that direction → focus stays where it is (no wrapping).
 */

export type NavDirection = 'up' | 'down' | 'left' | 'right';

export interface NavRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const EPS = 1;

function centerX(r: NavRect): number {
  return (r.left + r.right) / 2;
}

function centerY(r: NavRect): number {
  return (r.top + r.bottom) / 2;
}

/** Gap between two ranges; 0 when they overlap. */
function rangeGap(a1: number, a2: number, b1: number, b2: number): number {
  if (b2 < a1) return a1 - b2;
  if (b1 > a2) return b1 - a2;
  return 0;
}

function isInDirection(from: NavRect, to: NavRect, dir: NavDirection): boolean {
  // Overlapping boxes count only when clearly offset: the focused item is often lifted or
  // scaled a few pixels, which must not make its neighbour in the same row look "below".
  const tolX = Math.max(EPS, 0.25 * Math.min(from.right - from.left, to.right - to.left));
  const tolY = Math.max(EPS, 0.25 * Math.min(from.bottom - from.top, to.bottom - to.top));
  switch (dir) {
    case 'right':
      return to.left >= from.right - tolX || (centerX(to) > centerX(from) + tolX && to.left > from.left + EPS);
    case 'left':
      return to.right <= from.left + tolX || (centerX(to) < centerX(from) - tolX && to.right < from.right - EPS);
    case 'down':
      return to.top >= from.bottom - tolY || (centerY(to) > centerY(from) + tolY && to.top > from.top + EPS);
    case 'up':
      return to.bottom <= from.top + tolY || (centerY(to) < centerY(from) - tolY && to.bottom < from.bottom - EPS);
  }
}

/** Lower is better. Exported for tests. */
export function navScore(from: NavRect, to: NavRect, dir: NavDirection): number {
  const horizontal = dir === 'left' || dir === 'right';
  const major = horizontal
    ? dir === 'right'
      ? Math.max(0, to.left - from.right)
      : Math.max(0, from.left - to.right)
    : dir === 'down'
      ? Math.max(0, to.top - from.bottom)
      : Math.max(0, from.top - to.bottom);
  const ortho = horizontal
    ? rangeGap(from.top, from.bottom, to.top, to.bottom)
    : rangeGap(from.left, from.right, to.left, to.right);
  // Same row / column: closest wins, ties go to the best-aligned centre.
  const align = horizontal
    ? Math.abs(centerY(to) - centerY(from))
    : Math.abs(centerX(to) - centerX(from));
  const offAxis = ortho > 0 ? 10_000 + ortho * 4 : 0;
  return offAxis + major * 2 + align * 0.5;
}

/** Index of the best candidate in `dir`, or -1 when there is none. */
export function pickNext(from: NavRect, candidates: NavRect[], dir: NavDirection): number {
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((to, i) => {
    if (to.right - to.left <= 0 || to.bottom - to.top <= 0) return;
    if (to.left === from.left && to.top === from.top && to.right === from.right && to.bottom === from.bottom) return;
    if (!isInDirection(from, to, dir)) return;
    const score = navScore(from, to, dir);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
