import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock, uniqueViolation } from './prismaMock';

const db = vi.hoisted(() => ({ prisma: null as unknown }));
vi.mock('@/lib/db', () => db);

import {
  distinctCaptionMinutes,
  meterAiSummary,
  meterCaptions,
  meterRecording,
  meterSafely,
  recordUsageEvent,
} from '@/lib/billing/usage';

const H = 3600;
const d = (iso: string) => new Date(iso);

let prisma: ReturnType<typeof createPrismaMock>;

beforeEach(() => {
  vi.stubEnv('BILLING_ENABLED', 'true');
  prisma = createPrismaMock();
  db.prisma = prisma;
  // Member 1 owns account 10 on Pro (10 h / month).
  prisma.accountOwnerAndAdmin.findFirst.mockResolvedValue({ accountId: 10 });
  prisma.billingSubscription.findUnique.mockResolvedValue({
    accountId: 10,
    plan: 'PRO',
    status: 'active',
    interval: 'month',
    seats: 1,
    source: 'STRIPE',
    cancelAtPeriodEnd: false,
    currentPeriodStart: d('2026-10-01T00:00:00Z'),
    currentPeriodEnd: d('2026-11-01T00:00:00Z'),
    stripeCustomerId: 'cus_1',
  });
  prisma.usageEvent.create.mockResolvedValue({});
  prisma.usageEvent.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
  prisma.billingCredit.findMany.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe('idempotent metering', () => {
  it('writes rec:<id> once; a repeated egress_ended is ignored', async () => {
    const rec = { id: 55, teamMemberId: 1, meetingId: 3, durationSeconds: 1800 };
    expect(await meterRecording(rec)).toBe(true);
    expect(prisma.usageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 10,
        teamMemberId: 1,
        meetingId: 3,
        kind: 'RECORDING',
        quantity: 1800,
        sourceRef: 'rec:55',
      }),
    });

    prisma.usageEvent.create.mockRejectedValueOnce(uniqueViolation());
    expect(await meterRecording(rec)).toBe(false);
    expect(prisma.billingCredit.update).not.toHaveBeenCalled();
  });

  it('skips recordings without a duration', async () => {
    expect(await meterRecording({ id: 1, teamMemberId: 1, meetingId: 1, durationSeconds: null })).toBe(false);
    expect(await meterRecording({ id: 1, teamMemberId: 1, meetingId: 1, durationSeconds: 0 })).toBe(false);
    expect(prisma.usageEvent.create).not.toHaveBeenCalled();
  });

  it('rethrows non-duplicate database errors (meterSafely logs them instead)', async () => {
    prisma.usageEvent.create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      recordUsageEvent({ kind: 'RECORDING', quantity: 5, teamMemberId: 1, sourceRef: 'rec:9' }),
    ).rejects.toThrow('db down');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    prisma.usageEvent.create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      meterSafely('rec:9', () => recordUsageEvent({ kind: 'RECORDING', quantity: 5, teamMemberId: 1, sourceRef: 'rec:9' })),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('counts distinct caption minutes', () => {
    expect(
      distinctCaptionMinutes([
        d('2026-10-20T10:00:05Z'),
        d('2026-10-20T10:00:55Z'),
        d('2026-10-20T10:01:00Z'),
        d('2026-10-20T10:07:30Z'),
      ]),
    ).toBe(3);
  });

  it('meters captions as cap:<meetingId> and never twice for the same total', async () => {
    prisma.meetingTranscript.findMany.mockResolvedValue([
      { captionTime: d('2026-10-20T10:00:05Z') },
      { captionTime: d('2026-10-20T10:00:40Z') },
      { captionTime: d('2026-10-20T10:02:00Z') },
    ]);
    expect(await meterCaptions({ id: 7, createdByMemberId: 1 })).toBe(120);
    expect(prisma.usageEvent.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ kind: 'CAPTIONS', quantity: 120, sourceRef: 'cap:7', teamMemberId: 1 }),
    });

    // Second room_finished for the same meeting: already metered → nothing new.
    prisma.usageEvent.create.mockClear();
    prisma.usageEvent.aggregate.mockResolvedValue({ _sum: { quantity: 120 } });
    expect(await meterCaptions({ id: 7, createdByMemberId: 1 })).toBe(0);
    expect(prisma.usageEvent.create).not.toHaveBeenCalled();
  });

  it('meters only the difference when a resumed meeting adds captions', async () => {
    prisma.meetingTranscript.findMany.mockResolvedValue([
      { captionTime: d('2026-10-20T10:00:05Z') },
      { captionTime: d('2026-10-20T10:02:00Z') },
      { captionTime: d('2026-10-20T11:30:00Z') },
    ]);
    prisma.usageEvent.aggregate.mockResolvedValue({ _sum: { quantity: 120 } });
    expect(await meterCaptions({ id: 7, createdByMemberId: 1 })).toBe(60);
    expect(prisma.usageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantity: 60, sourceRef: 'cap:7:180' }),
    });
  });

  it('records one AI summary per generation with a timestamped ref', async () => {
    await meterAiSummary(1, 7, d('2026-10-20T10:00:00Z'));
    expect(prisma.usageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'AI_SUMMARY',
        quantity: 1,
        sourceRef: `ai:7:${d('2026-10-20T10:00:00Z').getTime()}`,
      }),
    });
    expect(prisma.billingCredit.findMany).not.toHaveBeenCalled();
  });
});

describe('hour packs are drawn when an event crosses the allowance', () => {
  it('charges only the overflow, earliest-expiring pack first', async () => {
    // After this 30-min event the account has used 10 h 10 min of its 10 h.
    prisma.usageEvent.aggregate.mockResolvedValue({ _sum: { quantity: 10 * H + 600 } });
    prisma.billingCredit.findMany.mockResolvedValue([
      { id: 2, seconds: 10 * H, consumedSeconds: 0, expiresAt: d('2027-09-01T00:00:00Z') },
      { id: 1, seconds: 10 * H, consumedSeconds: 0, expiresAt: d('2027-02-01T00:00:00Z') },
    ]);
    await recordUsageEvent({
      kind: 'RECORDING',
      quantity: 1800,
      teamMemberId: 1,
      sourceRef: 'rec:77',
      occurredAt: d('2026-10-20T10:00:00Z'),
    });
    expect(prisma.billingCredit.update).toHaveBeenCalledTimes(1);
    expect(prisma.billingCredit.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { consumedSeconds: { increment: 600 } },
    });
  });

  it('does not touch packs while within the allowance', async () => {
    prisma.usageEvent.aggregate.mockResolvedValue({ _sum: { quantity: 5 * H } });
    prisma.billingCredit.findMany.mockResolvedValue([
      { id: 1, seconds: 10 * H, consumedSeconds: 0, expiresAt: d('2027-02-01T00:00:00Z') },
    ]);
    await recordUsageEvent({ kind: 'CAPTIONS', quantity: 600, teamMemberId: 1, sourceRef: 'cap:1' });
    expect(prisma.billingCredit.update).not.toHaveBeenCalled();
  });
});
