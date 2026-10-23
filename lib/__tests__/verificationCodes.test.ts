import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: number;
  target: string;
  code: string;
  type: string;
  expiresAt: Date;
  used: boolean;
  attempts: number;
  createdAt: Date;
};

// Minimal in-memory VerificationCode table covering the queries lib/verificationCodes.ts makes.
const store = vi.hoisted(() => ({ rows: [] as Row[], nextId: 1, now: new Date('2026-10-23T10:00:00Z') }));

function matches(row: Row, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, v]) => {
    const value = (row as any)[k];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('gt' in v) return value > v.gt;
    }
    return value === v;
  });
}

vi.mock('@/lib/db', () => ({
  prisma: {
    verificationCode: {
      findMany: async ({ where }: any) =>
        store.rows.filter((r) => matches(r, where)).sort((a, b) => +b.createdAt - +a.createdAt),
      findFirst: async ({ where }: any) =>
        store.rows.filter((r) => matches(r, where)).sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null,
      create: async ({ data }: any) => {
        const row = { id: store.nextId++, attempts: 0, createdAt: store.now, ...data };
        store.rows.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = store.rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const hit = store.rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
      delete: async ({ where }: any) => {
        store.rows = store.rows.filter((r) => r.id !== where.id);
      },
    },
  },
}));

import {
  MAX_CODE_ATTEMPTS,
  checkCode,
  discardCode,
  issueCode,
} from '@/lib/verificationCodes';

const EMAIL = 'ana@example.com';
const at = (seconds: number) => new Date(store.now.getTime() + seconds * 1000);

async function issueAt(seconds: number) {
  const prev = store.now;
  store.now = at(seconds);
  const result = await issueCode(EMAIL, 'reset', store.now);
  store.now = prev;
  return result;
}

beforeEach(() => {
  store.rows = [];
  store.nextId = 1;
});

describe('issueCode', () => {
  it('creates a 6-digit code valid for 10 minutes', async () => {
    const r = await issueCode(EMAIL, 'signup', store.now);
    expect(r.ok && r.code).toMatch(/^\d{6}$/);
    expect(store.rows[0]).toMatchObject({ type: 'SIGNUP_EMAIL', used: false });
    expect(+store.rows[0].expiresAt - +store.now).toBe(10 * 60 * 1000);
  });

  it('enforces a 60 s cooldown and retires the earlier code on resend', async () => {
    await issueAt(0);
    const tooSoon = await issueAt(30);
    expect(tooSoon).toEqual({ ok: false, reason: 'cooldown', retryAfterSeconds: 30 });

    const second = await issueAt(61);
    expect(second.ok).toBe(true);
    expect(store.rows.map((r) => r.used)).toEqual([true, false]);
  });

  it('caps sends at 5 per hour', async () => {
    for (let i = 0; i < 5; i++) expect((await issueAt(i * 61)).ok).toBe(true);
    const sixth = await issueAt(5 * 61);
    expect(sixth.ok).toBe(false);
    expect(!sixth.ok && sixth.reason).toBe('hourly_limit');
    expect((await issueAt(3601)).ok).toBe(true);
  });

  it('keeps signup and reset codes separate', async () => {
    await issueCode(EMAIL, 'signup', store.now);
    expect((await issueCode(EMAIL, 'reset', store.now)).ok).toBe(true);
  });

  it('lets the user retry at once when the email could not be sent', async () => {
    const r = await issueCode(EMAIL, 'reset', store.now);
    if (r.ok) await discardCode(r.id);
    expect((await issueCode(EMAIL, 'reset', store.now)).ok).toBe(true);
  });
});

describe('checkCode', () => {
  it('accepts the right code and can consume it exactly once', async () => {
    const r = await issueCode(EMAIL, 'reset', store.now);
    const code = r.ok ? r.code : '';
    expect((await checkCode(EMAIL, 'reset', code, { now: at(1) })).ok).toBe(true);
    expect((await checkCode(EMAIL, 'reset', code, { consume: true, now: at(2) })).ok).toBe(true);
    expect((await checkCode(EMAIL, 'reset', code, { consume: true, now: at(3) })).ok).toBe(false);
  });

  it('rejects a code issued for the other purpose', async () => {
    const r = await issueCode(EMAIL, 'signup', store.now);
    expect((await checkCode(EMAIL, 'reset', r.ok ? r.code : '', { now: at(1) })).ok).toBe(false);
  });

  it('burns the code after 5 wrong guesses, even if the 6th is right', async () => {
    const r = await issueCode(EMAIL, 'reset', store.now);
    const code = r.ok ? r.code : '';
    const wrong = code === '000000' ? '111111' : '000000';
    const left: number[] = [];
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      const res = await checkCode(EMAIL, 'reset', wrong, { now: at(1) });
      left.push(res.ok ? -1 : res.attemptsLeft);
    }
    expect(left).toEqual([4, 3, 2, 1, 0]);
    expect((await checkCode(EMAIL, 'reset', code, { now: at(2) })).ok).toBe(false);
  });

  it('rejects an expired code', async () => {
    const r = await issueCode(EMAIL, 'reset', store.now);
    expect((await checkCode(EMAIL, 'reset', r.ok ? r.code : '', { now: at(601) })).ok).toBe(false);
  });

  it('only accepts the latest code after a resend', async () => {
    const first = await issueAt(0);
    const second = await issueAt(61);
    expect((await checkCode(EMAIL, 'reset', first.ok ? first.code : '', { now: at(62) })).ok).toBe(
      first.ok && second.ok && first.code === second.code,
    );
    expect((await checkCode(EMAIL, 'reset', second.ok ? second.code : '', { now: at(63) })).ok).toBe(true);
  });
});
