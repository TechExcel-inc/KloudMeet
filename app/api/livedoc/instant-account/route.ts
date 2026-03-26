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

  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
  });
}
