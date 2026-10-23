/**
 * Optional integration test against a real, disposable MySQL database.
 * Skipped unless BILLING_TEST_DATABASE_URL points at a database whose name ends in `_test`
 * and that has prisma/add_billing.sql applied, e.g.
 *   BILLING_TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/kloudmeet_billing_test npx vitest run lib/billing
 * It creates its own rows and removes them afterwards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env.BILLING_TEST_DATABASE_URL || '';
const dbName = url.split('/').pop()?.split('?')[0] ?? '';
const enabled = Boolean(url) && dbName.endsWith('_test');

describe.skipIf(!enabled)('billing against a real MySQL test database', () => {
  let prisma: import('@prisma/client').PrismaClient;
  let lib: {
    resolveEntitlements: typeof import('@/lib/billing/entitlements').resolveEntitlements;
    getReplayBalance: typeof import('@/lib/billing/entitlements').getReplayBalance;
    recordUsageEvent: typeof import('@/lib/billing/usage').recordUsageEvent;
    handleStripeEvent: typeof import('@/lib/billing/stripeWebhook').handleStripeEvent;
    createPersonalAccount: typeof import('@/lib/billing/account').createPersonalAccount;
  };
  const tag = `bt${Date.now()}`;
  let memberId = 0;
  let accountId = 0;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', url);
    vi.stubEnv('BILLING_ENABLED', 'true');
    vi.stubEnv('STRIPE_PRICE_PRO_MONTH', 'price_pro_month_test');
    ({ prisma } = await import('@/lib/db'));
    lib = {
      ...(await import('@/lib/billing/entitlements')),
      ...(await import('@/lib/billing/usage')),
      ...(await import('@/lib/billing/stripeWebhook')),
      ...(await import('@/lib/billing/account')),
    };
    const member = await prisma.teamMember.create({
      data: { username: tag, email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Billing Test' },
    });
    memberId = member.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.usageEvent.deleteMany({ where: { teamMemberId: memberId } });
    if (accountId) {
      await prisma.billingCredit.deleteMany({ where: { accountId } });
      await prisma.billingSeat.deleteMany({ where: { accountId } });
      await prisma.billingSubscription.deleteMany({ where: { accountId } });
      await prisma.accountMembership.deleteMany({ where: { accountId } });
      await prisma.accountOwnerAndAdmin.deleteMany({ where: { accountId } });
      await prisma.kloudMeetAccount.deleteMany({ where: { id: accountId } });
    }
    await prisma.teamMember.deleteMany({ where: { id: memberId } });
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  it('meters a member without an account, then moves the usage to their new personal account', async () => {
    expect((await lib.resolveEntitlements(memberId)).plan).toBe('FREE');
    const occurredAt = new Date(Date.now() - 10 * 60_000);
    const rec = { kind: 'RECORDING' as const, quantity: 1200, teamMemberId: memberId, sourceRef: `rec:${tag}`, occurredAt };
    expect(await lib.recordUsageEvent(rec)).toBe(true);
    expect(await lib.recordUsageEvent(rec)).toBe(false);
    const free = await lib.resolveEntitlements(memberId);
    expect((await lib.getReplayBalance(free)).usedSeconds).toBe(1200);

    accountId = await lib.createPersonalAccount({ id: memberId, username: tag, fullName: 'Billing Test', email: null });
    const ent = await lib.resolveEntitlements(memberId);
    expect(ent.accountId).toBe(accountId);
    expect((await lib.getReplayBalance(ent)).usedSeconds).toBe(1200);
  });

  it('activates Pro from Stripe webhooks and draws an hour pack after the allowance', async () => {
    const now = Math.floor(Date.now() / 1000);
    await lib.handleStripeEvent({
      id: 'evt_1',
      type: 'customer.subscription.created',
      created: now,
      data: {
        object: {
          id: `sub_${tag}`,
          object: 'subscription',
          customer: `cus_${tag}`,
          status: 'active',
          metadata: { accountId: String(accountId) },
          items: { data: [{ price: { id: 'price_pro_month_test' }, quantity: 1, current_period_start: now - 60, current_period_end: now + 30 * 86400 }] },
        },
      },
    });
    await lib.handleStripeEvent({
      id: 'evt_2',
      type: 'checkout.session.completed',
      created: now,
      data: { object: { id: `cs_${tag}`, mode: 'payment', payment_status: 'paid', created: now, metadata: { kind: 'hours_pack', accountId: String(accountId) } } },
    });
    const ent = await lib.resolveEntitlements(memberId);
    expect(ent.plan).toBe('PRO');
    // Usage before the period start (the 1200 s above) does not count against this period.
    await lib.recordUsageEvent({ kind: 'CAPTIONS', quantity: 10 * 3600 + 900, teamMemberId: memberId, sourceRef: `cap:${tag}` });
    const credit = await prisma.billingCredit.findUnique({ where: { stripeRef: `cs_${tag}` } });
    expect(credit?.consumedSeconds).toBe(900);
    const balance = await lib.getReplayBalance(await lib.resolveEntitlements(memberId));
    expect(balance.includedRemainingSeconds).toBe(0);
    expect(balance.remainingSeconds).toBe(10 * 3600 - 900);
  });
});
