/**
 * Kloud Meet plan catalog (billing model v1, design doc §2).
 * Prices and limits match kloudmeet.com/pricing (2026-10-25): Free, Pro, Team, Business.
 *
 * Prices and limits live here so they can change without touching the
 * enforcement code. `null` always means "unlimited".
 * Stripe price IDs are never hard-coded: each paid price names the env var
 * that holds its ID (STRIPE_PRICE_*).
 */

export type PlanId = 'FREE' | 'PRO' | 'TEAM' | 'BUSINESS' | 'ENTERPRISE' | 'LEGACY';
export type BillingInterval = 'month' | 'year';

export const PLAN_IDS: readonly PlanId[] = ['FREE', 'PRO', 'TEAM', 'BUSINESS', 'ENTERPRISE', 'LEGACY'];

/** Plans a customer can buy through self-serve Stripe Checkout. */
export type SelfServePlanId = 'PRO' | 'TEAM' | 'BUSINESS';

/** Self-serve plans priced per seat (host), with a pooled replay allowance. */
export type SeatPlanId = 'TEAM' | 'BUSINESS';

const SELF_SERVE_PLANS: readonly SelfServePlanId[] = ['PRO', 'TEAM', 'BUSINESS'];

export interface PlanLimits {
  /** Max length of a single meeting, minutes. */
  maxMeetingMinutes: number | null;
  /** Max people in one meeting (host is never refused). */
  maxParticipants: number | null;
  /** Replay seconds included per billing period (per seat for TEAM and BUSINESS). */
  replaySecondsPerPeriod: number | null;
  /** Only the latest N replays stay visible; older ones are archived (never deleted). */
  replaysKept: number | null;
  /** Can set a replay to PUBLIC. */
  publicReplays: boolean;
  /** AI summaries per calendar month. */
  aiSummariesPerMonth: number | null;
  /** Can buy hour packs. */
  canBuyCredits: boolean;
}

export interface PlanPrice {
  /** USD cents for one seat for the whole interval (e.g. yearly = 12 × monthly rate). */
  amountCents: number;
  /** Displayed per-seat monthly rate, USD cents. */
  monthlyRateCents: number;
  /** Env var holding the Stripe price ID. */
  stripePriceEnv: string;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  selfServe: boolean;
  /** Minimum seats (seat plans only). */
  minSeats: number;
  limits: PlanLimits;
  prices: Partial<Record<BillingInterval, PlanPrice>>;
}

const HOUR = 3600;

