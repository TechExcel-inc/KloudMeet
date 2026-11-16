import {
  buildMeetingServerUrl,
  ensureHostBypassesProxy,
  formatUpstreamFetchError,
} from '@/lib/peertimeUpstream';
import { resolvePeerTimeCompanyId } from '@/lib/peerTimeCompany';
import { NextRequest, NextResponse } from 'next/server';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runWithLocale(request, async () => {
  const { url, headers: loopbackHeaders } = buildMeetingServerUrl(
    '/jitsi/create_meeting_instance',
  );
  ensureHostBypassesProxy(url);

  const userToken = request.headers.get('UserToken') ?? request.headers.get('usertoken');
  if (!userToken) {
    return apiJson({ error: 'Missing UserToken header' }, { status: 400 });
  }

  let payload: { jitsiInstanceId?: string; companyId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return apiJson({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof payload.jitsiInstanceId !== 'string' || !payload.jitsiInstanceId) {
    return apiJson({ error: 'Missing jitsiInstanceId' }, { status: 400 });
  }

  const companyId = await resolvePeerTimeCompanyId({
    request,
    userToken,
    explicitCompanyId: payload.companyId,
  });

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
        companyId,
      }),
    });
  } catch (error) {
    return apiJson(
      {
        error: 'LiveDoc meeting-server upstream unavailable',
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

  });
}
