import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createPrismaMock, uniqueViolation } from './prismaMock';

const db = vi.hoisted(() => ({ prisma: null as unknown }));
vi.mock('@/lib/db', () => db);

import {
  StripeSignatureError,
  computeStripeSignature,
  constructStripeEvent,
  encodeStripeForm,
  stripeRequest,
} from '@/lib/billing/stripe';
import { handleStripeEvent } from '@/lib/billing/stripeWebhook';
import { POST as stripeWebhookRoute } from '@/app/api/webhooks/stripe/route';

const d = (iso: string) => new Date(iso);
const unix = (iso: string) => Math.floor(d(iso).getTime() / 1000);
const SECRET = 'whsec_test_dummy';

let prisma: ReturnType<typeof createPrismaMock>;

function event(type: string, object: unknown, createdIso = '2026-10-20T10:00:00Z') {
  return { id: `evt_${type}_${createdIso}`, type, created: unix(createdIso), data: { object } };
}

function stripeSub(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    object: 'subscription',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    metadata: { accountId: '10' },
    items: {
      data: [
        {
          price: { id: 'price_team_year' },
          quantity: 5,
          current_period_start: unix('2026-10-20T00:00:00Z'),
          current_period_end: unix('2027-10-20T00:00:00Z'),
        },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv('BILLING_ENABLED', 'true');
  vi.stubEnv('STRIPE_PRICE_PRO_MONTH', 'price_pro_month');
  vi.stubEnv('STRIPE_PRICE_PRO_YEAR', 'price_pro_year');
  vi.stubEnv('STRIPE_PRICE_TEAM_MONTH', 'price_team_month');
  vi.stubEnv('STRIPE_PRICE_TEAM_YEAR', 'price_team_year');
  prisma = createPrismaMock();
  db.prisma = prisma;
  prisma.billingSubscription.findUnique.mockResolvedValue(null);
  prisma.billingSubscription.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({
    id: 1,
    status: 'active',
    source: 'STRIPE',
    ...args.create,
  }));
  prisma.accountMembership.findMany.mockResolvedValue([{ teamMemberId: 1 }, { teamMemberId: 2 }]);
  prisma.accountOwnerAndAdmin.findMany.mockResolvedValue([{ teamMemberId: 1 }]);
  prisma.accountOwnerAndAdmin.findFirst.mockResolvedValue({ teamMemberId: 1 });
  prisma.recording.updateMany.mockResolvedValue({ count: 2 });
  prisma.billingSeat.createMany.mockResolvedValue({ count: 1 });
});

afterEach(() => vi.unstubAllEnvs());

describe('webhook signature', () => {
  const payload = JSON.stringify(event('invoice.payment_failed', { id: 'in_1' }));
  const now = d('2026-10-20T10:00:00Z').getTime();
  const t = Math.floor(now / 1000);

  it('accepts a correctly signed payload', () => {
    const header = `t=${t},v1=${computeStripeSignature(payload, t, SECRET)}`;
    expect(constructStripeEvent(payload, header, SECRET, now).type).toBe('invoice.payment_failed');
  });

  it('rejects a wrong secret, a stale timestamp and a missing header', () => {
    const bad = `t=${t},v1=${computeStripeSignature(payload, t, 'whsec_other')}`;
    expect(() => constructStripeEvent(payload, bad, SECRET, now)).toThrow(StripeSignatureError);
    const old = t - 3600;
    const stale = `t=${old},v1=${computeStripeSignature(payload, old, SECRET)}`;
    expect(() => constructStripeEvent(payload, stale, SECRET, now)).toThrow(/tolerance/);
    expect(() => constructStripeEvent(payload, null, SECRET, now)).toThrow(/Missing/);
  });

  it('rejects a tampered body', () => {
    const header = `t=${t},v1=${computeStripeSignature(payload, t, SECRET)}`;
    expect(() => constructStripeEvent(payload.replace('in_1', 'in_2'), header, SECRET, now)).toThrow(/mismatch/);
  });
});

describe('webhook route', () => {
  it('returns 400 for a bad signature and never touches the database', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
    const req = new NextRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: '{}',
      headers: { 'stripe-signature': 't=1,v1=deadbeef' },
    });
    const res = await stripeWebhookRoute(req);
    expect(res.status).toBe(400);
    expect(prisma.billingSubscription.findUnique).not.toHaveBeenCalled();
  });

  it('returns 503 when the webhook secret is not configured', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    const res = await stripeWebhookRoute(new NextRequest('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(503);
  });

  it('processes a correctly signed event', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
    const nowSec = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ ...event('customer.created', {}), created: nowSec });
    const req = new NextRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body,
      headers: { 'stripe-signature': `t=${nowSec},v1=${computeStripeSignature(body, nowSec, SECRET)}` },
    });
    const res = await stripeWebhookRoute(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: 'ignored' });
  });
});

