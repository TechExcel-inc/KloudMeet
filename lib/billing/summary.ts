/** Data for the Plan & billing page (GET /api/billing/summary). */
import { prisma } from '@/lib/db';
import {
  HOURS_PACK,
  PLANS,
  type BillingInterval,
  type PlanId,
  type PlanLimits,
  hoursPackPriceId,
  isSeatPlan,
  isSelfServePlan,
  stripePriceIdFor,
  type SelfServePlanId,
} from '@/lib/billing/plans';
import {
  countAiSummaries,
  getReplayBalance,
  isBillingEnabled,
  resolveEntitlements,
  type Entitlements,
} from '@/lib/billing/entitlements';
import { isAccountAdminOf } from '@/lib/billing/account';
import { RECORDING_STATUS_ARCHIVED } from '@/lib/billing/limits';

export interface CatalogPlan {
  id: PlanId;
  name: string;
  minSeats: number;
  limits: PlanLimits;
  prices: Partial<Record<BillingInterval, { monthlyRateCents: number; amountCents: number; available: boolean }>>;
}

export interface BillingSummary {
  enabled: true;
  plan: PlanId;
  planName: string;
  status: string | null;
  source: string | null;
  /** Paid plan bought with a delayed payment method that has not cleared yet. */
  pendingPlan: SelfServePlanId | null;
  interval: BillingInterval | null;
  seats: number;
  seatsUsed: number;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  canManage: boolean;
  hasStripeCustomer: boolean;
  window: { start: string; end: string };
  replay: {
    includedSeconds: number | null;
    usedSeconds: number;
    creditSeconds: number;
    remainingSeconds: number | null;
  };
  aiSummaries: { used: number; limit: number | null };
  replays: { kept: number; archived: number; limit: number | null };
  limits: PlanLimits;
  catalog: CatalogPlan[];
  hoursPack: { seconds: number; amountCents: number; available: boolean };
}

export type BillingSummaryResponse = BillingSummary | { enabled: false };

/** A Stripe subscription still waiting for its first payment (e.g. a bank debit) keeps the account on Free. */
function pendingPlanOf(ent: Entitlements): SelfServePlanId | null {
  const sub = ent.subscription;
  if (ent.plan !== 'FREE' || !sub || sub.source === 'MANUAL') return null;
  if ((sub.status || '').toLowerCase() !== 'incomplete') return null;
  return isSelfServePlan(sub.plan) ? sub.plan : null;
}

export async function buildBillingSummary(teamMemberId: number): Promise<BillingSummaryResponse> {
  if (!isBillingEnabled()) return { enabled: false };
  const ent = await resolveEntitlements(teamMemberId);
  const [balance, aiUsed, kept, archived, seatsUsed, canManage] = await Promise.all([
    getReplayBalance(ent),
    countAiSummaries(ent),
    prisma.recording.count({ where: { teamMemberId, status: 'READY', deletedAt: null } }),
    prisma.recording.count({ where: { teamMemberId, status: RECORDING_STATUS_ARCHIVED, deletedAt: null } }),
    ent.accountId ? prisma.billingSeat.count({ where: { accountId: ent.accountId } }) : Promise.resolve(0),
    // No account yet → the member would become the owner of a personal account at checkout.
    ent.accountId ? isAccountAdminOf(teamMemberId, ent.accountId) : Promise.resolve(true),
  ]);

  const catalog: CatalogPlan[] = (['FREE', 'PRO', 'TEAM', 'BUSINESS'] as const).map((id) => {
    const def = PLANS[id];
    const prices: CatalogPlan['prices'] = {};
    for (const interval of ['month', 'year'] as const) {
      const price = def.prices[interval];
      if (!price) continue;
      prices[interval] = {
        monthlyRateCents: price.monthlyRateCents,
        amountCents: price.amountCents,
        available: id !== 'FREE' && Boolean(stripePriceIdFor(id, interval)),
      };
    }
    return { id, name: def.name, minSeats: def.minSeats, limits: def.limits, prices };
  });

  return {
    enabled: true,
    plan: ent.plan,
    planName: PLANS[ent.plan].name,
    status: ent.status,
    source: ent.source,
    pendingPlan: pendingPlanOf(ent),
    interval: ent.interval,
    seats: ent.seats,
    seatsUsed: isSeatPlan(ent.plan) ? seatsUsed : 1,
    cancelAtPeriodEnd: ent.cancelAtPeriodEnd,
    currentPeriodEnd: ent.currentPeriodEnd?.toISOString() ?? null,
    canManage,
    hasStripeCustomer: Boolean(ent.subscription?.stripeCustomerId),
    window: { start: ent.window.start.toISOString(), end: ent.window.end.toISOString() },
    replay: {
      includedSeconds: balance.includedSeconds,
      usedSeconds: balance.usedSeconds,
      creditSeconds: balance.creditSeconds,
      remainingSeconds: balance.remainingSeconds,
    },
    aiSummaries: { used: aiUsed, limit: ent.limits.aiSummariesPerMonth },
    replays: { kept, archived, limit: ent.limits.replaysKept },
    limits: ent.limits,
    catalog,
    hoursPack: {
      seconds: HOURS_PACK.seconds,
      amountCents: HOURS_PACK.amountCents,
      available: ent.limits.canBuyCredits && Boolean(hoursPackPriceId()),
    },
  };
}
