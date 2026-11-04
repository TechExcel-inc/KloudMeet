import { describe, expect, it } from 'vitest';
import { fitGrid, phoneGridColumns, tileHue } from './tileLayout';

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

  it('prefers an even grid when the tiles are nearly as big', () => {
    expect(fitGrid(16, 1400, 760, 12)).toMatchObject({ cols: 4, rows: 4 });
    expect(fitGrid(9, 1400, 760, 12)).toMatchObject({ cols: 3, rows: 3 });
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

describe('phoneGridColumns', () => {
  // An upright phone's gallery (360 × 812 screen, less the toolbar and padding) and the same phone on its side
  const upright = (n: number) => phoneGridColumns(n, 344, 660, 8);
  const sideways = (n: number) => phoneGridColumns(n, 780, 300, 8);

  it('stacks two or three people on an upright phone', () => {
    expect(upright(1)).toBe(1);
    expect(upright(2)).toBe(1);
    expect(upright(3)).toBe(1);
  });

  it('uses two columns for 4 to 8 people on an upright phone, not thin strips', () => {
    for (const n of [4, 5, 6, 7, 8]) expect(upright(n)).toBe(2);
  });

  it('uses more columns for a big meeting, at most 4', () => {
    expect(upright(12)).toBe(3);
    for (const n of [9, 12, 16, 17]) expect(upright(n)).toBeLessThanOrEqual(4);
    expect(upright(16)).toBeGreaterThanOrEqual(3);
  });

  it('puts people side by side on a phone turned sideways', () => {
    expect(sideways(2)).toBe(2);
    expect(sideways(5)).toBe(3);
  });

  it('copes with an empty box', () => {
    expect(phoneGridColumns(5, 0, 0, 8)).toBe(1);
  });
});