describe('checkout.session.completed', () => {
  it('links a new Team subscription, restores archived replays and seats the owner', async () => {
    const outcome = await handleStripeEvent(
      event('checkout.session.completed', {
        id: 'cs_1',
        object: 'checkout.session',
        mode: 'subscription',
        customer: 'cus_1',
        subscription: 'sub_1',
        client_reference_id: '10',
        metadata: { accountId: '10', plan: 'TEAM', interval: 'year', seats: '5' },
      }),
    );
    expect(outcome).toBe('subscription_linked');
    const upsert = prisma.billingSubscription.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ accountId: 10 });
    expect(upsert.create).toMatchObject({
      plan: 'TEAM',
      interval: 'year',
      seats: 5,
      status: 'active',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    });
    expect(prisma.recording.updateMany).toHaveBeenCalledWith({
      where: { teamMemberId: { in: [1, 2] }, status: 'ARCHIVED' },
      data: { status: 'READY' },
    });
    expect(prisma.billingSeat.createMany).toHaveBeenCalledWith({
      data: [{ accountId: 10, teamMemberId: 1 }],
      skipDuplicates: true,
    });
  });

  it('does not overwrite state already written by customer.subscription.* events', async () => {
    prisma.billingSubscription.findUnique.mockResolvedValue({
      id: 1,
      accountId: 10,
      plan: 'PRO',
      status: 'past_due',
      source: 'STRIPE',
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
    });
    prisma.billingSubscription.upsert.mockImplementation(async (args: { update: Record<string, unknown> }) => ({
      plan: 'PRO',
      status: 'past_due',
      source: 'STRIPE',
      ...args.update,
    }));
    await handleStripeEvent(
      event('checkout.session.completed', {
        id: 'cs_2',
        mode: 'subscription',
        customer: 'cus_1',
        subscription: 'sub_1',
        metadata: { accountId: '10', plan: 'PRO', interval: 'month', seats: '1' },
      }),
    );
    const update = prisma.billingSubscription.upsert.mock.calls[0][0].update;
    expect(update).not.toHaveProperty('status');
    expect(update).not.toHaveProperty('plan');
  });

  it('adds an hour pack once, even if Stripe delivers the event twice', async () => {
    const session = {
      id: 'cs_pack',
      mode: 'payment',
      payment_status: 'paid',
      created: unix('2026-10-20T10:00:00Z'),
      metadata: { kind: 'hours_pack', accountId: '10', packs: '2' },
    };
    prisma.billingCredit.create.mockResolvedValueOnce({});
    expect(await handleStripeEvent(event('checkout.session.completed', session))).toBe('credits_added');
    expect(prisma.billingCredit.create).toHaveBeenCalledWith({
      data: {
        accountId: 10,
        seconds: 20 * 3600,
        purchasedAt: d('2026-10-20T10:00:00Z'),
        expiresAt: d('2027-10-20T10:00:00Z'),
        stripeRef: 'cs_pack',
      },
    });
    prisma.billingCredit.create.mockRejectedValueOnce(uniqueViolation());
    expect(await handleStripeEvent(event('checkout.session.completed', session))).toBe('credits_duplicate');
  });

  it('ignores unpaid payment sessions and unknown accounts', async () => {
    expect(
      await handleStripeEvent(
        event('checkout.session.completed', {
          id: 'cs_x',
          mode: 'payment',
          payment_status: 'unpaid',
          metadata: { kind: 'hours_pack', accountId: '10' },
        }),
      ),
    ).toBe('ignored');
    expect(
      await handleStripeEvent(event('checkout.session.completed', { id: 'cs_y', mode: 'subscription', metadata: {} })),
    ).toBe('account_not_found');
    expect(prisma.billingCredit.create).not.toHaveBeenCalled();
  });
});

