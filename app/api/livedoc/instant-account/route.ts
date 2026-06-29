import {
  buildPeerTimeUrl,
  ensureHostBypassesProxy,
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
    const message = error instanceof Error ? error.message : 'Unknown upstream error';
    const cause =
      error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;
    return NextResponse.json(
      {
        error: 'PeerTime instant-account upstream unavailable',
        url,
        detail: cause ? `${message} (${cause})` : message,
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
