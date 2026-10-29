import { describe, expect, it } from 'vitest';
import { coverCrop, isCustomBackgroundId } from './customBackgrounds';

describe('custom backgrounds', () => {
  it('crops a wide picture at the sides and a tall one at top and bottom', () => {
    expect(coverCrop(4000, 1000)).toEqual({ sx: 1111, sy: 0, sw: 1778, sh: 1000 });
    expect(coverCrop(1080, 1920)).toEqual({ sx: 0, sy: 656, sw: 1080, sh: 608 });
    expect(coverCrop(1920, 1080)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
  });

  it('only accepts ids it made', () => {
    expect(isCustomBackgroundId('custom:3f2c9a10-5b7e-4c1d-9e8f-0a1b2c3d4e5f')).toBe(true);
    expect(isCustomBackgroundId('custom:../x')).toBe(false);
    expect(isCustomBackgroundId('forest')).toBe(false);
    expect(isCustomBackgroundId(undefined)).toBe(false);
  });
});
