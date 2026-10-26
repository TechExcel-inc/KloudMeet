import { describe, expect, it } from 'vitest';
import { embedFromHeaders, frameAncestorsAllow, parseDesignEmbedCheck, xFrameOptionsAllow } from './designEmbed';
import { isPrivateHost } from './designLink';

const APP = 'https://meet.kloud.cn';
const PAGE = 'https://example.com/page';

describe('xFrameOptionsAllow (as a cross-site parent)', () => {
  it('blocks DENY and SAMEORIGIN in any case and spacing', () => {
    expect(xFrameOptionsAllow('DENY')).toBe(false);
    expect(xFrameOptionsAllow(' sameorigin ')).toBe(false);
    expect(xFrameOptionsAllow('SameOrigin')).toBe(false);
  });
  it('allows a missing header, ALLOW-FROM and unknown values', () => {
    expect(xFrameOptionsAllow(null)).toBe(true);
    expect(xFrameOptionsAllow('')).toBe(true);
    expect(xFrameOptionsAllow('ALLOW-FROM https://meet.kloud.cn')).toBe(true);
    expect(xFrameOptionsAllow('allowall')).toBe(true);
  });
  it('treats repeated equal values as one, and conflicting values as blocked', () => {
    expect(xFrameOptionsAllow('DENY, deny')).toBe(false);
    expect(xFrameOptionsAllow('SAMEORIGIN, ALLOWALL')).toBe(false);
    expect(xFrameOptionsAllow('foo, bar')).toBe(true);
  });
});

describe('frameAncestorsAllow', () => {
  const allow = (csp: string | string[]) => frameAncestorsAllow(Array.isArray(csp) ? csp : [csp], APP, PAGE);
  it('is null when no policy sets frame-ancestors', () => {
    expect(allow([])).toBeNull();
    expect(allow("default-src 'self'; script-src 'self'")).toBeNull();
  });
  it("blocks 'none', 'self' and an empty list", () => {
    expect(allow("frame-ancestors 'none'")).toBe(false);
    expect(allow("default-src *; frame-ancestors 'self'")).toBe(false);
    expect(allow('frame-ancestors')).toBe(false);
  });
  it('allows *, matching schemes, hosts, wildcards and ports', () => {
    expect(allow('frame-ancestors *')).toBe(true);
    expect(allow('frame-ancestors https:')).toBe(true);
    expect(allow("frame-ancestors 'self' https://meet.kloud.cn")).toBe(true);
    expect(allow('frame-ancestors meet.kloud.cn')).toBe(true);
    expect(allow('frame-ancestors *.kloud.cn')).toBe(true);
    expect(allow('frame-ancestors https://meet.kloud.cn:443')).toBe(true);
    expect(allow('frame-ancestors https://meet.kloud.cn:*')).toBe(true);
    expect(allow('frame-ancestors http://meet.kloud.cn')).toBe(true); // http sources allow the https upgrade
    expect(allow('FRAME-ANCESTORS HTTPS://MEET.KLOUD.CN')).toBe(true);
  });
  it('blocks other hosts, the apex for a wildcard, wrong ports and schemes', () => {
    expect(allow('frame-ancestors https://figma.com')).toBe(false);
    expect(allow('frame-ancestors *.meet.kloud.cn')).toBe(false);
    expect(allow('frame-ancestors https://meet.kloud.cn:8443')).toBe(false);
    expect(allow('frame-ancestors wss:')).toBe(false);
    expect(allow('frame-ancestors https://notkloud.cn')).toBe(false);
  });
  it('needs every policy to allow (several headers, or several policies in one)', () => {
    expect(allow(['frame-ancestors *', "frame-ancestors 'none'"])).toBe(false);
    expect(allow("frame-ancestors *, frame-ancestors 'self'")).toBe(false);
    expect(allow(['frame-ancestors *.kloud.cn', 'frame-ancestors https:'])).toBe(true);
  });
  it('uses the first frame-ancestors in a policy', () => {
    expect(allow("frame-ancestors *; frame-ancestors 'none'")).toBe(true);
  });
});

describe('embedFromHeaders', () => {
  it('reports which header refused', () => {
    expect(embedFromHeaders({ xFrameOptions: 'DENY', csp: [] }, APP, PAGE)).toEqual({ embed: 'blocked', reason: 'xfo' });
    expect(embedFromHeaders({ xFrameOptions: null, csp: ["frame-ancestors 'none'"] }, APP, PAGE)).toEqual({
      embed: 'blocked',
      reason: 'csp',
    });
    expect(embedFromHeaders({ xFrameOptions: null, csp: [] }, APP, PAGE)).toEqual({ embed: 'ok' });
  });
  it('ignores X-Frame-Options when CSP frame-ancestors is present', () => {
    expect(embedFromHeaders({ xFrameOptions: 'SAMEORIGIN', csp: ['frame-ancestors https://meet.kloud.cn'] }, APP, PAGE)).toEqual({
      embed: 'ok',
    });
  });
  it('reads an untrusted check result', () => {
    expect(parseDesignEmbedCheck({ embed: 'blocked', reason: 'csp' })).toEqual({ embed: 'blocked', reason: 'csp' });
    expect(parseDesignEmbedCheck({ embed: 'maybe' })).toEqual({ embed: 'unknown' });
    expect(parseDesignEmbedCheck(null)).toEqual({ embed: 'unknown' });
  });
});

describe('isPrivateHost on resolved addresses', () => {
  it('refuses local, link-local, carrier-grade, benchmark and multicast ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '224.0.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateHost(ip), ip).toBe(true);
    }
  });
  it('accepts public addresses', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) expect(isPrivateHost(ip), ip).toBe(false);
  });
});
