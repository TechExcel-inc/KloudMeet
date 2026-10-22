import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allCalls, createPrismaMock, makeAllThrow } from './prismaMock';

const db = vi.hoisted(() => ({ prisma: null as unknown }));
vi.mock('@/lib/db', () => db);

import {
  addMonthsClamped,
  allocateOverage,
  computeReplayBalance,
  effectivePlan,
  entitlementsFromSubscription,
  getReplayBalance,
  isBillingEnabled,
  overageFromEvent,
  resolveEntitlements,
  usageWindow,
} from '@/lib/billing/entitlements';
import {
  checkAiSummaryQuota,
  checkCaptionQuotaForRoom,
  checkPublicReplayAllowed,
  checkReplayQuota,
  enforceReplayRetention,
  meetingEndsAt,
} from '@/lib/billing/limits';
import { meterCaptions, meterRecording, recordUsageEvent } from '@/lib/billing/usage';
import { buildBillingSummary } from '@/lib/billing/summary';
import { includedReplaySeconds } from '@/lib/billing/plans';

const H = 3600;
const d = (iso: string) => new Date(iso);

function sub(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    accountId: 10,
    plan: 'PRO',
    status: 'active',
    interval: 'month',
    seats: 1,
    currentPeriodStart: d('2026-10-05T00:00:00Z'),
    currentPeriodEnd: d('2026-11-05T00:00:00Z'),
    cancelAtPeriodEnd: false,
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    source: 'STRIPE',
    lastStripeEventAt: null,
    createdAt: d('2026-10-05T00:00:00Z'),
    modifiedAt: null,
    ...overrides,
  } as Parameters<typeof entitlementsFromSubscription>[2];
}

let prisma: ReturnType<typeof createPrismaMock>;

