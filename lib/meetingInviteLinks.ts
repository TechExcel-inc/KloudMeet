/**
 * Each invited attendee's own join link (/rooms/<room>?invite=<token>), stored on MeetingInvitee.
 * For a Protected meeting the link lets them in without signing in (lib/meetingAccess.ts).
 */
import crypto from 'crypto';
import { prisma } from './db';
import { meetingJoinUrl } from './calendar/links';

/** Query parameter of an attendee's own join link. */
export const INVITE_PARAM = 'invite';

export const JOIN_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function newJoinToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function inviteJoinUrl(origin: string, roomName: string, joinToken: string | null | undefined): string {
  const base = meetingJoinUrl(origin, roomName);
  return joinToken ? `${base}?${INVITE_PARAM}=${encodeURIComponent(joinToken)}` : base;
}

/** Gives every attendee of the meeting without a join link one. */
export async function ensureInviteJoinTokens(meetingId: number): Promise<void> {
  const missing = await prisma.meetingInvitee.findMany({
    where: { meetingId, joinToken: null },
    select: { id: true },
  });
  for (const row of missing) {
    await prisma.meetingInvitee.updateMany({
      where: { id: row.id, joinToken: null },
      data: { joinToken: newJoinToken() },
    });
  }
}
