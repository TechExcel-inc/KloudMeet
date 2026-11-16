import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import {
  forbidden,
  isAuthError,
  requireSession,
} from '@/lib/apiAuth';
import { getRoomServiceClient, removeParticipantFromRoom } from '@/lib/livekitRooms';
import { parseKloudMemberIdFromIdentity } from '@/lib/meetingOwner';
import { findPersonalRoomOwner, resolveCanonicalRoomName } from '@/lib/personalRoom';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

/**
 * Meeting owner: remove a participant from the LiveKit room.
 * Body: { identity: string }
 *
 * Co-host / transferred-host roles are client-side only, so they are not trusted here.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
) {
  return runWithLocale(request, async () => {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;

    const resolvedParams = await params;
    const roomNameParam = resolvedParams?.roomName;
    if (!roomNameParam) {
      return apiJson({ error: 'Room name not provided' }, { status: 400 });
    }

    let body: { identity?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return apiJson({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const targetIdentity = typeof body.identity === 'string' ? body.identity.trim() : '';
    if (!targetIdentity) {
      return apiJson({ error: 'identity is required' }, { status: 400 });
    }

    const livekitRoomName = await resolveCanonicalRoomName(roomNameParam);
    const meeting = await prisma.meeting.findUnique({ where: { roomName: livekitRoomName } });
    const personalOwner = meeting ? null : await findPersonalRoomOwner(livekitRoomName);

    if (!meeting && !personalOwner) {
      return apiJson({ error: 'Meeting not found' }, { status: 404 });
    }

    const client = getRoomServiceClient();
    if (!client) {
      return apiJson({ error: 'LiveKit not configured' }, { status: 503 });
    }

    let participants;
    try {
      participants = await client.listParticipants(livekitRoomName);
    } catch {
      return apiJson({ error: 'Room not active' }, { status: 404 });
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
      return apiJson({ error: 'Participant not found in room' }, { status: 404 });
    }

    const ownerMemberId = meeting?.createdByMemberId ?? personalOwner?.id ?? null;
    if (ownerMemberId !== member.id) {
      return forbidden('Only the meeting host can remove participants');
    }

    const ok = await removeParticipantFromRoom(livekitRoomName, targetIdentity);
    if (!ok) {
      return apiJson({ error: 'Failed to remove participant' }, { status: 500 });
    }

    return apiJson({ success: true });
  } catch (e) {
    console.error('[remove-participant]', e);
    return apiJson({ error: 'Internal error' }, { status: 500 });
  }

  });
}
