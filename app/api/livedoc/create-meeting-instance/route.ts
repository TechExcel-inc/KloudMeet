import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_MEETING_SERVER = 'https://wss.peertime.cn/MeetingServer';

function ensureHostBypassesProxy(targetUrl: string): void {
  let host: string;
  try {
    host = new URL(targetUrl).hostname;
  } catch {
    return;
  }
  if (!host) return;

  const appendHost = (current: string | undefined): string => {
    const entries = (current ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!entries.includes(host)) entries.push(host);
    return entries.join(',');
  };

  process.env.NO_PROXY = appendHost(process.env.NO_PROXY);
  process.env.no_proxy = appendHost(process.env.no_proxy);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const meetingBase = process.env.LIVEDOC_SERVER_API_BASE_URL ?? DEFAULT_MEETING_SERVER;
  const url = `${meetingBase.replace(/\/$/, '')}/jitsi/create_meeting_instance`;
  ensureHostBypassesProxy(url);

  const userToken = request.headers.get('UserToken') ?? request.headers.get('usertoken');
  if (!userToken) {
    return NextResponse.json({ error: 'Missing UserToken header' }, { status: 400 });
  }

  let payload: { jitsiInstanceId?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof payload.jitsiInstanceId !== 'string' || !payload.jitsiInstanceId) {
    return NextResponse.json({ error: 'Missing jitsiInstanceId' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        UserToken: userToken,
      },
      body: JSON.stringify({
        jitsiInstanceId: payload.jitsiInstanceId,
        companyId: 3255,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown upstream error';
    return NextResponse.json(
      {
        error: 'LiveDoc meeting-server upstream unavailable',
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
