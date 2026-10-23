/**
 * POST /api/webhooks/stripe — signature-verified Stripe events → billing tables.
 * Handled: checkout.session.completed, customer.subscription.created/updated/deleted,
 * invoice.payment_failed. Every handler is idempotent (see lib/billing/stripeWebhook.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { StripeSignatureError, constructStripeEvent } from '@/lib/billing/stripe';
import { handleStripeEvent } from '@/lib/billing/stripeWebhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error('[webhooks stripe] STRIPE_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  const payload = await request.text();
  let event;
  try {
    event = constructStripeEvent(payload, request.headers.get('stripe-signature'), secret);
  } catch (error) {
    const message = error instanceof StripeSignatureError ? error.message : 'Invalid payload';
    console.warn('[webhooks stripe] rejected', message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    const outcome = await handleStripeEvent(event);
    console.log(`[webhooks stripe] ${event.type} ${event.id} → ${outcome}`);
    return NextResponse.json({ received: true, outcome });
  } catch (error) {
    // 5xx makes Stripe retry; handlers are idempotent so a retry is safe.
    console.error('[webhooks stripe] handler failed', event.type, event.id, error);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }
}
