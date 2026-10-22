/**
 * Server-side plan limits (design doc §5). The client only shows hints; every
 * limit is decided here. All checks return "allowed" when BILLING_ENABLED is off.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { deleteLiveKitRoom, countOtherRoomParticipants } from '@/lib/livekitRooms';
import { archivePersonalRoomMeeting } from '@/lib/personalRoom';
import { MEETING_END_REASON, MEETING_STATUS } from '@/lib/meetingRejoin';
import {
  type Entitlements,
  countAiSummaries,
  getReplayBalance,
  isBillingEnabled,
  resolveEntitlements,
} from '@/lib/billing/entitlements';
import { meterRecording, meterSafely } from '@/lib/billing/usage';

export const BILLING_UPGRADE_URL = '/account/billing';
export const RECORDING_STATUS_ARCHIVED = 'ARCHIVED';

export type BillingLimit =
  | 'replay_hours'
  | 'ai_summaries'
  | 'public_replays'
  | 'meeting_minutes'
  | 'participants'
  | 'replay_retention';

export interface BillingLimitBody {
  error: string;
  code: 'BILLING_LIMIT';
  limit: BillingLimit;
  upgradeUrl: string;
}

export function billingLimitBody(limit: BillingLimit, error: string): BillingLimitBody {
  return { error, code: 'BILLING_LIMIT', limit, upgradeUrl: BILLING_UPGRADE_URL };
}

/** 402 Payment Required with a machine-readable reason the UI can turn into a toast. */
export function billingLimitResponse(limit: BillingLimit, error: string, status = 402): NextResponse {
  return NextResponse.json(billingLimitBody(limit, error), { status });
}

/** Recording / captions: refuse to *start* once replay seconds are used up (running ones continue). */
export async function checkReplayQuota(teamMemberId: number): Promise<NextResponse | null> {
  if (!isBillingEnabled()) return null;
  const ent = await resolveEntitlements(teamMemberId);
  const balance = await getReplayBalance(ent);
  if (balance.remainingSeconds !== null && balance.remainingSeconds <= 0) {
    return billingLimitResponse(
      'replay_hours',
      ent.limits.canBuyCredits
        ? 'You have used all replay hours for this billing period. Buy an hour pack or upgrade to keep recording.'
        : 'You have used all replay hours included in the Free plan this month. Upgrade to keep recording.',
    );
  }
  return null;
}

/**
 * Live captions draw on the meeting host's replay hours. With billing on, the caption
 * token endpoints must name the room so the host can be found.
 */
export async function checkCaptionQuotaForRoom(roomName: string | null | undefined): Promise<NextResponse | null> {
  if (!isBillingEnabled()) return null;
  const name = roomName?.trim();
  if (!name) return NextResponse.json({ error: 'roomName is required' }, { status: 400 });
  const meeting = await prisma.meeting.findUnique({
    where: { roomName: name },
    select: { createdByMemberId: true },
  });
  if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
  const ent = await resolveEntitlements(meeting.createdByMemberId);
  const balance = await getReplayBalance(ent);
  if (balance.remainingSeconds !== null && balance.remainingSeconds <= 0) {
    return billingLimitResponse(
      'replay_hours',
      "The host's replay hours for this period are used up, so captions can't start.",
    );
  }
  return null;
}

export async function checkAiSummaryQuota(teamMemberId: number): Promise<NextResponse | null> {
  if (!isBillingEnabled()) return null;
  const ent = await resolveEntitlements(teamMemberId);
  const limit = ent.limits.aiSummariesPerMonth;
  if (limit === null) return null;
  const used = await countAiSummaries(ent);
  if (used >= limit) {
    return billingLimitResponse(
      'ai_summaries',
      `The Free plan includes ${limit} AI summaries per month. Upgrade for unlimited summaries.`,
    );
  }
  return null;
}

export async function checkPublicReplayAllowed(teamMemberId: number): Promise<NextResponse | null> {
  if (!isBillingEnabled()) return null;
  const ent = await resolveEntitlements(teamMemberId);
  if (ent.limits.publicReplays) return null;
  return billingLimitResponse('public_replays', 'Public replay links are available on Pro and Team plans.');
}

/* ─────────────────────────── meeting length ─────────────────────────── */

export interface MeetingForLimit {
  id: number;
  roomName: string;
  createdByMemberId: number;
  actualStartedAt: Date | null;
}

/**
 * When the host's plan caps meeting length, returns the time the meeting must end.
 * The clock starts at the LiveKit room start (actualStartedAt); if that has not been
 * recorded yet (webhook not received), it starts now and is persisted.
 */
