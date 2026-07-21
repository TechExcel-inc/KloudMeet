import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  forbidden,
  isAuthError,
  requireSession,
} from '@/lib/apiAuth';
import { getRoomServiceClient, removeParticipantFromRoom } from '@/lib/livekitRooms';
import { parseKloudMemberIdFromIdentity } from '@/lib/meetingOwner';
import { findPersonalRoomOwner, resolveCanonicalRoomName } from '@/lib/personalRoom';

/**
 * Host / Co-host: remove a participant from the LiveKit room.
 * Body: { identity: string; hostIdentity?: string | null; cohostIdentities?: string[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
) {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;

    const resolvedParams = await params;
    const roomNameParam = resolvedParams?.roomName;
    if (!roomNameParam) {
      return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });
    }

    let body: {
      identity?: string;
      hostIdentity?: string | null;
      cohostIdentities?: string[];
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const targetIdentity = typeof body.identity === 'string' ? body.identity.trim() : '';
    if (!targetIdentity) {
      return NextResponse.json({ error: 'identity is required' }, { status: 400 });
    }

    const livekitRoomName = await resolveCanonicalRoomName(roomNameParam);
    const meeting = await prisma.meeting.findUnique({ where: { roomName: livekitRoomName } });
    const personalOwner = meeting ? null : await findPersonalRoomOwner(livekitRoomName);

    if (!meeting && !personalOwner) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const client = getRoomServiceClient();
    if (!client) {
      return NextResponse.json({ error: 'LiveKit not configured' }, { status: 503 });
    }

    let participants;
    try {
      participants = await client.listParticipants(livekitRoomName);
    } catch {
      return NextResponse.json({ error: 'Room not active' }, { status: 404 });
    }

    const caller = participants.find(
      (p) => parseKloudMemberIdFromIdentity(p.identity) === member.id,
    );
    if (!caller) {
      return forbidden('You must be in the meeting to remove participants');
    }

    if (caller.identity === targetIdentity) {
      return forbidden('Cannot remove yourself');
    }

    const target = participants.find((p) => p.identity === targetIdentity);
    if (!target) {
      return NextResponse.json({ error: 'Participant not found in room' }, { status: 404 });
    }

    const ownerMemberId = meeting?.createdByMemberId ?? personalOwner?.id ?? null;
    const isMeetingOwner = ownerMemberId === member.id;
    const hostIdentity = typeof body.hostIdentity === 'string' ? body.hostIdentity : null;
    const cohostIdentities = Array.isArray(body.cohostIdentities)
      ? body.cohostIdentities.filter((id): id is string => typeof id === 'string')
      : [];
    const isClaimedManager =
      caller.identity === hostIdentity || cohostIdentities.includes(caller.identity);

    if (!isMeetingOwner && !isClaimedManager) {
      return forbidden('Only the host or co-host can remove participants');
    }

    // Do not allow removing the LiveKit host via co-host
    if (hostIdentity && targetIdentity === hostIdentity && caller.identity !== hostIdentity) {
      return forbidden('Cannot remove the host');
    }

    const ok = await removeParticipantFromRoom(livekitRoomName, targetIdentity);
    if (!ok) {
      return NextResponse.json({ error: 'Failed to remove participant' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[remove-participant]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
