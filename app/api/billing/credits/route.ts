/**
 * POST /api/billing/credits  { packs?: number }
 * → { url } of a one-off Stripe Checkout for replay-hour packs ($8 / 10 h, 12-month validity).
 * Pro / Team only; Owner / Admin only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { HOURS_PACK, PLANS, hoursPackPriceId } from '@/lib/billing/plans';
import { effectivePlan } from '@/lib/billing/entitlements';
import { createCheckoutSession } from '@/lib/billing/stripe';
import {
  BILLING_PAGE_PATH,
  billingBaseUrl,
  billingEnabledOr404,
  ensureStripeCustomer,
  resolvePurchaseAccount,
  stripeConfiguredOr503,
  stripeErrorResponse,
} from '@/lib/billing/routeHelpers';
import { billingLimitResponse } from '@/lib/billing/limits';

const MAX_PACKS = 20;

export async function POST(request: NextRequest) {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;
    const disabled = billingEnabledOr404();
    if (disabled) return disabled;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const packs = Math.min(MAX_PACKS, Math.max(1, Math.floor(Number(body?.packs ?? 1)) || 1));

    const priceId = hoursPackPriceId();
    if (!priceId) {
      return NextResponse.json({ error: 'Hour packs are not available for purchase yet' }, { status: 503 });
    }
    const notConfigured = stripeConfiguredOr503();
    if (notConfigured) return notConfigured;

    const account = await resolvePurchaseAccount(member);
    if (account instanceof NextResponse) return account;
    const { accountId, subscription } = account;

    if (!PLANS[effectivePlan(subscription)].limits.canBuyCredits) {
      return billingLimitResponse('replay_hours', 'Hour packs are available on Pro and Team plans.');
    }

    const customerId = await ensureStripeCustomer(member, accountId, subscription);
    const base = billingBaseUrl(request);
    const session = await createCheckoutSession({
      mode: 'payment',
      customer: customerId,
      client_reference_id: String(accountId),
      line_items: [{ price: priceId, quantity: packs }],
      success_url: `${base}${BILLING_PAGE_PATH}?credits=success`,
      cancel_url: `${base}${BILLING_PAGE_PATH}?credits=canceled`,
      metadata: {
        kind: 'hours_pack',
        accountId: String(accountId),
        packs: String(packs),
        secondsPerPack: String(HOURS_PACK.seconds),
        teamMemberId: String(member.id),
      },
    });
    if (!session.url) {
      return NextResponse.json({ error: 'Checkout is unavailable, please try again' }, { status: 502 });
    }
    return NextResponse.json({ url: session.url });
  } catch (error) {
    return stripeErrorResponse('billing credits', error);
  }
}
