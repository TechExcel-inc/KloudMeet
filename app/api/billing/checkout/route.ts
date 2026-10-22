/**
 * POST /api/billing/checkout  { plan: 'PRO' | 'TEAM', interval: 'month' | 'year', seats?: number }
 * → { url } of a Stripe Checkout Session (subscription mode).
 * Owner / Admin only; a member without an account gets a personal account here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { PLANS, isBillingInterval, isSelfServePlan, stripePriceIdFor } from '@/lib/billing/plans';
import { effectivePlan } from '@/lib/billing/entitlements';
import { createCheckoutSession } from '@/lib/billing/stripe';
import {
  BILLING_PAGE_PATH,
  billingBaseUrl,
  billingEnabledOr404,
  ensureStripeCustomer,
  resolvePurchaseAccount,
  stripeErrorResponse,
} from '@/lib/billing/routeHelpers';

const MAX_SEATS = 500;

export async function POST(request: NextRequest) {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;
    const disabled = billingEnabledOr404();
    if (disabled) return disabled;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const plan = body?.plan;
    const interval = body?.interval;
    if (!isSelfServePlan(plan) || !isBillingInterval(interval)) {
      return NextResponse.json({ error: 'Choose PRO or TEAM and month or year' }, { status: 400 });
    }
    const minSeats = PLANS[plan].minSeats;
    const requestedSeats = Math.floor(Number(body?.seats ?? minSeats));
    const seats = plan === 'TEAM' ? Math.min(MAX_SEATS, Math.max(minSeats, requestedSeats || minSeats)) : 1;

    const priceId = stripePriceIdFor(plan, interval);
    if (!priceId) {
      return NextResponse.json({ error: 'This plan is not available for purchase yet' }, { status: 503 });
    }

    const account = await resolvePurchaseAccount(member);
    if (account instanceof NextResponse) return account;
    const { accountId, subscription } = account;

    if (effectivePlan(subscription) !== 'FREE') {
      // Plan / seat changes on an existing subscription go through the Stripe portal.
      return NextResponse.json(
        { error: 'This account already has a plan. Use “Manage billing” to change it.', code: 'ALREADY_SUBSCRIBED' },
        { status: 409 },
      );
    }

    const customerId = await ensureStripeCustomer(member, accountId, subscription);
    const base = billingBaseUrl(request);
    const metadata = {
      accountId: String(accountId),
      plan,
      interval,
      seats: String(seats),
      teamMemberId: String(member.id),
    };
    const session = await createCheckoutSession({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: String(accountId),
      line_items: [{ price: priceId, quantity: seats }],
      success_url: `${base}${BILLING_PAGE_PATH}?checkout=success`,
      cancel_url: `${base}${BILLING_PAGE_PATH}?checkout=canceled`,
      allow_promotion_codes: true,
      metadata,
      subscription_data: { metadata },
    });
    if (!session.url) {
      return NextResponse.json({ error: 'Checkout is unavailable, please try again' }, { status: 502 });
    }
    return NextResponse.json({ url: session.url });
  } catch (error) {
    return stripeErrorResponse('billing checkout', error);
  }
}
