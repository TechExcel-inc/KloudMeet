import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { resetRateLimits } from '@/lib/rateLimit';

const GUID = '123e4567-e89b-12d3-a456-426614174000';
const fetchMock = vi.fn();

function req(body: unknown, ip = '1.2.3.4') {
  return new NextRequest('http://localhost/api/livedoc/instant-account', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

beforeEach(() => {
  resetRateLimits();
  fetchMock.mockImplementation(async () => new Response('{"RetData":{}}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('POST /api/livedoc/instant-account', () => {
  it('forwards only Guid and UserName upstream', async () => {
    const res = await POST(req({ Guid: GUID, UserName: 'Ann', Role: 'admin' }));

    expect(res.status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ Guid: GUID, UserName: 'Ann' });
  });

  it('accepts an empty name and cuts a long one', async () => {
    expect((await POST(req({ Guid: GUID, UserName: '' }))).status).toBe(200);

    await POST(req({ Guid: GUID, UserName: 'x'.repeat(300) }));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).UserName).toHaveLength(191);
  });

  it.each([
    [{ UserName: 'Ann' }],
    [{ Guid: 'short', UserName: 'Ann' }],
    [{ Guid: '../../etc/passwd', UserName: 'Ann' }],
    [{ Guid: GUID, UserName: 5 }],
    [null],
  ])('rejects %j without calling upstream', async (body) => {
    expect((await POST(req(body))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON', async () => {
    expect((await POST(req('nope'))).status).toBe(400);
  });

  it('limits one address, not the next', async () => {
    for (let i = 0; i < 120; i++) await POST(req({ Guid: GUID, UserName: 'Ann' }));

    expect((await POST(req({ Guid: GUID, UserName: 'Ann' }))).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(120);
    expect((await POST(req({ Guid: GUID, UserName: 'Ann' }, '5.6.7.8'))).status).toBe(200);
  });
});
