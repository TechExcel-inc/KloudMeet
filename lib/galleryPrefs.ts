/**
 * Personal gallery settings (each viewer's own, kept in this browser), like Zoom / Meet / Teams:
 * how many tiles a page holds, whether people with their camera on come first, and whether
 * people without video are hidden. Your own tile is never hidden.
 */

export const TILES_PER_PAGE_OPTIONS = ['auto', 9, 16, 25, 49] as const;
export type TilesPerPage = (typeof TILES_PER_PAGE_OPTIONS)[number];

export interface GalleryPrefs {
  tilesPerPage: TilesPerPage;
  videoFirst: boolean;
  hideNoVideo: boolean;
}

export const DEFAULT_GALLERY_PREFS: GalleryPrefs = { tilesPerPage: 'auto', videoFirst: false, hideNoVideo: false };

const STORAGE_KEY = 'km-gallery-prefs';

export function loadGalleryPrefs(): GalleryPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      tilesPerPage: TILES_PER_PAGE_OPTIONS.includes(raw.tilesPerPage) ? raw.tilesPerPage : 'auto',
      videoFirst: raw.videoFirst === true,
      hideNoVideo: raw.hideNoVideo === true,
    };
  } catch {
    return DEFAULT_GALLERY_PREFS;
  }
}

export function saveGalleryPrefs(prefs: GalleryPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable: the setting lasts for this meeting only */
  }
}

/** The parts of a LiveKit track reference these rules look at. */
export interface GalleryTrack {
  source: string;
  participant: { isLocal: boolean; isSpeaking: boolean; isCameraEnabled: boolean };
}

/** "Hide people without video": drops camera-off tiles, but never your own. */
export function filterGalleryTracks<T extends GalleryTrack>(tracks: T[], prefs: GalleryPrefs): T[] {
  if (!prefs.hideNoVideo) return tracks;
  return tracks.filter((t) => t.participant.isLocal || t.participant.isCameraEnabled);
}

/**
 * "Video first", applied on top of LiveKit's order (you, screen shares, speakers, recent
 * speakers, …): you stay first and whoever is speaking stays ahead, then everyone with a camera
 * on, then the rest. Stable, so people keep their place inside each group.
 */
export function videoFirstOrder<T extends GalleryTrack>(sorted: T[]): T[] {
  const rank = (t: T) =>
    t.participant.isLocal ? 0 : t.source === 'screen_share' ? 1 : t.participant.isSpeaking ? 2 : t.participant.isCameraEnabled ? 3 : 4;
  return sorted
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .map(({ t }) => t);
}
