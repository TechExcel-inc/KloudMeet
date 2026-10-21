import { NextRequest, NextResponse } from 'next/server';
import { TokenVerifier } from 'livekit-server-sdk';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { findMeetingByRoomName } from '@/lib/meetingRoomIsActive';
import {
  getParticipantLiveDocAi,
  setParticipantLiveDocAi,
} from '@/lib/meetingRoomView';
import { parseKloudMemberIdFromIdentity } from '@/lib/meetingOwner';
import { resolveCanonicalRoomName } from '@/lib/personalRoom';

function getBearerToken(request: NextRequest): string {
  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

async function verifyLiveKitHost(
  request: NextRequest,
  roomName: string,
  ownerMemberId: number,
): Promise<boolean> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const token = getBearerToken(request);
  if (!apiKey || !apiSecret || !token) return false;

  try {
    const claims = await new TokenVerifier(apiKey, apiSecret).verify(token);
    const identity = claims.sub;
    const memberId = parseKloudMemberIdFromIdentity(
      typeof identity === 'string' ? identity : null,
    );
    return (
      memberId === ownerMemberId &&
      claims.video?.room === roomName &&
      claims.video?.roomJoin === true
    );
  } catch {
    return false;
  }
}

/** GET — 主持人准备页读取普通参会者是否显示文档 AI。未设置时为显示。 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
): Promise<NextResponse> {
  try {
    const { roomName } = await params;
    if (!roomName) {
      return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });
    }

    const member = await getSessionTeamMember(request);
    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canonical = await resolveCanonicalRoomName(roomName);
    const meeting = await findMeetingByRoomName(canonical);
    if (!meeting || meeting.createdByMemberId !== member.id) {
      return NextResponse.json({ show: true });
    }

    const show = await getParticipantLiveDocAi(canonical);
    return NextResponse.json({ show });
  } catch (error) {
    console.error('[GET /api/meetings/[roomName]/participant-livedoc]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST — 主持人入会后写入房间 metadata，后加入的普通参会者据此隐藏文档 AI。 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
): Promise<NextResponse> {
  try {
    const { roomName } = await params;
    if (!roomName) {
      return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });
    }

    const canonical = await resolveCanonicalRoomName(roomName);
    const meeting = await findMeetingByRoomName(canonical);
    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const allowed = await verifyLiveKitHost(request, canonical, meeting.createdByMemberId);
    if (!allowed) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let payload: { show?: unknown };
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (typeof payload.show !== 'boolean') {
      return NextResponse.json({ error: 'Invalid show' }, { status: 400 });
    }

    const ok = await setParticipantLiveDocAi(canonical, payload.show);
    if (!ok) {
      return NextResponse.json({ error: 'Failed to update room' }, { status: 502 });
    }

    return NextResponse.json({ show: payload.show });
  } catch (error) {
    console.error('[POST /api/meetings/[roomName]/participant-livedoc]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
