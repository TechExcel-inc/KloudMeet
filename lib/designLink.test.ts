import { describe, expect, it } from 'vitest';
import {
  clampDesignZoom,
  designFrameLayout,
  parseDesignLink,
  parseDesignViewport,
  parseStoredDesignLink,
} from './designLink';

const app = { appOrigin: 'https://meet.kloud.cn' };

describe('parseDesignLink', () => {
  it('turns a Figma design link into an embed link and drops share noise', () => {
    const r = parseDesignLink('https://www.figma.com/design/AbC123xyz789/Kloud-Meet-V3?node-id=12-34&t=XyZ-1', app);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.link.kind).toBe('figma');
    expect(r.link.figmaType).toBe('design');
    expect(r.link.label).toBe('Kloud Meet V3');
    const embed = new URL(r.link.embedUrl);
    expect(embed.origin + embed.pathname).toBe('https://embed.figma.com/design/AbC123xyz789');
    expect(embed.searchParams.get('node-id')).toBe('12-34');
    expect(embed.searchParams.get('t')).toBeNull();
    expect(embed.searchParams.get('embed-host')).toBe('kloudmeet');
  });

  it('maps old /file/ links to design and keeps prototype start points', () => {
    const file = parseDesignLink('figma.com/file/AbC123xyz789/Old', app);
    expect(file.ok && file.link.figmaType).toBe('design');
    const proto = parseDesignLink(
      'https://www.figma.com/proto/AbC123xyz789/Flow?node-id=5-3&starting-point-node-id=5%3A3&scaling=scale-down',
      app,
    );
    expect(proto.ok).toBe(true);
    if (!proto.ok) return;
    expect(proto.link.figmaType).toBe('proto');
    const embed = new URL(proto.link.embedUrl);
    expect(embed.pathname).toBe('/proto/AbC123xyz789');
    expect(embed.searchParams.get('starting-point-node-id')).toBe('5:3');
    expect(embed.searchParams.get('scaling')).toBe('scale-down');
  });

  it('accepts embed.figma.com links and overrides their embed host', () => {
    const r = parseDesignLink('https://embed.figma.com/board/AbC123xyz789?embed-host=someone-else', app);
    expect(r.ok && new URL(r.link.embedUrl).searchParams.getAll('embed-host')).toEqual(['kloudmeet']);
  });

  it('treats other Figma pages and other sites as plain web links', () => {
    const community = parseDesignLink('https://www.figma.com/community/file/123', app);
    expect(community.ok && community.link.kind).toBe('web');
    const web = parseDesignLink('https://docs.google.com/presentation/d/e/2PACX/embed', app);
    expect(web.ok && web.link).toMatchObject({ kind: 'web', host: 'docs.google.com', label: 'docs.google.com' });
    expect(web.ok && web.link.embedUrl).toBe('https://docs.google.com/presentation/d/e/2PACX/embed');
  });

  it('adds https when the scheme is missing', () => {
    const r = parseDesignLink('example.com/page', app);
    expect(r.ok && r.link.url).toBe('https://example.com/page');
  });

  it('refuses unsafe or unusable links', () => {
    expect(parseDesignLink('', app)).toEqual({ ok: false, error: 'empty' });
    expect(parseDesignLink('http://example.com', app)).toEqual({ ok: false, error: 'notHttps' });
    expect(parseDesignLink('javascript:alert(1)', app)).toEqual({ ok: false, error: 'notHttps' });
    expect(parseDesignLink('data:text/html,hi', app)).toEqual({ ok: false, error: 'notHttps' });
    expect(parseDesignLink('https://meet.kloud.cn/rooms/x', app)).toEqual({ ok: false, error: 'sameSite' });
    expect(parseDesignLink('https://localhost:3000', app)).toEqual({ ok: false, error: 'privateHost' });
    expect(parseDesignLink('https://192.168.1.10/a', app)).toEqual({ ok: false, error: 'privateHost' });
    expect(parseDesignLink('https://[::1]/a', app)).toEqual({ ok: false, error: 'privateHost' });
    expect(parseDesignLink('https://intranet/a', app)).toEqual({ ok: false, error: 'privateHost' });
    expect(parseDesignLink('https://user:pw@example.com', app)).toEqual({ ok: false, error: 'invalid' });
    expect(parseDesignLink(`https://example.com/${'a'.repeat(2100)}`, app)).toEqual({ ok: false, error: 'tooLong' });
  });

  it('allows other kloud.cn sites (only the meeting site itself is refused)', () => {
    expect(parseDesignLink('https://design.kloud.cn/abc/', app).ok).toBe(true);
  });
});

describe('parseStoredDesignLink', () => {
  it('keeps known fields and rejects junk', () => {
    expect(parseStoredDesignLink({ url: 'https://a.io', setBy: 'km_1_x', setAt: 5, extra: 1 })).toEqual({
      url: 'https://a.io',
      setBy: 'km_1_x',
      setAt: 5,
    });
    expect(parseStoredDesignLink({ url: 3 })).toBeNull();
    expect(parseStoredDesignLink(null)).toBeNull();
  });
});

describe('viewport', () => {
  it('clamps zoom and validates sizes', () => {
    expect(clampDesignZoom(5)).toBe(2);
    expect(clampDesignZoom(0.1)).toBe(0.5);
    expect(clampDesignZoom(NaN)).toBe(1);
    expect(parseDesignViewport({ zoom: 1.25, baseWidth: 1200, baseHeight: 700 })).toEqual({
      zoom: 1.25,
      baseWidth: 1200,
      baseHeight: 700,
    });
    expect(parseDesignViewport({ zoom: 1, baseWidth: 10, baseHeight: 700 })).toBeNull();
  });

  it('fits the presenter view into a smaller stage', () => {
    const layout = designFrameLayout({ zoom: 1.25, baseWidth: 1200, baseHeight: 700 }, 600, 600);
    expect(layout.frameWidth).toBe(960);
    expect(layout.frameHeight).toBe(560);
    expect(layout.scale).toBeCloseTo(0.625);
    expect(layout.boxWidth).toBe(600);
    expect(layout.boxHeight).toBe(350);
  });
});
