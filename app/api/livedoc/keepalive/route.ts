import {
  buildMeetingServerUrl,
  ensureHostBypassesProxy,
  formatUpstreamFetchError,
} from '@/lib/peertimeUpstream';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { url, headers: loopbackHeaders } = buildMeetingServerUrl(
    '/jitsi/skymeet_livedoc_keepalive',
  );
  ensureHostBypassesProxy(url);

  const userToken = request.headers.get('UserToken') ?? request.headers.get('usertoken');
  if (!userToken) {
    return NextResponse.json({ error: 'Missing UserToken header' }, { status: 400 });
  }

  let payload: { jitsiInstanceId?: string; livedocMeetingId?: number | string | null };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof payload.jitsiInstanceId !== 'string' || !payload.jitsiInstanceId) {
    return NextResponse.json({ error: 'Missing jitsiInstanceId' }, { status: 400 });
  }

  const livedocMeetingId =
    typeof payload.livedocMeetingId === 'number'
      ? payload.livedocMeetingId
      : typeof payload.livedocMeetingId === 'string' && payload.livedocMeetingId
        ? Number(payload.livedocMeetingId)
        : null;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        UserToken: userToken,
        ...loopbackHeaders,
      },
      body: JSON.stringify({
        jitsiInstanceId: payload.jitsiInstanceId,
        livedocMeetingId: Number.isFinite(livedocMeetingId) ? livedocMeetingId : null,
        companyId: 3255,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'LiveDoc keepalive upstream unavailable',
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
