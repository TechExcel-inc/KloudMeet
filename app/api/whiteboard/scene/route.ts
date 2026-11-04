import {
  buildMeetingServerUrl,
  ensureHostBypassesProxy,
  formatUpstreamFetchError,
} from '@/lib/peertimeUpstream';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Excalidraw board scene: proxies MeetingServer /whiteboard/scene with the caller's PeerTime
 * UserToken (the same instant-account token the LiveDoc stage uses). MeetingServer checks the
 * token and that the attachment is an Excalidraw board.
 */

function userTokenOf(request: NextRequest): string | null {
  return request.headers.get('UserToken')?.trim() || request.headers.get('usertoken')?.trim() || null;
}

async function forward(path: string, init: RequestInit & { headers: Record<string, string> }) {
  const { url, headers: loopbackHeaders } = buildMeetingServerUrl(path);
  ensureHostBypassesProxy(url);
  let upstream: Response;
  try {
    upstream = await fetch(url, { ...init, headers: { ...init.headers, ...loopbackHeaders } });
  } catch (error) {
    return NextResponse.json(
      { error: 'MeetingServer whiteboard unavailable', detail: formatUpstreamFetchError(error) },
      { status: 502 },
    );
  }
  // MeetingServer reports errors as { code, msg, data } with HTTP 200; pass them through as-is
  return new NextResponse(await upstream.text(), {
    status: upstream.ok ? 200 : upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const userToken = userTokenOf(request);
  if (!userToken) return NextResponse.json({ error: 'Missing UserToken header' }, { status: 400 });
  const attachmentId = Number(request.nextUrl.searchParams.get('attachmentId'));
  if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
    return NextResponse.json({ error: 'Invalid attachmentId' }, { status: 400 });
  }
  return forward(`/whiteboard/scene?attachmentId=${attachmentId}`, {
    method: 'GET',
    headers: { UserToken: userToken },
    cache: 'no-store',
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const userToken = userTokenOf(request);
  if (!userToken) return NextResponse.json({ error: 'Missing UserToken header' }, { status: 400 });
  let body: {
    attachmentId?: unknown;
    baseVersion?: unknown;
    scene?: unknown;
    textContent?: unknown;
    elementCount?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const attachmentId = Number(body.attachmentId);
  const baseVersion = Number(body.baseVersion);
  if (
    !Number.isInteger(attachmentId) ||
    attachmentId <= 0 ||
    !Number.isInteger(baseVersion) ||
    baseVersion < 0 ||
    typeof body.scene !== 'string' ||
    !body.scene
  ) {
    return NextResponse.json({ error: 'Invalid whiteboard scene' }, { status: 400 });
  }
  return forward('/whiteboard/scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', UserToken: userToken },
    body: JSON.stringify({
      attachmentId,
      baseVersion,
      scene: body.scene,
      textContent: typeof body.textContent === 'string' ? body.textContent : '',
      elementCount: Number.isInteger(body.elementCount) ? body.elementCount : 0,
    }),
  });
}
