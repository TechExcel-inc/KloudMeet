import { NextRequest, NextResponse } from 'next/server';
import { TokenVerifier } from 'livekit-server-sdk';
import { prisma } from '@/lib/db';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { resolveMemberAccountId } from '@/lib/peerTimeCompany';

function getBearerToken(request: NextRequest): string {
  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

async function verifyRoomParticipant(
  request: NextRequest,
  roomName: string,
): Promise<boolean> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const token = getBearerToken(request);
  if (!apiKey || !apiSecret || !token) return false;

  try {
    const claims = await new TokenVerifier(apiKey, apiSecret).verify(token);
    const identity = claims.sub;
    return (
      typeof identity === 'string' &&
      !!identity &&
      claims.video?.room === roomName &&
      claims.video?.roomJoin === true
    );
  } catch {
    return false;
  }
}

/** POST — 将 PeerTime lessonId（LiveDoc instance）绑定到 KloudMeet Meeting。 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
): Promise<NextResponse> {
  try {
    const { roomName } = await params;
    if (!roomName) {
      return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });
    }

    const allowed = await verifyRoomParticipant(request, roomName);
    if (!allowed) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let payload: { livedocInstanceId?: string | number };
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const kloudMeetingId =
      typeof payload.livedocInstanceId === 'number'
        ? payload.livedocInstanceId
        : typeof payload.livedocInstanceId === 'string' && payload.livedocInstanceId
          ? Number(payload.livedocInstanceId)
          : NaN;
    if (!Number.isFinite(kloudMeetingId) || kloudMeetingId <= 0) {
      return NextResponse.json({ error: 'Invalid livedocInstanceId' }, { status: 400 });
    }

    const meeting = await prisma.meeting.findUnique({
      where: { roomName },
      select: { id: true, accountId: true, kloudMeetingId: true, createdByMemberId: true },
    });
    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const data: { kloudMeetingId: number; accountId?: number } = {
      kloudMeetingId: Math.floor(kloudMeetingId),
    };

    if (!meeting.accountId) {
      const sessionMember = await getSessionTeamMember(request);
      const memberId = sessionMember?.id ?? meeting.createdByMemberId;
      if (memberId) {
        const accountId = await resolveMemberAccountId(memberId);
        if (accountId) data.accountId = accountId;
      }
    }

    const updated = await prisma.meeting.update({
      where: { id: meeting.id },
      data,
      select: { id: true, roomName: true, kloudMeetingId: true, accountId: true },
    });

    return NextResponse.json({ meeting: updated });
  } catch (error) {
    console.error('[POST /api/meetings/[roomName]/bind-livedoc]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
