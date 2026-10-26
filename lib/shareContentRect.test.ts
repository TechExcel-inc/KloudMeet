import { describe, expect, it } from 'vitest';
import { contentRect, fromContentNormalized, toContentNormalized } from './shareContentRect';

describe('contentRect', () => {
  it('letterboxes a wide screen inside a taller box (bars top and bottom)', () => {
    // 1920×1080 share in a 1000×800 video box at (100, 50)
    const r = contentRect({ left: 100, top: 50, width: 1000, height: 800 }, 1920, 1080);
    expect(r.left).toBe(100);
    expect(r.width).toBe(1000);
    expect(r.height).toBeCloseTo(562.5);
    expect(r.top).toBeCloseTo(50 + (800 - 562.5) / 2);
  });

  it('pillarboxes a tall window inside a wide box (bars left and right)', () => {
    const r = contentRect({ left: 0, top: 0, width: 1600, height: 900 }, 1000, 1000);
    expect(r).toEqual({ left: 350, top: 0, width: 900, height: 900 });
  });

  it('cover crops instead of adding bars', () => {
    const r = contentRect({ left: 0, top: 0, width: 1000, height: 1000 }, 2000, 1000, 'cover');
    expect(r).toEqual({ left: -500, top: 0, width: 2000, height: 1000 });
  });

  it('falls back to the whole box before the first frame reports its size', () => {
    expect(contentRect({ left: 5, top: 6, width: 300, height: 200 }, 0, 0)).toEqual({ left: 5, top: 6, width: 300, height: 200 });
  });
});

describe('toContentNormalized', () => {
  const content = { left: 100, top: 200, width: 800, height: 450 };

  it('maps the content corners to 0 and 1', () => {
    expect(toContentNormalized(100, 200, content)).toEqual({ x: 0, y: 0, inside: true });
    expect(toContentNormalized(900, 650, content)).toEqual({ x: 1, y: 1, inside: true });
    expect(toContentNormalized(500, 425, content)).toEqual({ x: 0.5, y: 0.5, inside: true });
  });

  it('clamps and flags points over the bars or the camera strip', () => {
    expect(toContentNormalized(50, 100, content)).toEqual({ x: 0, y: 0, inside: false });
    expect(toContentNormalized(1200, 500, content)).toMatchObject({ x: 1, inside: false });
  });

  it('round-trips through fromContentNormalized', () => {
    const p = fromContentNormalized(0.25, 0.75, content);
    const n = toContentNormalized(p.x, p.y, content);
    expect(n.x).toBeCloseTo(0.25);
    expect(n.y).toBeCloseTo(0.75);
  });

  it('puts the same screen point at the same normalized position for two different viewers', () => {
    // The presenter shares 1920×1080. Viewer A's stage is 1400×900 with a 300 px camera strip on
    // the right (video box 1100 wide); viewer B has a small, tall window. Both point at the same
    // pixel of the shared screen.
    const share = { w: 1920, h: 1080 };
    const target = { x: 0.3, y: 0.6 };
    const a = contentRect({ left: 0, top: 0, width: 1100, height: 900 }, share.w, share.h);
    const b = contentRect({ left: 20, top: 80, width: 600, height: 700 }, share.w, share.h);
    const pa = fromContentNormalized(target.x, target.y, a);
    const pb = fromContentNormalized(target.x, target.y, b);
    for (const [p, r] of [
      [pa, a],
      [pb, b],
    ] as const) {
      const n = toContentNormalized(p.x, p.y, r);
      expect(n.x).toBeCloseTo(target.x);
      expect(n.y).toBeCloseTo(target.y);
    }
    // …while the old math (position ÷ whole stage, camera strip and bars included) disagreed.
    const naiveA = { x: pa.x / 1400, y: pa.y / 900 };
    const naiveB = { x: (pb.x - 20) / 600, y: (pb.y - 80) / 700 };
    expect(Math.abs(naiveA.x - naiveB.x)).toBeGreaterThan(0.05);
    expect(Math.abs(naiveA.y - naiveB.y)).toBeGreaterThan(0.01);
  });
});
