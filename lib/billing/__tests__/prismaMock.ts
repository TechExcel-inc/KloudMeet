import { vi } from 'vitest';

type Fn = ReturnType<typeof vi.fn>;

/** Minimal Prisma stand-in: every model method used by lib/billing is a vi.fn. */
export function createPrismaMock() {
  const model = (...methods: string[]) =>
    Object.fromEntries(methods.map((m) => [m, vi.fn()])) as Record<string, Fn>;
  const mock = {
    billingSubscription: model('findUnique', 'upsert', 'update', 'create'),
    billingCredit: model('findMany', 'create', 'update'),
    billingSeat: model('createMany', 'count'),
    usageEvent: model('create', 'aggregate', 'updateMany'),
    accountOwnerAndAdmin: model('findFirst', 'findMany', 'create'),
    accountMembership: model('findFirst', 'findMany', 'create'),
    kloudMeetAccount: model('create'),
    recording: model('findMany', 'updateMany', 'count'),
    meeting: model('findUnique', 'update', 'updateMany'),
    meetingTranscript: model('findMany'),
    $transaction: vi.fn(),
  };
  return mock;
}

export type PrismaMock = ReturnType<typeof createPrismaMock>;

/** Make every mocked method throw — proves a code path never touches the database. */
export function makeAllThrow(mock: PrismaMock) {
  for (const value of Object.values(mock)) {
    if (typeof value === 'function') {
      (value as Fn).mockImplementation(() => {
        throw new Error('database must not be used');
      });
      continue;
    }
    for (const fn of Object.values(value as Record<string, Fn>)) {
      fn.mockImplementation(() => {
        throw new Error('database must not be used');
      });
    }
  }
}

export function allCalls(mock: PrismaMock): number {
  let n = 0;
  for (const value of Object.values(mock)) {
    if (typeof value === 'function') {
      n += (value as Fn).mock.calls.length;
      continue;
    }
    for (const fn of Object.values(value as Record<string, Fn>)) n += fn.mock.calls.length;
  }
  return n;
}

export function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}
