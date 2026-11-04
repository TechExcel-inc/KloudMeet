import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  prisma: {
    session: { findUnique: vi.fn() },
    meeting: { findMany: vi.fn() },
    recording: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => db);

import { GET as days } from '../meetings/days/route';
import { GET as sync } from '../recordings/sync/route';

const { session, meeting, recording } = db.prisma;
const ACTIVE = { id: 5, status: 'ACTIVE' };

function req(path: string, authorization = 'Bearer s') {
  return new NextRequest(`http://localhost${path}`, { headers: { authorization } });
}

const routes = [
  ['meetings/days', () => days(req('/api/account/meetings/days?from=2026-11-01&to=2026-12-01'))],
  ['recordings/sync', () => sync(req('/api/account/recordings/sync'))],
] as const;

afterEach(() => vi.resetAllMocks());

describe.each(routes)('%s', (_name, call) => {
  it('turns away an expired session', async () => {
    session.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() - 1000), teamMember: ACTIVE });

    expect((await call()).status).toBe(401);
    expect(meeting.findMany).not.toHaveBeenCalled();
    expect(recording.findMany).not.toHaveBeenCalled();
  });

  it('turns away a suspended account', async () => {
    session.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      teamMember: { ...ACTIVE, status: 'SUSPENDED' },
    });

    expect((await call()).status).toBe(401);
  });

  it('turns away an unknown token', async () => {
    session.findUnique.mockResolvedValue(null);

    expect((await call()).status).toBe(401);
  });
});

it('meetings/days still answers a live session', async () => {
  session.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), teamMember: ACTIVE });
  meeting.findMany.mockResolvedValue([]);

  const res = await routes[0][1]();

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ dates: [] });
});
