/**
 * Billing entitlements (design doc §1, §2, §4).
 *
 * member → account (resolveMemberAccountId) → BillingSubscription → plan & limits.
 *
 * BILLING_ENABLED off ⇒ every member resolves to LEGACY (unlimited) without a
 * single database read, so existing customers are completely unaffected.
 */
import type { BillingSubscription } from '@prisma/client';
import { prisma } from '@/lib/db';
import { resolveMemberAccountId } from '@/lib/peerTimeCompany';
import {
  type BillingInterval,
  type PlanId,
  type PlanLimits,
  PLANS,
  includedReplaySeconds,
  isSeatPlan,
  isPlanId,
} from '@/lib/billing/plans';

export const USAGE_KIND = {
  RECORDING: 'RECORDING',
  CAPTIONS: 'CAPTIONS',
  AI_SUMMARY: 'AI_SUMMARY',
} as const;
export type UsageKind = (typeof USAGE_KIND)[keyof typeof USAGE_KIND];

/** Usage kinds that draw on replay hours. */
export const REPLAY_USAGE_KINDS: readonly UsageKind[] = [USAGE_KIND.RECORDING, USAGE_KIND.CAPTIONS];

/** Stripe statuses that keep the paid plan in force (past_due = Stripe is still retrying). */
const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function isBillingEnabled(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  const raw = (env.BILLING_ENABLED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export interface UsageWindow {
  start: Date;
  end: Date;
}

export interface Entitlements {
  enabled: boolean;
  plan: PlanId;
  limits: PlanLimits;
  teamMemberId: number;
  accountId: number | null;
  seats: number;
  interval: BillingInterval | null;
  /** Raw subscription status, or null when there is no subscription row. */
  status: string | null;
  source: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  /** Usage window used for replay hours and AI summary counts. */
  window: UsageWindow;
  subscription: BillingSubscription | null;
}

/* ──────────────────────────── pure helpers ──────────────────────────── */

/** Add calendar months (UTC), clamping the day to the target month's length (Jan 31 + 1 → Feb 28/29). */
export function addMonthsClamped(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/**
 * Monthly usage window containing `now`.
 * - With an anchor (paid subscription's period start): monthly windows anchored on it,
 *   so a yearly plan still gets its replay hours every month.
 * - Without an anchor (Free / manual): the UTC calendar month.
 */
export function usageWindow(anchor: Date | null | undefined, now: Date): UsageWindow {
  if (!anchor) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start, end };
  }
  let months =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  if (addMonthsClamped(anchor, months).getTime() > now.getTime()) months -= 1;
  return { start: addMonthsClamped(anchor, months), end: addMonthsClamped(anchor, months + 1) };
}

/** Plan in force for a subscription row (null row ⇒ FREE). */
export function effectivePlan(sub: Pick<BillingSubscription, 'plan' | 'status' | 'source'> | null): PlanId {
  if (!sub || !isPlanId(sub.plan)) return 'FREE';
  if (sub.source === 'MANUAL') return (sub.status || '').toLowerCase() === 'canceled' ? 'FREE' : sub.plan;
  if (sub.plan === 'FREE') return 'FREE';
  return PAID_STATUSES.has((sub.status || '').toLowerCase()) ? sub.plan : 'FREE';
}

export interface CreditLot {
  id: number;
  seconds: number;
  consumedSeconds: number;
  expiresAt: Date;
}

export interface ReplayBalance {
  /** null = unlimited plan. */
  includedSeconds: number | null;
  usedSeconds: number;
  /** Included seconds left this period (never negative). null = unlimited. */
  includedRemainingSeconds: number | null;
  /** Unexpired, unconsumed hour-pack seconds. */
  creditSeconds: number;
  /** Total seconds the account can still use. null = unlimited. */
  remainingSeconds: number | null;
}

export function activeCreditSeconds(credits: readonly CreditLot[], now: Date): number {
  return credits
    .filter((c) => c.expiresAt.getTime() > now.getTime())
    .reduce((sum, c) => sum + Math.max(0, c.seconds - c.consumedSeconds), 0);
}

/** Replay balance = included (Team: seats × per-seat) − used this period, plus unexpired hour packs. */
export function computeReplayBalance(input: {
  includedSeconds: number | null;
  usedSeconds: number;
  credits: readonly CreditLot[];
  now: Date;
}): ReplayBalance {
  const creditSeconds = activeCreditSeconds(input.credits, input.now);
  if (input.includedSeconds === null) {
    return {
      includedSeconds: null,
      usedSeconds: input.usedSeconds,
      includedRemainingSeconds: null,
      creditSeconds,
      remainingSeconds: null,
    };
  }
  const includedRemainingSeconds = Math.max(0, input.includedSeconds - input.usedSeconds);
  return {
    includedSeconds: input.includedSeconds,
    usedSeconds: input.usedSeconds,
    includedRemainingSeconds,
    creditSeconds,
    remainingSeconds: includedRemainingSeconds + creditSeconds,
  };
}

/**
 * Hour packs are only drawn once the plan's included seconds are used up.
 * Returns how many *new* seconds of this event spill over the allowance.
 */
export function overageFromEvent(includedSeconds: number | null, usedBefore: number, quantity: number): number {
  if (includedSeconds === null) return 0;
  const before = Math.max(0, usedBefore - includedSeconds);
  const after = Math.max(0, usedBefore + quantity - includedSeconds);
  return after - before;
}

/** Spread `overage` seconds over credit lots, earliest expiry first. */
export function allocateOverage(
  credits: readonly CreditLot[],
  overage: number,
  now: Date,
): { id: number; consume: number }[] {
  let left = Math.max(0, Math.floor(overage));
  const out: { id: number; consume: number }[] = [];
  const usable = credits
    .filter((c) => c.expiresAt.getTime() > now.getTime() && c.seconds > c.consumedSeconds)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id - b.id);
  for (const lot of usable) {
    if (left <= 0) break;
    const consume = Math.min(left, lot.seconds - lot.consumedSeconds);
    out.push({ id: lot.id, consume });
    left -= consume;
  }
  return out;
}

