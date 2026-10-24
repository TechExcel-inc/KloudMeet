import { describe, expect, it } from 'vitest';
import { DEFAULT_GALLERY_PREFS, filterGalleryTracks, videoFirstOrder, type GalleryTrack } from './galleryPrefs';

const t = (name: string, p: Partial<GalleryTrack['participant']> = {}, source = 'camera') => ({
  name,
  source,
  participant: { isLocal: false, isSpeaking: false, isCameraEnabled: false, ...p },
});

describe('filterGalleryTracks', () => {
  const tracks = [t('me', { isLocal: true }), t('a', { isCameraEnabled: true }), t('b'), t('c')];

  it('keeps everyone by default', () => {
    expect(filterGalleryTracks(tracks, DEFAULT_GALLERY_PREFS)).toHaveLength(4);
  });

  it('hides people without video but never you', () => {
    const shown = filterGalleryTracks(tracks, { ...DEFAULT_GALLERY_PREFS, hideNoVideo: true });
    expect(shown.map((x) => x.name)).toEqual(['me', 'a']);
  });
});

describe('videoFirstOrder', () => {
  it('puts you, then speakers, then cameras on, keeping order inside each group', () => {
    const order = videoFirstOrder([
      t('me', { isLocal: true }),
      t('quiet1'),
      t('cam1', { isCameraEnabled: true }),
      t('talking', { isSpeaking: true }),
      t('quiet2'),
      t('cam2', { isCameraEnabled: true }),
    ]);
    expect(order.map((x) => x.name)).toEqual(['me', 'talking', 'cam1', 'cam2', 'quiet1', 'quiet2']);
  });
});
