import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET } from '../route';

const get = (query: string, range?: string) =>
  GET(new NextRequest(`https://meet.kloud.cn/api/recordings/silence${query}`, { headers: range ? { range } : {} }));

describe('GET /api/recordings/silence', () => {
  it('serves a silent WAV of the asked length', async () => {
    const response = await get('?seconds=3');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe(String(44 + 3 * 8000));
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBe(44 + 3 * 8000);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    expect(bytes.subarray(44).every((value) => value === 0x80)).toBe(true);
  });

  it('serves byte ranges, which players use to seek', async () => {
    const response = await get('?seconds=3600', 'bytes=1000000-1000099');
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 1000000-1000099/${44 + 3600 * 8000}`);
    expect(response.headers.get('content-length')).toBe('100');
    expect((await response.arrayBuffer()).byteLength).toBe(100);

    const open = await get('?seconds=2', 'bytes=0-');
    expect(open.status).toBe(206);
    expect(open.headers.get('content-range')).toBe('bytes 0-16043/16044');
  });

  it('refuses lengths and ranges it cannot serve', async () => {
    for (const query of ['', '?seconds=0', '?seconds=1.5', '?seconds=abc', '?seconds=43201']) {
      expect((await get(query)).status).toBe(400);
    }
    const beyond = await get('?seconds=1', 'bytes=999999-');
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('content-range')).toBe('bytes */8044');
  });
});