export const PLANS: Record<PlanId, PlanDefinition> = {
  FREE: {
    id: 'FREE',
    name: 'Free',
    selfServe: false,
    minSeats: 1,
    limits: {
      maxMeetingMinutes: 60,
      maxParticipants: 10,
      replaySecondsPerPeriod: 2 * HOUR,
      replaysKept: 3,
      publicReplays: false,
      aiSummariesPerMonth: 5,
      canBuyCredits: false,
    },
    prices: {},
  },
  PRO: {
    id: 'PRO',
    name: 'Pro',
    selfServe: true,
    minSeats: 1,
    limits: {
      maxMeetingMinutes: 24 * 60,
      maxParticipants: 300,
      replaySecondsPerPeriod: 10 * HOUR,
      replaysKept: null,
      publicReplays: true,
      aiSummariesPerMonth: null,
      canBuyCredits: true,
    },
    prices: {
      month: { amountCents: 2000, monthlyRateCents: 2000, stripePriceEnv: 'STRIPE_PRICE_PRO_MONTH' },
      year: { amountCents: 16 * 12 * 100, monthlyRateCents: 1600, stripePriceEnv: 'STRIPE_PRICE_PRO_YEAR' },
    },
  },
  TEAM: {
    id: 'TEAM',
    name: 'Team',
    selfServe: true,
    minSeats: 3,
    limits: {
      maxMeetingMinutes: 24 * 60,
      maxParticipants: 300,
      replaySecondsPerPeriod: 15 * HOUR,
      replaysKept: null,
      publicReplays: true,
      aiSummariesPerMonth: null,
      canBuyCredits: true,
    },
    prices: {
      month: { amountCents: 3000, monthlyRateCents: 3000, stripePriceEnv: 'STRIPE_PRICE_TEAM_MONTH' },
      year: { amountCents: 25 * 12 * 100, monthlyRateCents: 2500, stripePriceEnv: 'STRIPE_PRICE_TEAM_YEAR' },
    },
  },
  BUSINESS: {
    id: 'BUSINESS',
    name: 'Business',
    selfServe: true,
    minSeats: 5,
    limits: {
      maxMeetingMinutes: 24 * 60,
      maxParticipants: 500,
      replaySecondsPerPeriod: 25 * HOUR,
      replaysKept: null,
      publicReplays: true,
      aiSummariesPerMonth: null,
      canBuyCredits: true,
    },
    prices: {
      month: { amountCents: 5500, monthlyRateCents: 5500, stripePriceEnv: 'STRIPE_PRICE_BUSINESS_MONTH' },
      year: { amountCents: 45 * 12 * 100, monthlyRateCents: 4500, stripePriceEnv: 'STRIPE_PRICE_BUSINESS_YEAR' },
    },
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    selfServe: false,
    minSeats: 1,
    limits: {
      maxMeetingMinutes: null,
      maxParticipants: 1000,
      // 合同约定：v1 不在系统内限额。
      replaySecondsPerPeriod: null,
      replaysKept: null,
      publicReplays: true,
      aiSummariesPerMonth: null,
      canBuyCredits: false,
    },
    prices: {},
  },
  LEGACY: {
    id: 'LEGACY',
    name: 'Legacy',
    selfServe: false,
    minSeats: 1,
    limits: {
      maxMeetingMinutes: null,
      maxParticipants: null,
      replaySecondsPerPeriod: null,
      replaysKept: null,
      publicReplays: true,
      aiSummariesPerMonth: null,
      canBuyCredits: false,
    },
    prices: {},
  },
};

/** Hour pack: $8 for 10 replay hours, valid 12 months (paid self-serve plans only). */
export const HOURS_PACK = {
  seconds: 10 * HOUR,
  amountCents: 800,
  validMonths: 12,
  stripePriceEnv: 'STRIPE_PRICE_HOURS_PACK',
} as const;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

export function isSelfServePlan(value: unknown): value is SelfServePlanId {
  return typeof value === 'string' && (SELF_SERVE_PLANS as readonly string[]).includes(value);
}

export function isSeatPlan(value: unknown): value is SeatPlanId {
  return value === 'TEAM' || value === 'BUSINESS';
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === 'month' || value === 'year';
}

export function getPlan(id: PlanId): PlanDefinition {
  return PLANS[id];
}

/** Stripe price ID for a self-serve plan, or null when the env var is unset. */
export function stripePriceIdFor(
  plan: SelfServePlanId,
  interval: BillingInterval,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): string | null {
  const envName = PLANS[plan].prices[interval]?.stripePriceEnv;
  const value = envName ? env[envName]?.trim() : '';
  return value || null;
}

export function hoursPackPriceId(env: Partial<NodeJS.ProcessEnv> = process.env): string | null {
  return env[HOURS_PACK.stripePriceEnv]?.trim() || null;
}

/** Reverse lookup: which plan / interval a Stripe price ID belongs to. */
export function planForStripePrice(
  priceId: string | null | undefined,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): { plan: SelfServePlanId; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const plan of SELF_SERVE_PLANS) {
    for (const interval of ['month', 'year'] as const) {
      if (stripePriceIdFor(plan, interval, env) === priceId) return { plan, interval };
    }
  }
  return null;
}

/** Replay seconds included per period for a plan and seat count. */
export function includedReplaySeconds(plan: PlanId, seats: number): number | null {
  const perSeat = PLANS[plan].limits.replaySecondsPerPeriod;
  if (perSeat === null) return null;
  if (isSeatPlan(plan)) return perSeat * Math.max(1, Math.floor(seats));
  return perSeat;
}
