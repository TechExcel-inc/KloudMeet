/**
 * Stripe → BillingSubscription / BillingCredit sync (design doc §6).
 *
 * Idempotent by construction:
 * - subscription events write the subscription's state (re-applying is a no-op);
 *   events older than the last applied one are skipped (Stripe may deliver out of order);
 * - hour packs are keyed by the Checkout Session id (BillingCredit.stripeRef is unique).
 */
import type { BillingSubscription } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isUniqueConstraintError } from '@/lib/prismaErrors';
import {
  HOURS_PACK,
  isBillingInterval,
  isSeatPlan,
  isSelfServePlan,
  planForStripePrice,
  type PlanId,
} from '@/lib/billing/plans';
import { addMonthsClamped, effectivePlan } from '@/lib/billing/entitlements';
import { unarchiveAccountReplays } from '@/lib/billing/limits';
import { ensureOwnerSeat } from '@/lib/billing/account';
import type {
  StripeCheckoutSession,
  StripeEvent,
  StripeInvoice,
  StripeMetadata,
  StripeSubscription,
} from '@/lib/billing/stripe';

export const HANDLED_STRIPE_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
] as const;

export type WebhookOutcome =
  | 'ignored'
  | 'subscription_linked'
  | 'subscription_synced'
  | 'subscription_canceled'
  | 'credits_added'
  | 'credits_duplicate'
  | 'payment_failed'
  | 'stale'
  | 'account_not_found';

function parseAccountId(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function accountIdFromMetadata(meta: StripeMetadata | null | undefined, fallback?: string | null): number | null {
  return parseAccountId(meta?.accountId) ?? parseAccountId(fallback ?? null);
}

function fromUnix(seconds: number | null | undefined): Date | null {
  return typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000) : null;
}

function isStale(row: Pick<BillingSubscription, 'lastStripeEventAt'> | null, eventAt: Date): boolean {
  return Boolean(row?.lastStripeEventAt && row.lastStripeEventAt.getTime() > eventAt.getTime());
}

async function afterPlanChange(accountId: number, row: Pick<BillingSubscription, 'plan' | 'status' | 'source'>) {
  const plan = effectivePlan(row);
  if (plan === 'FREE') return;
  await unarchiveAccountReplays(accountId);
  if (isSeatPlan(plan)) await ensureOwnerSeat(accountId);
}

export async function handleStripeEvent(event: StripeEvent): Promise<WebhookOutcome> {
  const eventAt = new Date(event.created * 1000);
  switch (event.type) {
    case 'checkout.session.completed':
    // Bank debits (ACH, SEPA, Bacs…) complete checkout unpaid; the money clears days later.
    case 'checkout.session.async_payment_succeeded':
      return handleCheckoutCompleted(event.data.object as StripeCheckoutSession, eventAt);
    case 'checkout.session.async_payment_failed':
      // Nothing to undo: an unpaid subscription stays incomplete and Stripe expires it.
      return 'ignored';
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return syncSubscription(
        event.data.object as StripeSubscription,
        eventAt,
        event.type === 'customer.subscription.deleted',
      );
    case 'invoice.payment_failed':
      return handlePaymentFailed(event.data.object as StripeInvoice, eventAt);
    default:
      return 'ignored';
  }
}

