/**
 * Metering (design doc §4). Every write is idempotent on UsageEvent.sourceRef,
 * so repeated LiveKit / API callbacks never double-count.
 *
 * All functions are fail-soft: a metering error is logged and never breaks the
 * caller (webhook, summary generation). Nothing is written while billing is off.
 */
import { prisma } from '@/lib/db';
import { isUniqueConstraintError } from '@/lib/prismaErrors';
import { resolveMemberAccountId } from '@/lib/peerTimeCompany';
import { includedReplaySeconds } from '@/lib/billing/plans';
import {
  REPLAY_USAGE_KINDS,
  USAGE_KIND,
  type UsageKind,
  allocateOverage,
  isBillingEnabled,
  loadCredits,
  overageFromEvent,
  resolveAccountEntitlements,
  sumUsage,
} from '@/lib/billing/entitlements';

export interface UsageInput {
  kind: UsageKind;
  quantity: number;
  teamMemberId: number;
  meetingId?: number | null;
  sourceRef: string;
  occurredAt?: Date;
  /** Pass when already known; otherwise resolved from the member. */
  accountId?: number | null;
}

export const usageRef = {
  recording: (recordingId: number) => `rec:${recordingId}`,
  captions: (meetingId: number) => `cap:${meetingId}`,
  captionsTopUp: (meetingId: number, cumulativeSeconds: number) => `cap:${meetingId}:${cumulativeSeconds}`,
  aiSummary: (meetingId: number, at: Date) => `ai:${meetingId}:${at.getTime()}`,
};

/** Insert one usage row. Returns false when the sourceRef was already metered. */
export async function recordUsageEvent(input: UsageInput): Promise<boolean> {
  if (!isBillingEnabled()) return false;
  const quantity = Math.floor(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  const occurredAt = input.occurredAt ?? new Date();
  const accountId =
    input.accountId !== undefined ? input.accountId : await resolveMemberAccountId(input.teamMemberId);

  try {
    await prisma.usageEvent.create({
      data: {
        accountId,
        teamMemberId: input.teamMemberId,
        meetingId: input.meetingId ?? null,
        kind: input.kind,
        quantity,
        occurredAt,
        sourceRef: input.sourceRef,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) return false;
    throw error;
  }

  if (accountId && REPLAY_USAGE_KINDS.includes(input.kind)) {
    await drawCreditsForOverage(accountId, input.teamMemberId, quantity, occurredAt);
  }
  return true;
}

/** Charge the part of a new replay event that exceeds the plan allowance to hour packs. */
async function drawCreditsForOverage(
  accountId: number,
  teamMemberId: number,
  quantity: number,
  occurredAt: Date,
): Promise<void> {
  const ent = await resolveAccountEntitlements(teamMemberId, accountId, occurredAt);
  const included = includedReplaySeconds(ent.plan, ent.seats);
  if (included === null) return;
  const usedAfter = await sumUsage(ent, REPLAY_USAGE_KINDS, ent.window);
  const overage = overageFromEvent(included, Math.max(0, usedAfter - quantity), quantity);
  if (overage <= 0) return;
  const plan = allocateOverage(await loadCredits(accountId), overage, occurredAt);
  for (const { id, consume } of plan) {
    await prisma.billingCredit.update({
      where: { id },
      data: { consumedSeconds: { increment: consume } },
    });
  }
}

/** Fail-soft wrapper used from webhooks and API routes. */
export async function meterSafely(label: string, task: () => Promise<unknown>): Promise<void> {
  if (!isBillingEnabled()) return;
  try {
    await task();
  } catch (error) {
    console.error(`[billing] metering failed (${label})`, error);
  }
}

/** egress_ended: recording seconds → the account of the member who started it. */
export async function meterRecording(recording: {
  id: number;
  teamMemberId: number;
  meetingId: number;
  durationSeconds: number | null;
}): Promise<boolean> {
  if (!recording.durationSeconds || recording.durationSeconds <= 0) return false;
  return recordUsageEvent({
    kind: USAGE_KIND.RECORDING,
    quantity: recording.durationSeconds,
    teamMemberId: recording.teamMemberId,
    meetingId: recording.meetingId,
    sourceRef: usageRef.recording(recording.id),
  });
}

/** Number of distinct wall-clock minutes in which a caption was saved. */
export function distinctCaptionMinutes(captionTimes: readonly Date[]): number {
  const minutes = new Set<number>();
  for (const t of captionTimes) minutes.add(Math.floor(t.getTime() / 60_000));
  return minutes.size;
}

/**
 * room_finished: caption seconds = distinct caption minutes × 60 → the meeting host's account.
 * The first finish writes `cap:<meetingId>`; if a resumed meeting adds captions, the next
 * finish writes only the difference under `cap:<meetingId>:<cumulativeSeconds>`, so the
 * same total can never be metered twice.
 */
export async function meterCaptions(meeting: { id: number; createdByMemberId: number }): Promise<number> {
  const rows = await prisma.meetingTranscript.findMany({
    where: { meetingId: meeting.id },
    select: { captionTime: true },
  });
  const cumulative = distinctCaptionMinutes(rows.map((r) => r.captionTime)) * 60;
  if (cumulative <= 0) return 0;

  const prior = await prisma.usageEvent.aggregate({
    _sum: { quantity: true },
    where: {
      kind: USAGE_KIND.CAPTIONS,
      OR: [
        { sourceRef: usageRef.captions(meeting.id) },
        { sourceRef: { startsWith: `${usageRef.captions(meeting.id)}:` } },
      ],
    },
  });
  const already = prior._sum.quantity ?? 0;
  const delta = cumulative - already;
  if (delta <= 0) return 0;

  const created = await recordUsageEvent({
    kind: USAGE_KIND.CAPTIONS,
    quantity: delta,
    teamMemberId: meeting.createdByMemberId,
    meetingId: meeting.id,
    sourceRef: already === 0 ? usageRef.captions(meeting.id) : usageRef.captionsTopUp(meeting.id, cumulative),
  });
  return created ? delta : 0;
}

/** Successful AI summary generation → one AI_SUMMARY unit for the operator's account. */
export async function meterAiSummary(teamMemberId: number, meetingId: number, at: Date = new Date()) {
  return recordUsageEvent({
    kind: USAGE_KIND.AI_SUMMARY,
    quantity: 1,
    teamMemberId,
    meetingId,
    sourceRef: usageRef.aiSummary(meetingId, at),
    occurredAt: at,
  });
}