beforeEach(() => {
  prisma = createPrismaMock();
  db.prisma = prisma;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('BILLING_ENABLED off ⇒ LEGACY, no limits, no database access', () => {
  beforeEach(() => {
    vi.stubEnv('BILLING_ENABLED', '');
    makeAllThrow(prisma);
  });

  it('is off unless explicitly enabled', () => {
    expect(isBillingEnabled({})).toBe(false);
    expect(isBillingEnabled({ BILLING_ENABLED: 'false' })).toBe(false);
    expect(isBillingEnabled({ BILLING_ENABLED: '0' })).toBe(false);
    expect(isBillingEnabled({ BILLING_ENABLED: 'true' })).toBe(true);
    expect(isBillingEnabled({ BILLING_ENABLED: '1' })).toBe(true);
  });

  it('resolves every member to LEGACY with unlimited limits', async () => {
    const ent = await resolveEntitlements(42);
    expect(ent.plan).toBe('LEGACY');
    expect(ent.enabled).toBe(false);
    expect(ent.limits).toMatchObject({
      maxMeetingMinutes: null,
      maxParticipants: null,
      replaySecondsPerPeriod: null,
      replaysKept: null,
      publicReplays: true,
      aiSummariesPerMonth: null,
    });
    expect((await getReplayBalance(ent)).remainingSeconds).toBeNull();
  });

  it('enforces nothing and meters nothing', async () => {
    expect(await checkReplayQuota(42)).toBeNull();
    expect(await checkAiSummaryQuota(42)).toBeNull();
    expect(await checkPublicReplayAllowed(42)).toBeNull();
    expect(await checkCaptionQuotaForRoom(undefined)).toBeNull();
    expect(
      await meetingEndsAt({ id: 1, roomName: 'r', createdByMemberId: 42, actualStartedAt: d('2020-01-01T00:00:00Z') }),
    ).toBeNull();
    expect(await enforceReplayRetention(42)).toBe(0);
    expect(
      await recordUsageEvent({ kind: 'RECORDING', quantity: 60, teamMemberId: 42, sourceRef: 'rec:1' }),
    ).toBe(false);
    expect(await meterRecording({ id: 1, teamMemberId: 42, meetingId: 1, durationSeconds: 60 })).toBe(false);
    expect(await buildBillingSummary(42)).toEqual({ enabled: false });
    expect(allCalls(prisma)).toBe(0);
  });

  it('meterCaptions never writes while disabled', async () => {
    // meterCaptions is only called through meterSafely (which short-circuits); even direct
    // calls must not create usage rows while billing is off.
    prisma.meetingTranscript.findMany.mockResolvedValue([{ captionTime: d('2026-10-10T10:00:00Z') }]);
    prisma.usageEvent.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    await meterCaptions({ id: 7, createdByMemberId: 42 });
    expect(prisma.usageEvent.create).not.toHaveBeenCalled();
  });
});

describe('effectivePlan', () => {
  it('treats a missing row as FREE', () => expect(effectivePlan(null)).toBe('FREE'));
  it('keeps paid plans while active, trialing or past_due', () => {
    expect(effectivePlan(sub({ status: 'active' }))).toBe('PRO');
    expect(effectivePlan(sub({ status: 'trialing' }))).toBe('PRO');
    expect(effectivePlan(sub({ status: 'past_due' }))).toBe('PRO');
  });
  it('drops to FREE when canceled / incomplete / unpaid', () => {
    expect(effectivePlan(sub({ status: 'canceled' }))).toBe('FREE');
    expect(effectivePlan(sub({ status: 'incomplete' }))).toBe('FREE');
    expect(effectivePlan(sub({ status: 'unpaid' }))).toBe('FREE');
  });
  it('honours manual Enterprise / Legacy grants', () => {
    expect(effectivePlan(sub({ plan: 'LEGACY', source: 'MANUAL', status: 'active' }))).toBe('LEGACY');
    expect(effectivePlan(sub({ plan: 'ENTERPRISE', source: 'MANUAL', status: 'past_due' }))).toBe('ENTERPRISE');
    expect(effectivePlan(sub({ plan: 'ENTERPRISE', source: 'MANUAL', status: 'canceled' }))).toBe('FREE');
  });
});

describe('period boundaries', () => {
  it('uses the UTC calendar month without an anchor (Free)', () => {
    expect(usageWindow(null, d('2026-10-31T23:59:59.999Z'))).toEqual({
      start: d('2026-10-01T00:00:00Z'),
      end: d('2026-11-01T00:00:00Z'),
    });
    expect(usageWindow(null, d('2026-11-01T00:00:00Z')).start).toEqual(d('2026-11-01T00:00:00Z'));
  });

  it('anchors monthly windows on the subscription period start', () => {
    const anchor = d('2026-10-05T12:00:00Z');
    expect(usageWindow(anchor, d('2026-10-05T12:00:00Z'))).toEqual({
      start: anchor,
      end: d('2026-11-05T12:00:00Z'),
    });
    // One millisecond before the boundary is still the first window…
    expect(usageWindow(anchor, d('2026-11-05T11:59:59.999Z')).start).toEqual(anchor);
    // …and the boundary itself opens the next one.
    expect(usageWindow(anchor, d('2026-11-05T12:00:00Z')).start).toEqual(d('2026-11-05T12:00:00Z'));
  });

  it('gives yearly plans a fresh allowance every month', () => {
    const anchor = d('2026-01-15T00:00:00Z');
    expect(usageWindow(anchor, d('2026-07-20T00:00:00Z'))).toEqual({
      start: d('2026-07-15T00:00:00Z'),
      end: d('2026-08-15T00:00:00Z'),
    });
  });

  it('clamps month-end anchors like Stripe (Jan 31 → Feb 28 → Mar 31)', () => {
    const anchor = d('2026-01-31T00:00:00Z');
    expect(addMonthsClamped(anchor, 1)).toEqual(d('2026-02-28T00:00:00Z'));
    expect(addMonthsClamped(anchor, 2)).toEqual(d('2026-03-31T00:00:00Z'));
    expect(usageWindow(anchor, d('2026-03-01T00:00:00Z'))).toEqual({
      start: d('2026-02-28T00:00:00Z'),
      end: d('2026-03-31T00:00:00Z'),
    });
  });

  it('uses the anchored window only for paid Stripe plans', () => {
    const now = d('2026-10-20T00:00:00Z');
    expect(entitlementsFromSubscription(1, 10, sub(), now).window.start).toEqual(d('2026-10-05T00:00:00Z'));
    const canceled = entitlementsFromSubscription(1, 10, sub({ status: 'canceled' }), now);
    expect(canceled.plan).toBe('FREE');
    expect(canceled.window.start).toEqual(d('2026-10-01T00:00:00Z'));
  });
});

describe('Team pooling', () => {
  it('pools 15 h per seat across the team', () => {
    expect(includedReplaySeconds('TEAM', 4)).toBe(60 * H);
    expect(includedReplaySeconds('PRO', 4)).toBe(10 * H);
    expect(includedReplaySeconds('FREE', 1)).toBe(2 * H);
    expect(includedReplaySeconds('LEGACY', 1)).toBeNull();
  });

  it('sums usage for the whole account, not just the caller', async () => {
    vi.stubEnv('BILLING_ENABLED', 'true');
    const now = d('2026-10-20T00:00:00Z');
    const ent = entitlementsFromSubscription(1, 10, sub({ plan: 'TEAM', seats: 4 }), now);
    prisma.usageEvent.aggregate.mockResolvedValue({ _sum: { quantity: 50 * H } });
    prisma.billingCredit.findMany.mockResolvedValue([]);
    const balance = await getReplayBalance(ent, now);
    expect(balance.includedSeconds).toBe(60 * H);
    expect(balance.remainingSeconds).toBe(10 * H);
    const where = prisma.usageEvent.aggregate.mock.calls[0][0].where;
    expect(where.accountId).toBe(10);
    expect(where).not.toHaveProperty('teamMemberId');
    expect(where.kind).toEqual({ in: ['RECORDING', 'CAPTIONS'] });
  });

  it('tracks members without an account on their own', async () => {
    vi.stubEnv('BILLING_ENABLED', 'true');
    prisma.accountOwnerAndAdmin.findFirst.mockResolvedValue(null);
    prisma.accountMembership.findFirst.mockResolvedValue(null);
    prisma.usageEvent.aggregate.mockResolvedValue({ _sum: { quantity: 2 * H } });
    const ent = await resolveEntitlements(77);
    expect(ent.plan).toBe('FREE');
    const res = await checkReplayQuota(77);
    expect(res?.status).toBe(402);
    expect(await res?.json()).toMatchObject({ code: 'BILLING_LIMIT', limit: 'replay_hours', upgradeUrl: '/account/billing' });
    expect(prisma.usageEvent.aggregate.mock.calls[0][0].where).toMatchObject({ accountId: null, teamMemberId: 77 });
  });
});

describe('hour packs (credits)', () => {
  const now = d('2026-10-20T00:00:00Z');
  const lots = [
    { id: 1, seconds: 10 * H, consumedSeconds: 0, expiresAt: d('2027-06-01T00:00:00Z') },
    { id: 2, seconds: 10 * H, consumedSeconds: 2 * H, expiresAt: d('2027-03-01T00:00:00Z') },
    { id: 3, seconds: 10 * H, consumedSeconds: 0, expiresAt: d('2026-10-01T00:00:00Z') }, // expired
  ];

  it('are only drawn after the plan allowance is used up', () => {
    expect(overageFromEvent(10 * H, 2 * H, H)).toBe(0);
    expect(overageFromEvent(10 * H, 9.5 * H, H)).toBe(0.5 * H);
    expect(overageFromEvent(10 * H, 12 * H, H)).toBe(H);
    expect(overageFromEvent(null, 999 * H, H)).toBe(0);
  });

  it('are consumed earliest-expiry first, skipping expired packs', () => {
    expect(allocateOverage(lots, 9 * H, now)).toEqual([
      { id: 2, consume: 8 * H },
      { id: 1, consume: H },
    ]);
  });

  it('add unexpired, unconsumed seconds to the remaining balance', () => {
    const balance = computeReplayBalance({ includedSeconds: 10 * H, usedSeconds: 12 * H, credits: lots, now });
    expect(balance.includedRemainingSeconds).toBe(0);
    expect(balance.creditSeconds).toBe(18 * H);
    expect(balance.remainingSeconds).toBe(18 * H);
    const under = computeReplayBalance({ includedSeconds: 10 * H, usedSeconds: 4 * H, credits: lots, now });
    expect(under.remainingSeconds).toBe(6 * H + 18 * H);
  });

  it('let a Pro account keep recording past its allowance while packs remain', async () => {
    vi.stubEnv('BILLING_ENABLED', 'true');
    prisma.accountOwnerAndAdmin.findFirst.mockResolvedValue({ accountId: 10 });
    prisma.billingSubscription.findUnique.mockResolvedValue(sub());
    prisma.usageEvent.aggregate.mockResolvedValue({ _sum: { quantity: 11 * H } });
    prisma.billingCredit.findMany.mockResolvedValue([lots[0]]);
    expect(await checkReplayQuota(1)).toBeNull();
    prisma.billingCredit.findMany.mockResolvedValue([{ ...lots[0], consumedSeconds: 10 * H }]);
    expect((await checkReplayQuota(1))?.status).toBe(402);
  });
});

describe('Free limits with billing on', () => {
  beforeEach(() => {
    vi.stubEnv('BILLING_ENABLED', 'true');
    prisma.accountOwnerAndAdmin.findFirst.mockResolvedValue(null);
    prisma.accountMembership.findFirst.mockResolvedValue(null);
  });

  it('caps AI summaries at 3 per month', async () => {
    prisma.usageEvent.aggregate.mockResolvedValue({ _sum: { quantity: 2 } });
    expect(await checkAiSummaryQuota(5)).toBeNull();
    prisma.usageEvent.aggregate.mockResolvedValue({ _sum: { quantity: 3 } });
    const res = await checkAiSummaryQuota(5);
    expect(res?.status).toBe(402);
    expect((await res?.json()).limit).toBe('ai_summaries');
  });

  it('blocks public replays', async () => {
    expect((await checkPublicReplayAllowed(5))?.status).toBe(402);
  });

  it('ends meetings 40 minutes after the room started', async () => {
    const endsAt = await meetingEndsAt({
      id: 1,
      roomName: 'r',
      createdByMemberId: 5,
      actualStartedAt: d('2026-10-20T10:00:00Z'),
    });
    expect(endsAt).toEqual(d('2026-10-20T10:40:00Z'));
  });

  it('starts the clock now when the room start was not recorded yet', async () => {
    const now = d('2026-10-20T10:00:00Z');
    prisma.meeting.updateMany.mockResolvedValue({ count: 1 });
    const endsAt = await meetingEndsAt({ id: 9, roomName: 'r', createdByMemberId: 5, actualStartedAt: null }, now);
    expect(endsAt).toEqual(d('2026-10-20T10:40:00Z'));
    expect(prisma.meeting.updateMany).toHaveBeenCalledWith({
      where: { id: 9, actualStartedAt: null },
      data: { actualStartedAt: now },
    });
  });

  it('archives (never deletes) all but the 3 latest replays', async () => {
    prisma.recording.findMany.mockResolvedValue([{ id: 9 }, { id: 8 }, { id: 7 }, { id: 6 }, { id: 5 }]);
    prisma.recording.updateMany.mockResolvedValue({ count: 2 });
    expect(await enforceReplayRetention(5)).toBe(2);
    expect(prisma.recording.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [6, 5] }, status: 'READY' },
      data: { status: 'ARCHIVED' },
    });
  });
});
