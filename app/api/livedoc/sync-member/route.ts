import {
  buildMeetingServerUrl,
  ensureHostBypassesProxy,
  formatUpstreamFetchError,
} from '@/lib/peertimeUpstream';
import { fetchPeerTimeUserId } from '@/lib/peerTimeCompany';
import { NextRequest, NextResponse } from 'next/server';

/** Auditor — PeerTime 普通参会人角色，供会后「参加过」判定。 */
const ROLE_AUDITOR = 3;

/**
 * 将当前 UserToken 对应用户同步为该场 LiveDoc 会议的 LessonMember。
 * 幂等：上游 add_members 会跳过已存在成员。
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const userToken = request.headers.get('UserToken') ?? request.headers.get('usertoken');
  if (!userToken) {
    return NextResponse.json({ error: 'Missing UserToken header' }, { status: 400 });
  }

  let payload: { livedocInstanceId?: string | number };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const lessonId =
    typeof payload.livedocInstanceId === 'number'
      ? payload.livedocInstanceId
      : typeof payload.livedocInstanceId === 'string' && payload.livedocInstanceId
        ? Number(payload.livedocInstanceId)
        : NaN;
  if (!Number.isFinite(lessonId) || lessonId <= 0) {
    return NextResponse.json({ error: 'Invalid livedocInstanceId' }, { status: 400 });
  }

  const memberId = await fetchPeerTimeUserId(userToken);
  if (!memberId) {
    return NextResponse.json({ error: 'Unable to resolve PeerTime user' }, { status: 400 });
  }

  const { url, headers: loopbackHeaders } = buildMeetingServerUrl('/member/add_members');
  ensureHostBypassesProxy(url);

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
        meetingId: lessonId,
        members: [{ memberId, role: ROLE_AUDITOR }],
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'MeetingServer add_members unavailable',
        url,
        detail: formatUpstreamFetchError(error),
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
    });
  }

  return NextResponse.json({ ok: true, lessonId, memberId });
}