async function handleCheckoutCompleted(session: StripeCheckoutSession, eventAt: Date): Promise<WebhookOutcome> {
  const accountId = accountIdFromMetadata(session.metadata, session.client_reference_id);
  if (!accountId) return 'account_not_found';

  if (session.mode === 'payment') {
    if (session.metadata?.kind !== 'hours_pack' || session.payment_status !== 'paid') return 'ignored';
    const packs = Math.max(1, Math.min(100, Number(session.metadata?.packs) || 1));
    const purchasedAt = fromUnix(session.created) ?? eventAt;
    try {
      await prisma.billingCredit.create({
        data: {
          accountId,
          seconds: HOURS_PACK.seconds * packs,
          purchasedAt,
          expiresAt: addMonthsClamped(purchasedAt, HOURS_PACK.validMonths),
          stripeRef: session.id,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return 'credits_duplicate';
      throw error;
    }
    return 'credits_added';
  }

  if (session.mode !== 'subscription' || !session.subscription) return 'ignored';

  const existing = await prisma.billingSubscription.findUnique({ where: { accountId } });
  if (existing?.source === 'MANUAL') return 'ignored';

  // customer.subscription.* may already have written the authoritative state; only fill gaps.
  const alreadySynced = existing?.stripeSubscriptionId === session.subscription;
  const metaPlan = session.metadata?.plan;
  const metaInterval = session.metadata?.interval;
  const plan: PlanId = isSelfServePlan(metaPlan) ? metaPlan : 'PRO';
  const seats = Math.max(1, Number(session.metadata?.seats) || 1);

  const base = {
    stripeCustomerId: session.customer ?? existing?.stripeCustomerId ?? null,
    stripeSubscriptionId: session.subscription,
    source: 'STRIPE',
    modifiedAt: new Date(),
  };
  // Unpaid at checkout = a delayed bank debit; the plan starts when Stripe reports the payment.
  const paid = session.payment_status !== 'unpaid';
  const fill = alreadySynced
    ? {}
    : {
        plan,
        status: paid ? 'active' : 'incomplete',
        interval: isBillingInterval(metaInterval) ? metaInterval : null,
        seats,
        cancelAtPeriodEnd: false,
      };

  const row = await prisma.billingSubscription.upsert({
    where: { accountId },
    create: { accountId, ...base, ...fill },
    update: { ...base, ...fill },
  });
  await afterPlanChange(accountId, row);
  return 'subscription_linked';
}

async function findSubscriptionRow(sub: { id: string; customer?: string | null; metadata?: StripeMetadata | null }) {
  const bySub = await prisma.billingSubscription.findUnique({ where: { stripeSubscriptionId: sub.id } });
  if (bySub) return bySub;
  const accountId = accountIdFromMetadata(sub.metadata);
  if (accountId) {
    const byAccount = await prisma.billingSubscription.findUnique({ where: { accountId } });
    if (byAccount) return byAccount;
  }
  if (sub.customer) {
    return prisma.billingSubscription.findUnique({ where: { stripeCustomerId: sub.customer } });
  }
  return null;
}

async function syncSubscription(sub: StripeSubscription, eventAt: Date, deleted: boolean): Promise<WebhookOutcome> {
  const row = await findSubscriptionRow(sub);
  const accountId = row?.accountId ?? accountIdFromMetadata(sub.metadata);
  if (!accountId) return 'account_not_found';
  if (row?.source === 'MANUAL') return 'ignored';
  if (isStale(row, eventAt)) return 'stale';
  // A deletion of an older subscription must not cancel a newer one.
  if (deleted && row?.stripeSubscriptionId && row.stripeSubscriptionId !== sub.id) return 'ignored';

  const item = sub.items?.data?.[0];
  const mapped = planForStripePrice(item?.price?.id);
  const metaPlan = sub.metadata?.plan;
  const plan: PlanId = mapped?.plan ?? (isSelfServePlan(metaPlan) ? metaPlan : row?.plan && isSelfServePlan(row.plan) ? row.plan : 'PRO');
  const metaInterval = sub.metadata?.interval;
  const interval = mapped?.interval ?? (isBillingInterval(metaInterval) ? metaInterval : row?.interval ?? null);

  const data = {
    plan,
    interval,
    seats: Math.max(1, item?.quantity ?? 1),
    status: deleted ? 'canceled' : (sub.status || 'active').toLowerCase(),
    currentPeriodStart: fromUnix(sub.current_period_start ?? item?.current_period_start),
    currentPeriodEnd: fromUnix(sub.current_period_end ?? item?.current_period_end),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end || sub.cancel_at),
    stripeCustomerId: sub.customer || row?.stripeCustomerId || null,
    stripeSubscriptionId: sub.id,
    source: 'STRIPE',
    lastStripeEventAt: eventAt,
    modifiedAt: new Date(),
  };

  const saved = await prisma.billingSubscription.upsert({
    where: { accountId },
    create: { accountId, ...data },
    update: data,
  });
  await afterPlanChange(accountId, saved);
  return deleted ? 'subscription_canceled' : 'subscription_synced';
}

async function handlePaymentFailed(invoice: StripeInvoice, eventAt: Date): Promise<WebhookOutcome> {
  const subId = invoice.subscription ?? invoice.parent?.subscription_details?.subscription ?? null;
  const row =
    (subId ? await prisma.billingSubscription.findUnique({ where: { stripeSubscriptionId: subId } }) : null) ??
    (invoice.customer
      ? await prisma.billingSubscription.findUnique({ where: { stripeCustomerId: invoice.customer } })
      : null);
  if (!row) return 'account_not_found';
  if (row.source === 'MANUAL' || row.status === 'canceled') return 'ignored';
  if (isStale(row, eventAt)) return 'stale';
  await prisma.billingSubscription.update({
    where: { id: row.id },
    data: { status: 'past_due', lastStripeEventAt: eventAt, modifiedAt: new Date() },
  });
  return 'payment_failed';
}
