import { NextRequest, NextResponse } from 'next/server';
import { TokenVerifier } from 'livekit-server-sdk';
import { prisma } from '@/lib/db';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { forbidden, unauthorized } from '@/lib/apiAuth';
import { ROOM_TOKEN_HEADER } from '@/lib/roomAuth';

export type RoomTokenClaims = { room: string; identity: string };

/** Verify the LiveKit participant JWT sent in `X-LiveKit-Token`; null when absent or invalid. */
export async function verifyRoomTokenHeader(request: NextRequest): Promise<RoomTokenClaims | null> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const token = request.headers.get(ROOM_TOKEN_HEADER)?.trim() ?? '';
  if (!apiKey || !apiSecret || !token) return null;

  try {
    const claims = await new TokenVerifier(apiKey, apiSecret).verify(token);
    const room = claims.video?.room;
    if (typeof claims.sub !== 'string' || typeof room !== 'string' || claims.video?.roomJoin !== true) {
      return null;
    }
    return { room, identity: claims.sub };
  } catch {
    return null;
  }
}

/**
 * Caller is in some meeting (valid room token) or logged in.
 * Gates server-paid endpoints (STT tokens, translation) used by in-room clients.
 */
export async function requireRoomOrSession(
  request: NextRequest,
): Promise<{ memberId: number | null; room: string | null } | NextResponse> {
  const roomClaims = await verifyRoomTokenHeader(request);
  if (roomClaims) return { memberId: null, room: roomClaims.room };
  const member = await getSessionTeamMember(request);
  if (member) return { memberId: member.id, room: null };
  return unauthorized();
}

type MeetingAccessMeeting = { id: number; roomName: string; createdByMemberId: number };

/**
 * Caller may read/write this meeting's in-room data: a room token for the meeting's room,
 * or a logged-in member who hosted or joined it.
 */
export async function requireMeetingAccess(
  request: NextRequest,
  meetingId: number,
): Promise<{ meeting: MeetingAccessMeeting; memberId: number | null } | NextResponse> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, roomName: true, createdByMemberId: true },
  });
  if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });

  const roomClaims = await verifyRoomTokenHeader(request);
  // Room lookups elsewhere are case-insensitive (see roomNameVariants), so compare the same way.
  if (roomClaims && roomClaims.room.toLowerCase() === meeting.roomName.trim().toLowerCase()) {
    return { meeting, memberId: null };
  }

  const member = await getSessionTeamMember(request);
  if (!member) return unauthorized();
  if (meeting.createdByMemberId === member.id) return { meeting, memberId: member.id };

  const participated = await prisma.meetingParticipant.findFirst({
    where: { meetingId: meeting.id, teamMemberId: member.id },
    select: { id: true },
  });
  if (!participated) return forbidden();
  return { meeting, memberId: member.id };
}

/** Only the meeting's host (creator) may perform this action. */
export async function requireMeetingHost(
  request: NextRequest,
  meetingId: number,
): Promise<{ meeting: MeetingAccessMeeting; memberId: number } | NextResponse> {
  const member = await getSessionTeamMember(request);
  if (!member) return unauthorized();
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, roomName: true, createdByMemberId: true },
  });
  if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
  if (meeting.createdByMemberId !== member.id) return forbidden('Host access required');
  return { meeting, memberId: member.id };
}
