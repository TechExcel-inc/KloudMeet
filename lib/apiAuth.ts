import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import type { TeamMember } from '@prisma/client';

export function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function isAuthError(v: TeamMember | NextResponse): v is NextResponse {
  return v instanceof NextResponse;
}

/** Requires valid Bearer session; returns TeamMember or 401 response. */
export async function requireSession(
  request: NextRequest,
): Promise<TeamMember | NextResponse> {
  const member = await getSessionTeamMember(request);
  if (!member) return unauthorized();
  return member;
}

/** Requires account OWNER / CO_OWNER. */
export async function requireAccountAdmin(
  request: NextRequest,
): Promise<TeamMember | NextResponse> {
  const member = await requireSession(request);
  if (isAuthError(member)) return member;

  const admin = await prisma.accountOwnerAndAdmin.findFirst({
    where: { teamMemberId: member.id, status: 'ACTIVE' },
  });
  if (!admin) return forbidden('Admin access required');
  return member;
}

export function canManageMeeting(
  memberId: number,
  meeting: { createdByMemberId: number },
): boolean {
  return meeting.createdByMemberId === memberId;
}

export async function canAccessRecording(
  memberId: number,
  recording: { teamMemberId: number | null; meetingId: number },
): Promise<boolean> {
  if (recording.teamMemberId === memberId) return true;

  const meeting = await prisma.meeting.findUnique({
    where: { id: recording.meetingId },
    select: { createdByMemberId: true },
  });
  if (!meeting) return false;
  if (meeting.createdByMemberId === memberId) return true;

  const participated = await prisma.meetingParticipant.findFirst({
    where: { meetingId: recording.meetingId, teamMemberId: memberId },
  });
  return !!participated;
}

/** Public fields for pre-join / anonymous join flow. */
export function publicMeetingPayload(meeting: Record<string, unknown>) {
  const { recordings: _r, ...rest } = meeting;
  return { ...rest, recordings: [] };
}
