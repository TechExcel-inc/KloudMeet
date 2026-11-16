/**
 * POST /api/billing/portal → { url } of the Stripe customer portal
 * (update card, download invoices, change seats / plan, cancel). Owner / Admin only.
 */
import { NextRequest } from 'next/server';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { prisma } from '@/lib/db';
import { isAccountAdminOf, findManagedAccountId } from '@/lib/billing/account';
import { createPortalSession } from '@/lib/billing/stripe';
import {
  BILLING_PAGE_PATH,
  billingBaseUrl,
  billingEnabledOr404,
  stripeErrorResponse,
} from '@/lib/billing/routeHelpers';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export async function POST(request: NextRequest) {
  return runWithLocale(request, async () => {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;
    const disabled = billingEnabledOr404();
    if (disabled) return disabled;

    const accountId = await findManagedAccountId(member.id);
    if (!accountId || !(await isAccountAdminOf(member.id, accountId))) {
      return apiJson({ error: 'Only an account owner or admin can manage billing' }, { status: 403 });
    }
    const subscription = await prisma.billingSubscription.findUnique({ where: { accountId } });
    if (!subscription?.stripeCustomerId) {
      return apiJson({ error: 'No billing profile yet. Choose a plan first.' }, { status: 409 });
    }

    const session = await createPortalSession({
      customer: subscription.stripeCustomerId,
      returnUrl: `${billingBaseUrl(request)}${BILLING_PAGE_PATH}`,
    });
    return apiJson({ url: session.url });
  } catch (error) {
    return stripeErrorResponse('billing portal', error);
  }

  });
}
