import { describe, expect, it } from 'vitest';
import {
  chunkStrokePoints,
  designPageKey,
  isSameSiteHref,
  parseDesignPageMessage,
  parseDesignSyncMessage,
  toDocPoint,
} from './designSync';

describe('parseDesignPageMessage', () => {
  const hello = {
    source: 'kloud-design',
    v: 1,
    type: 'hello',
    href: 'https://design.kloud.cn/d/x/',
    title: 'Home',
    scrollX: 0,
    scrollY: 40,
    docWidth: 1200,
    docHeight: 3000,
    viewWidth: 1200,
    viewHeight: 700,
  };
  it('reads hello, size and scroll from the sync script', () => {
    expect(parseDesignPageMessage(hello)).toMatchObject({ type: 'hello', scrollY: 40, docHeight: 3000 });
    expect(parseDesignPageMessage({ ...hello, type: 'size' })?.type).toBe('size');
    expect(parseDesignPageMessage({ source: 'kloud-design', type: 'scroll', href: hello.href, scrollX: 0, scrollY: 9 })).toEqual({
      type: 'scroll',
      href: hello.href,
      scrollX: 0,
      scrollY: 9,
    });
  });
  it('ignores anything else', () => {
    expect(parseDesignPageMessage({ ...hello, source: 'other' })).toBeNull();
    expect(parseDesignPageMessage({ ...hello, scrollY: 'x' })).toBeNull();
    expect(parseDesignPageMessage({ ...hello, type: 'eval' })).toBeNull();
    expect(parseDesignPageMessage('hello')).toBeNull();
  });
});

describe('pages', () => {
  it('keeps pages on the link’s site and ignores the hash', () => {
    expect(isSameSiteHref('https://design.kloud.cn/d/x/b.html', 'https://design.kloud.cn/d/x/')).toBe(true);
    expect(isSameSiteHref('https://evil.example/d/x/', 'https://design.kloud.cn/d/x/')).toBe(false);
    expect(designPageKey('https://design.kloud.cn/d/x/b.html?v=2#top')).toBe('https://design.kloud.cn/d/x/b.html?v=2');
  });
});

describe('parseDesignSyncMessage', () => {
  it('accepts well-formed messages', () => {
    expect(parseDesignSyncMessage({ type: 'viewport', viewport: { zoom: 1.2, baseWidth: 1200, baseHeight: 700 } })).toEqual({
      type: 'viewport',
      viewport: { zoom: 1.2, baseWidth: 1200, baseHeight: 700 },
    });
    expect(parseDesignSyncMessage({ type: 'scroll', scroll: { href: 'https://a.io/', x: -3, y: 50 } })).toEqual({
      type: 'scroll',
      scroll: { href: 'https://a.io/', x: 0, y: 50 },
    });
    expect(parseDesignSyncMessage({ type: 'stroke', id: 'a1', page: 'p', color: '#ff3b30', points: [1, 2, 3, 4], start: true })).toEqual({
      type: 'stroke',
      id: 'a1',
      page: 'p',
      color: '#ff3b30',
      points: [1, 2, 3, 4],
      start: true,
    });
    expect(parseDesignSyncMessage({ type: 'laser', page: 'p', x: 1, y: 2, name: 'ying' })).toMatchObject({ type: 'laser', x: 1 });
    expect(parseDesignSyncMessage({ type: 'clear', page: 'p' })).toEqual({ type: 'clear', page: 'p' });
  });
  it('rejects bad colours, odd point lists and unknown types', () => {
    expect(parseDesignSyncMessage({ type: 'stroke', id: 'a', page: 'p', color: 'url(x)', points: [1, 2] })).toBeNull();
    expect(parseDesignSyncMessage({ type: 'stroke', id: 'a', page: 'p', color: '#ff3b30', points: [1, 2, 3] })).toBeNull();
    expect(parseDesignSyncMessage({ type: 'stroke', id: 'a', page: 'p', color: '#ff3b30', points: [1, 'x'] })).toBeNull();
    expect(parseDesignSyncMessage({ type: 'scroll', scroll: { href: 5, x: 0, y: 0 } })).toBeNull();
    expect(parseDesignSyncMessage({ type: 'nope' })).toBeNull();
  });
});

describe('geometry', () => {
  it('maps a point on screen to the page document', () => {
    expect(toDocPoint({ x: 100, y: 50 }, { x: 0, y: 1200 }, 0.5)).toEqual({ x: 200, y: 1300 });
  });
  it('chunks long strokes', () => {
    const points = Array.from({ length: 1000 }, (_, i) => i);
    const chunks = chunkStrokePoints(points);
    expect(chunks.map((c) => c.length)).toEqual([800, 200]);
    expect(chunks.flat()).toEqual(points);
  });
});
