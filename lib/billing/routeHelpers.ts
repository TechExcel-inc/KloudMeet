/** Shared plumbing for /api/billing/* routes. */
import { NextRequest, NextResponse } from 'next/server';
import type { BillingSubscription, TeamMember } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isBillingEnabled } from '@/lib/billing/entitlements';
import { resolveBillingAccountForPurchase } from '@/lib/billing/account';
import { StripeApiError, StripeConfigError, createStripeCustomer } from '@/lib/billing/stripe';

export function billingDisabledResponse(): NextResponse {
  return NextResponse.json({ error: 'Billing is not enabled' }, { status: 404 });
}

export function billingEnabledOr404(): NextResponse | null {
  return isBillingEnabled() ? null : billingDisabledResponse();
}

/** Refuse purchases before any write (e.g. a personal account) when Stripe isn't configured. */
export function stripeConfiguredOr503(): NextResponse | null {
  return process.env.STRIPE_SECRET_KEY?.trim()
    ? null
    : NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 });
}

/** Public origin for Stripe return URLs. */
export function billingBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return (configured || request.nextUrl.origin).replace(/\/$/, '');
}

export const BILLING_PAGE_PATH = '/account/billing';

/**
 * Billing account for a purchase (a personal account is created on first checkout)
 * and its subscription row. Responds 403 for members who are not Owner / Admin.
 */
export async function resolvePurchaseAccount(
  member: TeamMember,
): Promise<{ accountId: number; subscription: BillingSubscription | null } | NextResponse> {
  const resolved = await resolveBillingAccountForPurchase(member);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const subscription = await prisma.billingSubscription.findUnique({ where: { accountId: resolved.accountId } });
  return { accountId: resolved.accountId, subscription };
}

/** Stripe customer for the account, created (and stored) on first use. */
export async function ensureStripeCustomer(
  member: TeamMember,
  accountId: number,
  subscription: BillingSubscription | null,
): Promise<string> {
  if (subscription?.stripeCustomerId) return subscription.stripeCustomerId;
  const customer = await createStripeCustomer({
    email: member.email,
    name: member.fullName || member.username,
    accountId,
  });
  await prisma.billingSubscription.upsert({
    where: { accountId },
    create: { accountId, plan: 'FREE', status: 'active', source: 'STRIPE', stripeCustomerId: customer.id },
    update: { stripeCustomerId: customer.id, modifiedAt: new Date() },
  });
  return customer.id;
}

export function stripeErrorResponse(label: string, error: unknown): NextResponse {
  if (error instanceof StripeConfigError) {
    console.error(`[${label}] Stripe is not configured`);
    return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 });
  }
  if (error instanceof StripeApiError) {
    console.error(`[${label}] Stripe API error`, error.status, error.message);
    return NextResponse.json({ error: 'Payment provider error, please try again' }, { status: 502 });
  }
  console.error(`[${label}]`, error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
