/**
 * Gallery layout helpers for the desktop webcam grid.
 *
 * LiveKit's GridLayout uses a fixed column count, so 7 people become a 3×3 grid with two
 * empty cells. Like Google Meet we instead split tiles into rows of near-equal size
 * (7 → 3 + 4) and let every row fill the full width.
 */

/** Tiles per row for `count` tiles, top row first. Lower rows get the extra tile. */
export function rowPlan(count: number): number[] {
  if (count <= 0) return [];
  if (count <= 3) return [count];
  const rows = count <= 8 ? 2 : count <= 15 ? 3 : 4;
  const base = Math.floor(count / rows);
  const extra = count % rows;
  return Array.from({ length: rows }, (_, i) => base + (i >= rows - extra ? 1 : 0));
}

/** Hues that read well as a dark tile background with white text. */
const TILE_HUES = [262, 152, 330, 205, 24, 288, 96, 186, 44, 228];

/** A stable hue per person, so everyone keeps the same tile colour all meeting. */
export function tileHue(key: string): number {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) | 0;
  return TILE_HUES[Math.abs(hash) % TILE_HUES.length];
}

/**
 * Marks a `.lk-grid-layout` for the balanced layout (see globals.css): sets the row count on
 * the grid and each tile's row size. Safe to call repeatedly.
 */
export function applyBalancedGrid(grid: HTMLElement): void {
  const tiles = Array.from(grid.children).filter((el): el is HTMLElement =>
    el.classList.contains('lk-participant-tile'),
  );
  const plan = rowPlan(tiles.length);
  if (plan.length === 0) {
    grid.removeAttribute('data-km-balanced');
    return;
  }
  grid.setAttribute('data-km-balanced', 'true');
  grid.style.setProperty('--km-rows', String(plan.length));
  let index = 0;
  for (const cols of plan) {
    for (let i = 0; i < cols; i++, index++) {
      tiles[index].style.setProperty('--km-row-cols', String(cols));
    }
  }
}

/** One letter for the camera-off avatar, like Google Meet ("ying huang" → "Y"). */
export function tileInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : '';
}

/**
 * Gives a tile its person's colour (camera-off background and avatar) and the single letter
 * the avatar shows.
 */
export function applyTileHue(tile: HTMLElement, key: string): void {
  if (!key) return;
  const hue = String(tileHue(key));
  if (tile.style.getPropertyValue('--km-tile-hue') !== hue) {
    tile.style.setProperty('--km-tile-hue', hue);
  }
  const placeholder = tile.querySelector<HTMLElement>('.lk-participant-placeholder');
  const initial = tileInitial(key);
  if (placeholder && initial && placeholder.getAttribute('data-km-initial') !== initial) {
    placeholder.setAttribute('data-km-initial', initial);
  }
}
