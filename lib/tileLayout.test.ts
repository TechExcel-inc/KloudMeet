import { describe, expect, it } from 'vitest';
import { rowPlan, tileHue, tileInitial } from './tileLayout';

describe('rowPlan', () => {
  it('keeps small meetings on one row', () => {
    expect(rowPlan(1)).toEqual([1]);
    expect(rowPlan(3)).toEqual([3]);
  });

  it('splits into near-equal rows with the extra tiles at the bottom', () => {
    expect(rowPlan(4)).toEqual([2, 2]);
    expect(rowPlan(5)).toEqual([2, 3]);
    expect(rowPlan(7)).toEqual([3, 4]);
    expect(rowPlan(9)).toEqual([3, 3, 3]);
    expect(rowPlan(11)).toEqual([3, 4, 4]);
    expect(rowPlan(16)).toEqual([4, 4, 4, 4]);
  });

  it('never loses a tile', () => {
    for (let n = 0; n <= 25; n++) {
      expect(rowPlan(n).reduce((a, b) => a + b, 0)).toBe(n);
    }
  });
});

describe('tileHue', () => {
  it('is stable for the same person', () => {
    expect(tileHue('Angela')).toBe(tileHue('Angela'));
  });
});

describe('tileInitial', () => {
  it('shows one letter, upper-cased', () => {
    expect(tileInitial('ying huang')).toBe('Y');
    expect(tileInitial('  Kloud Solution')).toBe('K');
    expect(tileInitial('黄莹')).toBe('黄');
    expect(tileInitial('')).toBe('');
  });
});