describe('customer.subscription.*', () => {
  it('maps the Stripe price to plan / interval and copies seats and period', async () => {
    expect(await handleStripeEvent(event('customer.subscription.updated', stripeSub()))).toBe('subscription_synced');
    const { create, update } = prisma.billingSubscription.upsert.mock.calls[0][0];
    expect(update).toMatchObject({
      plan: 'TEAM',
      interval: 'year',
      seats: 5,
      status: 'active',
      currentPeriodStart: d('2026-10-20T00:00:00Z'),
      currentPeriodEnd: d('2027-10-20T00:00:00Z'),
      stripeSubscriptionId: 'sub_1',
      lastStripeEventAt: d('2026-10-20T10:00:00Z'),
    });
    expect(create.accountId).toBe(10);
  });

  it('applies the same event twice to the same end state', async () => {
    const e = event('customer.subscription.updated', stripeSub({ cancel_at_period_end: true }));
    await handleStripeEvent(e);
    await handleStripeEvent(e);
    const [a, b] = prisma.billingSubscription.upsert.mock.calls.map((c) => {
      const { modifiedAt: _ignored, ...rest } = c[0].update;
      return rest;
    });
    expect(a).toEqual(b);
    expect(a.cancelAtPeriodEnd).toBe(true);
  });

  it('skips events older than the last one applied', async () => {
    prisma.billingSubscription.findUnique.mockResolvedValue({
      id: 1,
      accountId: 10,
      source: 'STRIPE',
      stripeSubscriptionId: 'sub_1',
      lastStripeEventAt: d('2026-10-21T00:00:00Z'),
    });
    expect(await handleStripeEvent(event('customer.subscription.updated', stripeSub(), '2026-10-20T00:00:00Z'))).toBe(
      'stale',
    );
    expect(prisma.billingSubscription.upsert).not.toHaveBeenCalled();
  });

  it('marks the subscription canceled on deletion (plan resolves to Free)', async () => {
    prisma.billingSubscription.findUnique.mockResolvedValue({
      id: 1,
      accountId: 10,
      plan: 'PRO',
      source: 'STRIPE',
      stripeSubscriptionId: 'sub_1',
      lastStripeEventAt: null,
    });
    expect(
      await handleStripeEvent(event('customer.subscription.deleted', stripeSub({ status: 'canceled' }))),
    ).toBe('subscription_canceled');
    expect(prisma.billingSubscription.upsert.mock.calls[0][0].update.status).toBe('canceled');
    expect(prisma.recording.updateMany).not.toHaveBeenCalled();
  });

  it('ignores deletion of an older subscription that was replaced', async () => {
    prisma.billingSubscription.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      where.stripeSubscriptionId
        ? null
        : { id: 1, accountId: 10, source: 'STRIPE', stripeSubscriptionId: 'sub_new', lastStripeEventAt: null },
    );
    expect(await handleStripeEvent(event('customer.subscription.deleted', stripeSub({ id: 'sub_old' })))).toBe(
      'ignored',
    );
    expect(prisma.billingSubscription.upsert).not.toHaveBeenCalled();
  });

  it('never overrides manually granted plans', async () => {
    prisma.billingSubscription.findUnique.mockResolvedValue({ id: 1, accountId: 10, plan: 'LEGACY', source: 'MANUAL' });
    expect(await handleStripeEvent(event('customer.subscription.updated', stripeSub()))).toBe('ignored');
    expect(prisma.billingSubscription.upsert).not.toHaveBeenCalled();
  });
});

describe('invoice.payment_failed', () => {
  it('marks the subscription past_due', async () => {
    prisma.billingSubscription.findUnique.mockResolvedValue({
      id: 3,
      accountId: 10,
      status: 'active',
      source: 'STRIPE',
      lastStripeEventAt: null,
    });
    prisma.billingSubscription.update.mockResolvedValue({});
    expect(
      await handleStripeEvent(
        event('invoice.payment_failed', { id: 'in_1', object: 'invoice', customer: 'cus_1', subscription: 'sub_1' }),
      ),
    ).toBe('payment_failed');
    expect(prisma.billingSubscription.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: expect.objectContaining({ status: 'past_due' }),
    });
  });

  it('reads the subscription from invoice.parent on newer API versions', async () => {
    prisma.billingSubscription.findUnique.mockResolvedValue(null);
    await handleStripeEvent(
      event('invoice.payment_failed', {
        id: 'in_2',
        object: 'invoice',
        parent: { subscription_details: { subscription: 'sub_9' } },
      }),
    );
    expect(prisma.billingSubscription.findUnique).toHaveBeenCalledWith({ where: { stripeSubscriptionId: 'sub_9' } });
  });
});

describe('Stripe REST client', () => {
  it('encodes nested params the way Stripe expects', () => {
    const form = encodeStripeForm({
      mode: 'subscription',
      line_items: [{ price: 'price_1', quantity: 3 }],
      metadata: { accountId: '10' },
      skip: undefined,
    });
    expect(form.toString()).toBe(
      'mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=3&metadata%5BaccountId%5D=10',
    );
  });

  it('sends the secret key as a bearer token through the injected fetch (no network)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.example/cs_1' })));
    const res = await stripeRequest<{ url: string }>(
      'POST',
      '/checkout/sessions',
      { mode: 'payment' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, env: { STRIPE_SECRET_KEY: 'sk_test_dummy' }, idempotencyKey: 'k1' },
    );
    expect(res.url).toBe('https://checkout.example/cs_1');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_dummy');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('k1');
    expect(init.body).toBe('mode=payment');
  });

  it('refuses to run without a secret key', async () => {
    await expect(stripeRequest('POST', '/customers', {}, { env: {} })).rejects.toThrow(/STRIPE_SECRET_KEY/);
  });
});
