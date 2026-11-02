import {
  buildPeerTimeUrl,
  ensureHostBypassesProxy,
  formatUpstreamFetchError,
} from '@/lib/peertimeUpstream';
import { clientIp, rateLimited } from '@/lib/rateLimit';
import { NextRequest, NextResponse } from 'next/server';

/** Guests have no login, so the limit is per address; a whole office may share one. */
const IP_LIMIT = 120;
const IP_WINDOW_MS = 15 * 60 * 1000;
const GUID_PATTERN = /^[\w-]{8,64}$/;
const USER_NAME_MAX = 191;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (rateLimited(`instant-account:ip:${clientIp(request)}`, IP_LIMIT, IP_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  const { url, headers: loopbackHeaders } = buildPeerTimeUrl(
    '/peertime/V1/User/CreateOrUpdateInstantAccout4Syncroom',
  );
  ensureHostBypassesProxy(url);

  let payload: { Guid?: unknown; UserName?: unknown } | null;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const guid = payload?.Guid;
  const userName = payload?.UserName;
  if (typeof guid !== 'string' || !GUID_PATTERN.test(guid) || typeof userName !== 'string') {
    return NextResponse.json({ error: 'Invalid Guid or UserName' }, { status: 400 });
  }
  // Only what the client sends goes upstream; the account's other fields stay out of reach
  const body = { Guid: guid, UserName: userName.slice(0, USER_NAME_MAX) };

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...loopbackHeaders,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'PeerTime instant-account upstream unavailable',
        url,
        detail: formatUpstreamFetchError(error),
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
  });
}
