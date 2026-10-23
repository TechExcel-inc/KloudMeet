import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: number;
  codeHash: string;
  teamMemberId: number;
  challenge: string;
  next: string | null;
  expiresAt: Date;
  usedAt: Date | null;
};

const store = vi.hoisted(() => ({ rows: [] as Row[] }));

vi.mock('@/lib/db', () => ({
  prisma: {
    desktopAuthHandoff: {
      create: async ({ data }: any) => {
        const row = { id: store.rows.length + 1, usedAt: null, ...data };
        store.rows.push(row);
        return row;
      },
      deleteMany: async () => ({ count: 0 }),
      findUnique: async ({ where }: any) => store.rows.find((r) => r.codeHash === where.codeHash) ?? null,
      updateMany: async ({ where, data }: any) => {
        const hit = store.rows.filter((r) => r.id === where.id && r.usedAt === where.usedAt);
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
  },
}));

import { createDesktopHandoff, pkceChallenge, redeemDesktopHandoff } from '@/lib/desktopAuth';

const NOW = new Date('2026-10-23T10:00:00Z');
const verifier = crypto.randomBytes(32).toString('base64url');
const later = (ms: number) => new Date(NOW.getTime() + ms);

async function handoff() {
  return createDesktopHandoff({ teamMemberId: 7, challenge: pkceChallenge(verifier), next: '/recordings/x', now: NOW });
}

beforeEach(() => {
  store.rows = [];
});

describe('desktop sign-in hand-off', () => {
  it('stores only a hash of the code', async () => {
    const code = await handoff();
    expect(store.rows[0].codeHash).toHaveLength(64);
    expect(store.rows[0].codeHash).not.toContain(code);
  });

  it('redeems once with the matching verifier', async () => {
    const code = await handoff();
    expect(await redeemDesktopHandoff(code, verifier, later(1000))).toEqual({
      ok: true,
      teamMemberId: 7,
      next: '/recordings/x',
    });
    expect((await redeemDesktopHandoff(code, verifier, later(2000))).ok).toBe(false);
  });

  it('rejects the code without the right verifier (intercepted deep link)', async () => {
    const code = await handoff();
    const other = crypto.randomBytes(32).toString('base64url');
    expect((await redeemDesktopHandoff(code, other, later(1000))).ok).toBe(false);
    // The genuine app can still finish.
    expect((await redeemDesktopHandoff(code, verifier, later(2000))).ok).toBe(true);
  });

  it('expires after 5 minutes', async () => {
    const code = await handoff();
    expect((await redeemDesktopHandoff(code, verifier, later(5 * 60 * 1000 + 1))).ok).toBe(false);
  });

  it('rejects malformed input', async () => {
    expect((await redeemDesktopHandoff(undefined, verifier)).ok).toBe(false);
    expect((await redeemDesktopHandoff('x'.repeat(43), 'short')).ok).toBe(false);
  });
});