export async function meetingEndsAt(meeting: MeetingForLimit, now: Date = new Date()): Promise<Date | null> {
  if (!isBillingEnabled()) return null;
  const ent = await resolveEntitlements(meeting.createdByMemberId, now);
  return meetingEndsAtFor(ent, meeting, now);
}

export async function meetingEndsAtFor(
  ent: Entitlements,
  meeting: MeetingForLimit,
  now: Date = new Date(),
): Promise<Date | null> {
  const minutes = ent.limits.maxMeetingMinutes;
  if (!ent.enabled || minutes === null) return null;
  let startedAt = meeting.actualStartedAt;
  if (!startedAt) {
    startedAt = now;
    await prisma.meeting.updateMany({
      where: { id: meeting.id, actualStartedAt: null },
      data: { actualStartedAt: now },
    });
  }
  return new Date(startedAt.getTime() + minutes * 60_000);
}

/** Ends the LiveKit room and marks the meeting ENDED because the plan's time limit was reached. */
export async function endMeetingForTimeLimit(meeting: MeetingForLimit & { status: string }): Promise<void> {
  await deleteLiveKitRoom(meeting.roomName);
  if (meeting.status === MEETING_STATUS.ENDED || meeting.status === MEETING_STATUS.CANCELED) return;
  const endedAt = new Date();
  const start = meeting.actualStartedAt ?? endedAt;
  const updated = await prisma.meeting.update({
    where: { id: meeting.id },
    data: {
      status: MEETING_STATUS.ENDED,
      endedAt,
      endedReason: MEETING_END_REASON.TIME_LIMIT,
      rejoinableUntil: null,
      roomEmptyAt: null,
      actualDurationMinutes: Math.max(1, Math.round((endedAt.getTime() - start.getTime()) / 60_000)),
    },
  });
  await archivePersonalRoomMeeting(updated);
}

/* ─────────────────────────── participant cap ─────────────────────────── */

/**
 * True when the room already holds the host plan's participant cap.
 * The host is never refused; if LiveKit cannot be reached the join is allowed.
 */
export async function participantCapReached(input: {
  hostEntitlements: Entitlements;
  roomName: string;
  joinerIdentity: string;
  joinerMemberId: number | null;
  hostMemberId: number;
}): Promise<boolean> {
  const cap = input.hostEntitlements.limits.maxParticipants;
  if (!input.hostEntitlements.enabled || cap === null) return false;
  if (input.joinerMemberId !== null && input.joinerMemberId === input.hostMemberId) return false;
  const others = await countOtherRoomParticipants(input.roomName, {
    identity: input.joinerIdentity,
    memberId: input.joinerMemberId,
  });
  return others !== null && others >= cap;
}

/* ─────────────────────────── replay retention ─────────────────────────── */

/** Free keeps the latest N READY replays per host; older ones become ARCHIVED (never deleted). */
export async function enforceReplayRetention(teamMemberId: number): Promise<number> {
  if (!isBillingEnabled()) return 0;
  const ent = await resolveEntitlements(teamMemberId);
  const keep = ent.limits.replaysKept;
  if (keep === null) return 0;
  const ready = await prisma.recording.findMany({
    where: { teamMemberId, status: 'READY', deletedAt: null },
    select: { id: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const archiveIds = ready.slice(keep).map((r) => r.id);
  if (archiveIds.length === 0) return 0;
  const res = await prisma.recording.updateMany({
    where: { id: { in: archiveIds }, status: 'READY' },
    data: { status: RECORDING_STATUS_ARCHIVED },
  });
  return res.count;
}

/** On upgrade: every archived replay of the account's members becomes READY again. */
export async function unarchiveAccountReplays(accountId: number): Promise<number> {
  const [members, admins] = await Promise.all([
    prisma.accountMembership.findMany({ where: { accountId, status: 'ACTIVE' }, select: { teamMemberId: true } }),
    prisma.accountOwnerAndAdmin.findMany({ where: { accountId, status: 'ACTIVE' }, select: { teamMemberId: true } }),
  ]);
  const ids = [...new Set([...members, ...admins].map((m) => m.teamMemberId))];
  if (ids.length === 0) return 0;
  const res = await prisma.recording.updateMany({
    where: { teamMemberId: { in: ids }, status: RECORDING_STATUS_ARCHIVED },
    data: { status: 'READY' },
  });
  return res.count;
}

/** Called wherever a recording becomes READY: meter its seconds, then apply Free retention. */
export async function onRecordingReady(recording: {
  id: number;
  teamMemberId: number;
  meetingId: number;
  durationSeconds: number | null;
}): Promise<void> {
  await meterSafely(`rec:${recording.id}`, () => meterRecording(recording));
  await meterSafely(`retention:${recording.teamMemberId}`, () => enforceReplayRetention(recording.teamMemberId));
}
