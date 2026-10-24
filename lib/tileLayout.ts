/**
 * Gallery layout helpers for the desktop webcam grid.
 *
 * Like Zoom, Google Meet and Teams, every tile in the gallery is the same size and 16:9, and
 * a short last row is centred. Only the tile size changes as people join or the window
 * resizes; tiles never stretch to different shapes row by row.
 */

export const TILE_ASPECT = 16 / 9;

export interface GridFit {
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

/** Tiles may be this much smaller than the largest possible if that leaves fewer empty slots. */
const EVEN_GRID_TOLERANCE = 0.85;

/**
 * The column count for `count` equal 16:9 tiles in a W×H box: tiles as large as possible, but
 * among sizes within EVEN_GRID_TOLERANCE of the largest, the grid with the fewest empty slots
 * (16 people → 4×4, not 5 + 5 + 5 + 1).
 */
export function fitGrid(count: number, width: number, height: number, gap: number, aspect = TILE_ASPECT): GridFit {
  if (count <= 0 || width <= 0 || height <= 0) return { cols: 0, rows: 0, tileWidth: 0, tileHeight: 0 };
  const options: GridFit[] = [];
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const byWidth = (width - (cols - 1) * gap) / cols;
    const byHeight = ((height - (rows - 1) * gap) / rows) * aspect;
    const tileWidth = Math.floor(Math.min(byWidth, byHeight));
    if (tileWidth > 0) options.push({ cols, rows, tileWidth, tileHeight: Math.floor(tileWidth / aspect) });
  }
  if (options.length === 0) return { cols: 0, rows: 0, tileWidth: 0, tileHeight: 0 };
  const largest = Math.max(...options.map((o) => o.tileWidth));
  const empty = (o: GridFit) => o.cols * o.rows - count;
  return options
    .filter((o) => o.tileWidth >= largest * EVEN_GRID_TOLERANCE)
    .sort((a, b) => empty(a) - empty(b) || b.tileWidth - a.tileWidth)[0];
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
 * Sizes the tiles of a `.lk-grid-layout` (see globals.css): one tile size for all, from the
 * grid's own box. Safe to call repeatedly; only writes when the size changes.
 */
export function applyBalancedGrid(grid: HTMLElement): void {
  const count = Array.from(grid.children).filter((el) => el.classList.contains('lk-participant-tile')).length;
  if (count === 0) {
    grid.removeAttribute('data-km-balanced');
    return;
  }
  const cs = getComputedStyle(grid);
  const width = grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const height = grid.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const gap = parseFloat(cs.columnGap) || 0;
  const fit = fitGrid(count, width, height, gap);
  if (fit.tileWidth <= 0) return;
  grid.setAttribute('data-km-balanced', 'true');
  const w = `${fit.tileWidth}px`;
  const h = `${fit.tileHeight}px`;
  if (grid.style.getPropertyValue('--km-tile-w') !== w) grid.style.setProperty('--km-tile-w', w);
  if (grid.style.getPropertyValue('--km-tile-h') !== h) grid.style.setProperty('--km-tile-h', h);
}

/** Gives a tile its person's colour (camera-off background and avatar). */
export function applyTileHue(tile: HTMLElement, key: string): void {
  if (!key) return;
  const hue = String(tileHue(key));
  if (tile.style.getPropertyValue('--km-tile-hue') !== hue) {
    tile.style.setProperty('--km-tile-hue', hue);
  }
}
