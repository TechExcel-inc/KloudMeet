/**
 * Glyphs for the mic / camera chips on meeting tiles: injected as HTML into LiveKit tiles
 * (app/rooms/[roomName]/useTileIndicators.ts) and drawn by the floating / SmartCam tiles
 * (roomVideoLayouts.tsx). Filled Material icons, so the "off" slash stays crisp at 16px: the
 * earlier injected glyphs drew it as a line with JSX attribute names inside raw HTML, which
 * browsers ignore, so the slash was a hairline and a muted mic looked like an open one.
 */
export const TILE_GLYPH_PATHS = {
  mic: 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
  micOff:
    'M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z',
  cam: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z',
  camOff:
    'M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z',
} as const;

const svg = (path: string) =>
  `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;

export const TILE_MIC_SVG = svg(TILE_GLYPH_PATHS.mic);
export const TILE_MIC_OFF_SVG = svg(TILE_GLYPH_PATHS.micOff);
export const TILE_CAM_SVG = svg(TILE_GLYPH_PATHS.cam);
export const TILE_CAM_OFF_SVG = svg(TILE_GLYPH_PATHS.camOff);
