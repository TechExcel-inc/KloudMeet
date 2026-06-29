import {
  buildPeerTimeUrl,
  ensureHostBypassesProxy,
  formatUpstreamFetchError,
} from '@/lib/peertimeUpstream';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { url, headers: loopbackHeaders } = buildPeerTimeUrl(
    '/peertime/V1/User/CreateOrUpdateInstantAccout4Syncroom',
  );
  ensureHostBypassesProxy(url);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

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
