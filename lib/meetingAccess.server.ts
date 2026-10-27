/**
 * Database side of meeting access levels (rules in lib/meetingAccess.ts).
 * Migration: prisma/add_meeting_access_levels.sql.
 */
import type { Recording, TeamMember } from '@prisma/client';
import { DataPacket_Kind } from '@livekit/protocol';
import { prisma } from './db';
import { JOIN_TOKEN_RE } from './meetingInviteLinks';
import { memberIdOfIdentity, parseMeetingRoles } from './recordingControls';
import { findPersonalRoomOwner, resolveCanonicalRoomName } from './personalRoom';
import { followOwnerLiveRoom } from './oneMeetingPerHost';
import { getRoomServiceClient } from './livekitRooms';
import { parseKloudMemberIdFromIdentity } from './meetingOwner';
import {
  DEFAULT_ACCESS_LEVEL,
  JOIN_REQUESTS_TOPIC,
  decideJoin,
  decideRecordingView,
  parseAccessLevel,
  parseJoinRequestStatus,
  type JoinDecision,
  type JoinFacts,
  type MeetingAccessLevel,
  type RecordingDecision,
} from './meetingAccess';

export { INVITE_PARAM } from './meetingInviteLinks';

/** Active member, owner or admin of the company account. */
export async function isCompanyMember(accountId: number | null | undefined, memberId: number): Promise<boolean> {
  if (!accountId) return false;
  const [membership, admin] = await Promise.all([
    prisma.accountMembership.findFirst({
      where: { accountId, teamMemberId: memberId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    }),
    prisma.accountOwnerAndAdmin.findFirst({
      where: { accountId, teamMemberId: memberId, status: 'ACTIVE' },
      select: { id: true },
    }),
  ]);
  return Boolean(membership || admin);
}

/** Member ids of the current host and co-hosts (from the roles the host's client reports). */
export function hostLikeMemberIds(meetingRoles: unknown): number[] {
  const roles = parseMeetingRoles(meetingRoles);
  return [roles.host, ...roles.cohosts]
    .map((identity) => memberIdOfIdentity(identity))
    .filter((id): id is number => id !== null);
}

/** May answer knocks: the meeting's creator, the current host and co-hosts. */
export function mayAdmit(memberId: number, meeting: { createdByMemberId: number; meetingRoles: unknown }): boolean {
  return memberId === meeting.createdByMemberId || hostLikeMemberIds(meeting.meetingRoles).includes(memberId);
}

export async function findInviteByToken(meetingId: number, token: string | null | undefined) {
  if (!token || !JOIN_TOKEN_RE.test(token)) return null;
  return prisma.meetingInvitee.findFirst({
    where: { meetingId, joinToken: token },
    select: { id: true, email: true },
  });
}

/**
 * The LiveKit recorder bot opens the meeting page with the recording's activity token. The
 * record API stores the token right after LiveKit accepts the egress, so a fast bot may ask a
 * moment before the row exists: wait a few seconds for it.
 */
export async function isRecorderToken(meetingId: number, token: string | null | undefined, waitMs = 8_000): Promise<boolean> {
  // Tokens are newShareKey(): 32 random bytes, base64url. Anything else isn't worth waiting for.
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const rec = await prisma.recording.findFirst({
      where: { meetingId, activityToken: token, deletedAt: null },
      select: { status: true },
    });
    if (rec) return rec.status !== 'FAILED';
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export interface MeetingForAccess {
  id: number;
  accountId: number | null;
  createdByMemberId: number;
  accessLevel: string | null;
  meetingRoles: unknown;
}

export const meetingAccessSelect = {
  id: true,
  accountId: true,
  createdByMemberId: true,
  accessLevel: true,
  meetingRoles: true,
} as const;

export async function gatherJoinFacts(opts: {
  meeting: MeetingForAccess;
  member: Pick<TeamMember, 'id' | 'email'> | null;
  inviteToken?: string | null;
  recorderToken?: string | null;
}): Promise<JoinFacts> {
  const { meeting, member } = opts;
  const level = parseAccessLevel(meeting.accessLevel);
  const base: JoinFacts = {
    level,
    isRecorder: false,
    signedIn: Boolean(member),
    isHost: Boolean(member && member.id === meeting.createdByMemberId),
    isCohost: false,
    isCompanyMember: false,
    invitedByEmail: false,
    hasInviteLink: false,
    joinedBefore: false,
    request: null,
  };
  // Public and legacy meetings need no lookups.
  if (!level || level === 'PUBLIC' || base.isHost) return base;

  if (!member && opts.recorderToken) {
    base.isRecorder = await isRecorderToken(meeting.id, opts.recorderToken);
    if (base.isRecorder) return base;
  }

  const email = member?.email?.trim().toLowerCase() || null;
  const [invite, byEmail, company, joined, request] = await Promise.all([
    findInviteByToken(meeting.id, opts.inviteToken),
    member && email
      ? prisma.meetingInvitee.findFirst({ where: { meetingId: meeting.id, email }, select: { id: true } })
      : null,
    member ? isCompanyMember(meeting.accountId, member.id) : false,
    member
      ? prisma.meetingParticipant.findFirst({
          where: { meetingId: meeting.id, teamMemberId: member.id },
          select: { id: true },
        })
      : null,
    member
      ? prisma.meetingJoinRequest.findUnique({
          where: { meetingId_teamMemberId: { meetingId: meeting.id, teamMemberId: member.id } },
          select: { status: true },
        })
      : null,
  ]);
  return {
    ...base,
    isCohost: Boolean(member && hostLikeMemberIds(meeting.meetingRoles).includes(member.id)),
    isCompanyMember: company,
    invitedByEmail: Boolean(byEmail),
    hasInviteLink: Boolean(invite),
    joinedBefore: Boolean(joined),
    request: parseJoinRequestStatus(request?.status),
  };
}

export async function evaluateJoin(opts: Parameters<typeof gatherJoinFacts>[0]): Promise<{
  decision: JoinDecision;
  facts: JoinFacts;
}> {
  const facts = await gatherJoinFacts(opts);
  return { decision: decideJoin(facts), facts };
}

/**
 * Level for a new session of a personal meeting ID: the same as its previous session
 * (Public the first time, or when the previous one was a legacy meeting).
 */
export function inheritedAccessLevel(previous: string | null | undefined): MeetingAccessLevel {
  return parseAccessLevel(previous) ?? DEFAULT_ACCESS_LEVEL;
}

/** The archived sessions of a personal room are renamed `<room>_<meetingId>`. */
export async function previousPersonalRoomLevel(roomName: string, ownerId: number): Promise<string | null> {
  const previous = await prisma.meeting.findFirst({
    where: { createdByMemberId: ownerId, roomName: { startsWith: `${roomName}_` } },
    orderBy: { id: 'desc' },
    select: { accessLevel: true },
  });
  return previous?.accessLevel ?? null;
}

const CLOSED_STATUSES = ['ENDED', 'CANCELED'];

export interface AccessTarget extends MeetingForAccess {
  roomName: string;
  title: string | null;
  status: string;
  host: { id: number; fullName: string | null; username: string; avatarUrl: string | null; email: string | null };
  /** No session row yet: the next session of a personal meeting ID (id is 0, nothing to look up). */
  upcomingPersonalSession: boolean;
}

/**
 * The meeting a link leads to, resolved the same way connection-details does (canonical
 * name, a personal ID follows its owner's live meeting). For a personal ID with no open
 * session, describes the session the next join would start, at its inherited level.
 */
export async function resolveAccessTarget(roomParam: string): Promise<AccessTarget | null> {
  const trimmed = roomParam.trim();
  if (!trimmed) return null;
  const canonical = await resolveCanonicalRoomName(trimmed);
  const roomName = (await followOwnerLiveRoom(canonical)) ?? canonical;
  const hostSelect = { select: { id: true, fullName: true, username: true, avatarUrl: true, email: true } };
  const select = {
    ...meetingAccessSelect,
    roomName: true,
    title: true,
    status: true,
    deletedAt: true,
    createdByMember: hostSelect,
  } as const;
  const meeting =
    (await prisma.meeting.findUnique({ where: { roomName }, select })) ??
    (roomName !== trimmed ? await prisma.meeting.findUnique({ where: { roomName: trimmed }, select }) : null);

  const owner = await findPersonalRoomOwner(roomName);
  const closed = !meeting || Boolean(meeting.deletedAt) || CLOSED_STATUSES.includes(meeting.status);
  if (owner && closed) {
    const { resolveMemberAccountId } = await import('@/lib/peerTimeCompany');
    const previous =
      meeting?.createdByMemberId === owner.id ? meeting.accessLevel : await previousPersonalRoomLevel(roomName, owner.id);
    return {
      id: 0,
      accountId: await resolveMemberAccountId(owner.id),
      createdByMemberId: owner.id,
      accessLevel: inheritedAccessLevel(previous),
      meetingRoles: null,
      roomName,
      title: `${owner.fullName || owner.username}'s Room`,
      status: 'ACTIVE',
      host: {
        id: owner.id,
        fullName: owner.fullName,
        username: owner.username,
        avatarUrl: owner.avatarUrl,
        email: owner.email,
      },
      upcomingPersonalSession: true,
    };
  }
  if (!meeting) return null;
  const { createdByMember, deletedAt: _deletedAt, ...rest } = meeting;
  return { ...rest, host: createdByMember, upcomingPersonalSession: false };
}

/** Whether the creator, the current host or a co-host is in the LiveKit room (null: unknown). */
export async function hostIsPresent(meeting: Pick<AccessTarget, 'roomName' | 'createdByMemberId' | 'meetingRoles'>): Promise<{
  hostPresent: boolean | null;
  participantCount: number | null;
}> {
  const client = getRoomServiceClient();
  if (!client) return { hostPresent: null, participantCount: null };
  try {
    const participants = await Promise.race([
      client.listParticipants(meeting.roomName),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('listParticipants timed out')), 4_000)),
    ]);
    const hostIds = new Set([meeting.createdByMemberId, ...hostLikeMemberIds(meeting.meetingRoles)]);
    const people = participants.filter((p) => !p.identity.startsWith('EG_') && !/recorder/i.test(p.name ?? ''));
    return {
      hostPresent: people.some((p) => {
        const id = parseKloudMemberIdFromIdentity(p.identity);
        return id !== null && hostIds.has(id);
      }),
      participantCount: people.length,
    };
  } catch (e: unknown) {
    const err = e as { code?: string; status?: number };
    if (err?.code === 'not_found' || err?.status === 404) return { hostPresent: false, participantCount: 0 };
    console.error('[meetingAccess] listParticipants failed', meeting.roomName, e);
    return { hostPresent: null, participantCount: null };
  }
}

