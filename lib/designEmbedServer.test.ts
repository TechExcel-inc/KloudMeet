import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkDesignEmbed, publicOnlyLookup } from './designEmbedServer';

const APP = 'https://meet.kloud.cn';

/** Local pages standing in for sites (development rules allow http://localhost) */
let base = '';
const hits: string[] = [];
const server = http.createServer((req, res) => {
  hits.push(req.url ?? '');
  switch (req.url) {
    case '/deny':
      res.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY' });
      return res.end('no');
    case '/csp':
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'" });
      return res.end('no');
    case '/csp-allows':
      res.writeHead(200, { 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': 'frame-ancestors https://meet.kloud.cn' });
      return res.end('yes');
    case '/to-deny':
      res.writeHead(302, { Location: '/deny' });
      return res.end();
    case '/to-private':
      res.writeHead(302, { Location: 'https://10.0.0.1/admin' });
      return res.end();
    case '/to-odd-port':
      res.writeHead(302, { Location: 'https://example.com:8443/' });
      return res.end();
    case '/loop':
      res.writeHead(302, { Location: '/loop' });
      return res.end();
    case '/missing':
      res.writeHead(404, { 'X-Frame-Options': 'DENY' });
      return res.end();
    default:
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<h1>ok</h1>');
  }
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('checkDesignEmbed', () => {
  it('reads the framing headers of the page', async () => {
    expect(await checkDesignEmbed(`${base}/`, APP)).toEqual({ embed: 'ok' });
    expect(await checkDesignEmbed(`${base}/deny`, APP)).toEqual({ embed: 'blocked', reason: 'xfo' });
    expect(await checkDesignEmbed(`${base}/csp`, APP)).toEqual({ embed: 'blocked', reason: 'csp' });
    expect(await checkDesignEmbed(`${base}/csp-allows`, APP)).toEqual({ embed: 'ok' });
  });

  it('follows redirects to the page that answers', async () => {
    expect(await checkDesignEmbed(`${base}/to-deny`, APP)).toEqual({ embed: 'blocked', reason: 'xfo' });
  });

  it('does not follow redirects to local-network addresses or other ports, and stops loops', async () => {
    expect(await checkDesignEmbed(`${base}/to-private`, APP)).toEqual({ embed: 'unknown' });
    expect(await checkDesignEmbed(`${base}/to-odd-port`, APP)).toEqual({ embed: 'unknown' });
    hits.length = 0;
    expect(await checkDesignEmbed(`${base}/loop`, APP)).toEqual({ embed: 'unknown' });
    expect(hits.length).toBeLessThanOrEqual(5);
  });

  it('answers unknown for error pages and links it may not fetch', async () => {
    expect(await checkDesignEmbed(`${base}/missing`, APP)).toEqual({ embed: 'unknown' });
    expect(await checkDesignEmbed('https://192.168.1.10/', APP)).toEqual({ embed: 'unknown' });
    expect(await checkDesignEmbed('https://example.com:8443/', APP)).toEqual({ embed: 'unknown' });
    expect(await checkDesignEmbed('http://example.com/', APP)).toEqual({ embed: 'unknown' });
    expect(await checkDesignEmbed('https://meet.kloud.cn/rooms/x', APP)).toEqual({ embed: 'unknown' });
  });

  it('treats Figma links as embeddable without fetching', async () => {
    expect(await checkDesignEmbed('https://www.figma.com/design/AbCdEf123456/Checkout', APP)).toEqual({ embed: 'ok' });
  });
});

describe('publicOnlyLookup', () => {
  it('refuses names that resolve to local addresses (DNS rebinding)', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      publicOnlyLookup('localhost', {}, (e) => resolve(e)),
    );
    expect(err?.code).toBe('EADDRNOTALLOWED');
  });
});
