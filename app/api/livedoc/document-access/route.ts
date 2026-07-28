import {
  buildMeetingServerUrl,
  ensureHostBypassesProxy,
  formatUpstreamFetchError,
} from '@/lib/peertimeUpstream';
import { NextRequest, NextResponse } from 'next/server';
import { isAuthError, requireSession } from '@/lib/apiAuth';

/**
 * Proxies MeetingServer meeting_document/item with PeerTime UserToken so KloudMeet
 * post-meeting chat can enforce the same ACL before opening a livedoc card.
 *
 * Token resolution: explicit UserToken header (instant / client) → SSO cookie.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const member = await requireSession(request);
  if (isAuthError(member)) return member;

  const itemIdRaw = request.nextUrl.searchParams.get('itemId');
  const itemId = itemIdRaw ? Number(itemIdRaw) : NaN;
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return NextResponse.json({ error: 'Invalid itemId' }, { status: 400 });
  }

  const headerToken =
    request.headers.get('UserToken')?.trim() ||
    request.headers.get('usertoken')?.trim() ||
    '';
  const sso = request.cookies.get('kloud_sso_token')?.value;
  let userToken = headerToken;
  if (!userToken && sso) {
    try {
      userToken = decodeURIComponent(sso);
    } catch {
      userToken = sso;
    }
  }
  if (!userToken) {
    return NextResponse.json(
      { error: 'Missing PeerTime UserToken; sign in via Kloud or rejoin a meeting first' },
      { status: 403 },
    );
  }

  const { url, headers: loopbackHeaders } = buildMeetingServerUrl(
    `/meeting_document/item?itemId=${encodeURIComponent(String(Math.floor(itemId)))}`,
  );
  ensureHostBypassesProxy(url);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'GET',
      headers: {
        UserToken: userToken,
        ...loopbackHeaders,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'MeetingServer document access unavailable',
        detail: formatUpstreamFetchError(error),
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  let payload: { code?: number; msg?: string } | null = null;
  try {
    payload = JSON.parse(text) as { code?: number; msg?: string };
  } catch {
    // non-json
  }

  if (upstream.status === 403 || payload?.code === 26) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!upstream.ok || (payload && payload.code !== 0 && payload.code !== undefined)) {
    return NextResponse.json(
      { error: payload?.msg ?? 'Document access denied', upstreamStatus: upstream.status },
      { status: upstream.status >= 400 ? upstream.status : 403 },
    );
  }

  return new NextResponse(text, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
