import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_PEER_TIME = 'https://api.peertime.cn';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const base = process.env.PEER_TIME_API_BASE_URL ?? DEFAULT_PEER_TIME;
  const url = `${base.replace(/\/$/, '')}/peertime/V1/User/CreateOrUpdateInstantAccout4Syncroom`;

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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown upstream error';
    return NextResponse.json(
      {
        error: 'PeerTime instant-account upstream unavailable',
        url,
        detail: message,
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