/* ──────────────────────────── DB-backed ──────────────────────────── */

export function legacyEntitlements(teamMemberId: number, now: Date = new Date()): Entitlements {
  return {
    enabled: false,
    plan: 'LEGACY',
    limits: PLANS.LEGACY.limits,
    teamMemberId,
    accountId: null,
    seats: 1,
    interval: null,
    status: null,
    source: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    window: usageWindow(null, now),
    subscription: null,
  };
}

export function entitlementsFromSubscription(
  teamMemberId: number,
  accountId: number | null,
  sub: BillingSubscription | null,
  now: Date,
): Entitlements {
  const plan = effectivePlan(sub);
  const paidStripe = Boolean(sub && sub.source !== 'MANUAL' && plan !== 'FREE');
  const interval = sub?.interval === 'month' || sub?.interval === 'year' ? sub.interval : null;
  return {
    enabled: true,
    plan,
    limits: PLANS[plan].limits,
    teamMemberId,
    accountId,
    seats: isSeatPlan(plan) ? Math.max(1, sub?.seats ?? 1) : 1,
    interval,
    status: sub?.status ?? null,
    source: sub?.source ?? null,
    cancelAtPeriodEnd: Boolean(sub?.cancelAtPeriodEnd),
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    window: usageWindow(paidStripe ? sub?.currentPeriodStart ?? null : null, now),
    subscription: sub,
  };
}

/** Entitlements of the account a member belongs to (or a personal Free plan when they have none). */
export async function resolveEntitlements(teamMemberId: number, now: Date = new Date()): Promise<Entitlements> {
  if (!isBillingEnabled()) return legacyEntitlements(teamMemberId, now);
  const accountId = await resolveMemberAccountId(teamMemberId);
  return resolveAccountEntitlements(teamMemberId, accountId, now);
}

export async function resolveAccountEntitlements(
  teamMemberId: number,
  accountId: number | null,
  now: Date = new Date(),
): Promise<Entitlements> {
  if (!isBillingEnabled()) return legacyEntitlements(teamMemberId, now);
  const sub = accountId
    ? await prisma.billingSubscription.findUnique({ where: { accountId } })
    : null;
  return entitlementsFromSubscription(teamMemberId, accountId, sub, now);
}

/** Usage rows belong to the account; members without one are tracked on their own. */
export function usageScope(ent: Pick<Entitlements, 'accountId' | 'teamMemberId'>) {
  return ent.accountId
    ? { accountId: ent.accountId }
    : { accountId: null, teamMemberId: ent.teamMemberId };
}

export async function sumUsage(
  ent: Pick<Entitlements, 'accountId' | 'teamMemberId'>,
  kinds: readonly UsageKind[],
  window: UsageWindow,
): Promise<number> {
  const agg = await prisma.usageEvent.aggregate({
    _sum: { quantity: true },
    where: {
      ...usageScope(ent),
      kind: { in: [...kinds] },
      occurredAt: { gte: window.start, lt: window.end },
    },
  });
  return agg._sum.quantity ?? 0;
}

export async function loadCredits(accountId: number | null): Promise<CreditLot[]> {
  if (!accountId) return [];
  return prisma.billingCredit.findMany({
    where: { accountId },
    select: { id: true, seconds: true, consumedSeconds: true, expiresAt: true },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
  });
}

export async function getReplayBalance(ent: Entitlements, now: Date = new Date()): Promise<ReplayBalance> {
  const includedSeconds = includedReplaySeconds(ent.plan, ent.seats);
  if (!ent.enabled || includedSeconds === null) {
    return computeReplayBalance({ includedSeconds: null, usedSeconds: 0, credits: [], now });
  }
  const [usedSeconds, credits] = await Promise.all([
    sumUsage(ent, REPLAY_USAGE_KINDS, ent.window),
    loadCredits(ent.accountId),
  ]);
  return computeReplayBalance({ includedSeconds, usedSeconds, credits, now });
}

/** AI summaries generated in the current window (counted per account / member). */
export async function countAiSummaries(ent: Entitlements): Promise<number> {
  if (!ent.enabled) return 0;
  return sumUsage(ent, [USAGE_KIND.AI_SUMMARY], ent.window);
}