/** Nudges everyone in the room to refresh the waiting list (no personal data in the packet). */
export async function nudgeJoinRequests(roomName: string): Promise<void> {
  const client = getRoomServiceClient();
  if (!client) return;
  try {
    const payload = new TextEncoder().encode(JSON.stringify({ type: 'JOIN_REQUESTS_CHANGED' }));
    await client.sendData(roomName, payload, DataPacket_Kind.RELIABLE, { topic: JOIN_REQUESTS_TOPIC });
  } catch (e: unknown) {
    const err = e as { code?: string; status?: number };
    if (err?.code !== 'not_found' && err?.status !== 404) {
      console.warn('[meetingAccess] join-request nudge failed (non-fatal)', roomName, e);
    }
  }
}

/** Display name of the meeting's company account, for "Acme members" in the copy. */
export async function companyNameOf(accountId: number | null | undefined): Promise<string | null> {
  if (!accountId) return null;
  const account = await prisma.kloudMeetAccount.findUnique({
    where: { id: accountId },
    select: { accountName: true, deletedAt: true },
  });
  return account && !account.deletedAt ? account.accountName : null;
}

// ── Recordings ──────────────────────────────────────────────────────────────

/** RecordingAccessRequest rows are keyed by MeetUser (one per email). */
export async function meetUserIdForEmail(email: string, displayName?: string | null): Promise<number> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.meetUser.upsert({
    where: { email: normalized },
    create: { email: normalized, displayName: displayName || null },
    update: {},
    select: { id: true },
  });
  return user.id;
}

