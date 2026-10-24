import { describe, expect, it } from 'vitest';
import { fitGrid, tileHue } from './tileLayout';

describe('fitGrid', () => {
  it('keeps every tile 16:9', () => {
    for (const n of [1, 2, 3, 5, 7, 12, 16]) {
      const fit = fitGrid(n, 1400, 760, 12);
      expect(Math.abs(fit.tileWidth / fit.tileHeight - 16 / 9)).toBeLessThan(0.02);
      expect(fit.cols * fit.rows).toBeGreaterThanOrEqual(n);
    }
  });

  it('fits inside the box', () => {
    for (const n of [1, 2, 4, 7, 9, 16]) {
      const fit = fitGrid(n, 1400, 760, 12);
      expect(fit.cols * fit.tileWidth + (fit.cols - 1) * 12).toBeLessThanOrEqual(1400);
      expect(fit.rows * fit.tileHeight + (fit.rows - 1) * 12).toBeLessThanOrEqual(760);
    }
  });

  it('picks the column count that gives the biggest tiles', () => {
    expect(fitGrid(1, 1400, 760, 12).cols).toBe(1);
    expect(fitGrid(2, 1400, 760, 12).cols).toBe(2);
    expect(fitGrid(4, 1400, 760, 12).cols).toBe(2);
    expect(fitGrid(7, 1400, 760, 12).cols).toBe(3);
  });

  it('returns nothing for an empty grid or box', () => {
    expect(fitGrid(0, 1400, 760, 12).tileWidth).toBe(0);
    expect(fitGrid(3, 0, 760, 12).tileWidth).toBe(0);
  });
});

describe('tileHue', () => {
  it('is stable for the same person', () => {
    expect(tileHue('Angela')).toBe(tileHue('Angela'));
  });
});