export async function recordingApprovedFor(recordingId: number, email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const row = await prisma.recordingAccessRequest.findFirst({
    where: {
      recordingId,
      status: 'APPROVED',
      meetUser: { email: email.trim().toLowerCase() },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function evaluateRecordingView(
  recording: Pick<Recording, 'id' | 'meetingId' | 'teamMemberId' | 'visibility'>,
  member: Pick<TeamMember, 'id' | 'email'> | null,
): Promise<RecordingDecision> {
  if (recording.visibility === 'PUBLIC') return { kind: 'watch' };
  const meeting = await prisma.meeting.findUnique({
    where: { id: recording.meetingId },
    select: { accessLevel: true, accountId: true, createdByMemberId: true },
  });
  if (!meeting) return { kind: 'refused' };
  const level = parseAccessLevel(meeting.accessLevel);
  if (level === 'PUBLIC' || !member) {
    return decideRecordingView({
      level,
      visibility: recording.visibility,
      signedIn: Boolean(member),
      isRecorderOrHost: false,
      attended: false,
      isCompanyMember: false,
      invited: false,
      approved: false,
    });
  }

  const email = member.email?.trim().toLowerCase() || null;
  const [attended, company, invited, approved] = await Promise.all([
    prisma.meetingParticipant.findFirst({
      where: { meetingId: recording.meetingId, teamMemberId: member.id },
      select: { id: true },
    }),
    level === 'PROTECTED' ? isCompanyMember(meeting.accountId, member.id) : false,
    level === 'PROTECTED' && email
      ? prisma.meetingInvitee.findFirst({ where: { meetingId: recording.meetingId, email }, select: { id: true } })
      : null,
    level === 'PRIVATE' ? false : recordingApprovedFor(recording.id, email),
  ]);
  return decideRecordingView({
    level,
    visibility: recording.visibility,
    signedIn: true,
    isRecorderOrHost: recording.teamMemberId === member.id || meeting.createdByMemberId === member.id,
    attended: Boolean(attended),
    isCompanyMember: company,
    invited: Boolean(invited),
    approved,
  });
}
