import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  prisma: {
    teamMember: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    session: { create: vi.fn() },
    accountLinkIntent: { findUnique: vi.fn(), updateMany: vi.fn() },
    kloudMeetAccount: { findMany: vi.fn() },
    accountMembership: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => db);

import { GET as start } from '../route';
import { POST as callback } from '../callback/route';
import { KLOUD_STATE_COOKIE, encodeKloudState } from '@/lib/kloudAuth';

const ORIGIN = 'http://localhost:3201';
const { teamMember, session, accountLinkIntent, kloudMeetAccount, accountMembership } = db.prisma;

const PROFILE = { UserID: 501, Email: 'Wei@Example.com', Name: 'Wei', Mobile: '13800000000', AvatarUrl: null };
const SCHOOLS = [{ SchoolID: 77, SchoolName: 'Acme' }];

/** Stubs PeerTime (profile, company list) and MeetingServer (role in each company). */
function mockKloud(profile: Record<string, unknown> | null = PROFILE, role = 2) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/User/UserProfile')) {
        return profile ? Response.json({ RetCode: 0, RetData: profile }) : Response.json({ RetCode: -1 });
      }
      if (url.includes('/School/UserSchoolList')) return Response.json({ RetCode: 0, RetData: SCHOOLS });
      if (url.includes('/company_member/member')) return Response.json({ code: 0, data: { role } });
      return new Response('not found', { status: 404 });
    }),
  );
}

function callbackRequest(form: Record<string, string>, cookie?: string) {
  return new NextRequest(`${ORIGIN}/api/auth/kloud/callback`, {
    method: 'POST',
    body: new URLSearchParams(form),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie: `${KLOUD_STATE_COOKIE}=${cookie}` } : {}),
    },
  });
}

const location = (res: Response) => new URL(res.headers.get('location')!);
const errorOf = (res: Response) => location(res).searchParams.get('error');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN);
  vi.stubEnv('NEXT_PUBLIC_KLOUD_SIGN_IN', '1');
  vi.stubEnv('KLOUD_WEB_ORIGIN', 'https://kloud.cn');
  teamMember.findUnique.mockResolvedValue(null);
  teamMember.update.mockResolvedValue({});
  session.create.mockResolvedValue({});
  kloudMeetAccount.findMany.mockResolvedValue([]);
  accountMembership.updateMany.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('GET /api/auth/kloud', () => {
  it('sends the browser to kloud.cn with a state that matches the cookie', async () => {
    const res = await start(new NextRequest(`${ORIGIN}/api/auth/kloud?next=/recordings/abc`));
    const to = location(res);
    expect(to.origin).toBe('https://kloud.cn');
    expect(to.pathname).toBe('/kloudmeet/connect');
    expect(to.searchParams.get('return')).toBe(`${ORIGIN}/api/auth/kloud/callback`);
    const cookie = res.cookies.get(KLOUD_STATE_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    const saved = JSON.parse(Buffer.from(cookie!.value, 'base64url').toString('utf8'));
    expect(saved.state).toBe(to.searchParams.get('state'));
    expect(saved.next).toBe('/recordings/abc');
  });

  it('stays off until the kloud.cn page is live', async () => {
    vi.stubEnv('NEXT_PUBLIC_KLOUD_SIGN_IN', '');
    const res = await start(new NextRequest(`${ORIGIN}/api/auth/kloud`));
    expect(errorOf(res)).toMatch(/not available/);
  });
});

describe('POST /api/auth/kloud/callback', () => {
  const cookie = encodeKloudState({ state: 's1', next: null, link: null });

  it('rejects a post without our state cookie or with another state', async () => {
    mockKloud();
    expect(errorOf(await callback(callbackRequest({ state: 's1', token: 'tok-12345' })))).toMatch(/expired/);
    expect(errorOf(await callback(callbackRequest({ state: 's2', token: 'tok-12345' }, cookie)))).toMatch(/expired/);
    expect(session.create).not.toHaveBeenCalled();
  });

  it('signs in the account already bound to this Kloud user', async () => {
    mockKloud();
    teamMember.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      where.kloudUserId === '501' ? { id: 3, status: 'ACTIVE' } : null,
    );
    const res = await callback(callbackRequest({ state: 's1', token: 'tok-12345' }, cookie));
    expect(res.status).toBe(303);
    expect(location(res).searchParams.get('sso_token')).toBeTruthy();
    expect(location(res).searchParams.get('via')).toBe('kloud');
    expect(session.create.mock.calls[0][0].data.teamMemberId).toBe(3);
    // The company list is kept for mapping; the Kloud token is not stored anywhere.
    expect(teamMember.update.mock.calls[0][0].data.kloudCompanies).toEqual([{ id: '77', name: 'Acme', role: 2 }]);
    expect(JSON.stringify(teamMember.update.mock.calls)).not.toContain('tok-12345');
  });

  it('does not take over an existing account with the same email', async () => {
    mockKloud();
    teamMember.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      where.email === 'wei@example.com' ? { id: 4 } : null,
    );
    const res = await callback(callbackRequest({ state: 's1', token: 'tok-12345' }, cookie));
    expect(errorOf(res)).toMatch(/connect Kloud in My Profile/);
    expect(teamMember.create).not.toHaveBeenCalled();
    expect(session.create).not.toHaveBeenCalled();
  });

  it('creates a new account bound to the Kloud user, email not yet verified', async () => {
    mockKloud();
    teamMember.create.mockResolvedValue({ id: 8, status: 'ACTIVE' });
    await callback(callbackRequest({ state: 's1', token: 'tok-12345' }, cookie));
    const data = teamMember.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kloudUserId: '501', email: 'wei@example.com', emailVerified: false, createdBy: 'kloud' });
    expect(session.create).toHaveBeenCalled();
  });

  it('refuses a token Kloud does not accept', async () => {
    mockKloud(null);
    const res = await callback(callbackRequest({ state: 's1', token: 'tok-12345' }, cookie));
    expect(errorOf(res)).toMatch(/failed/);
    expect(session.create).not.toHaveBeenCalled();
  });

  it('refuses an anonymous meeting account', async () => {
    mockKloud({ ...PROFILE, IsAnonymousUser: true });
    const res = await callback(callbackRequest({ state: 's1', token: 'tok-12345' }, cookie));
    expect(errorOf(res)).toMatch(/failed/);
  });

  it('adds the person to Kloud Meet companies mapped to their Kloud companies, and drops stale ones', async () => {
    mockKloud();
    teamMember.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      where.kloudUserId ? { id: 3, status: 'ACTIVE' } : null,
    );
    kloudMeetAccount.findMany.mockResolvedValue([{ id: 40 }]);
    accountMembership.findUnique.mockResolvedValue(null);
    await callback(callbackRequest({ state: 's1', token: 'tok-12345' }, cookie));

    expect(kloudMeetAccount.findMany.mock.calls[0][0].where.kloudCompanyId).toEqual({ in: ['77'] });
    expect(accountMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ accountId: 40, teamMemberId: 3, joinedVia: 'KLOUD', status: 'ACTIVE' }),
    });
    // Only memberships that came from Kloud are ended.
    expect(accountMembership.updateMany.mock.calls[0][0].where).toMatchObject({
      teamMemberId: 3,
      joinedVia: 'KLOUD',
      accountId: { notIn: [40] },
    });
  });

  describe('Connect Kloud account from My Profile', () => {
    const link = 'K'.repeat(43);
    const linkCookie = encodeKloudState({ state: 's1', next: null, link });
    const intent = { id: 1, provider: 'kloud', teamMemberId: 9, usedAt: null, expiresAt: new Date(Date.now() + 60_000) };

    it('binds the Kloud user to the account that asked, whatever its email', async () => {
      mockKloud();
      accountLinkIntent.findUnique.mockResolvedValue(intent);
      accountLinkIntent.updateMany.mockResolvedValue({ count: 1 });
      teamMember.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        where.id === 9 ? { id: 9, kloudUserId: null, status: 'ACTIVE', email: 'other@x.com' } : null,
      );
      const res = await callback(callbackRequest({ state: 's1', token: 'tok-12345' }, linkCookie));
      expect(location(res).searchParams.get('linked')).toBe('kloud');
      expect(teamMember.update.mock.calls[0][0]).toMatchObject({ where: { id: 9 }, data: { kloudUserId: '501' } });
      expect(session.create).not.toHaveBeenCalled();
    });

    it('refuses a Kloud user already bound to another account', async () => {
      mockKloud();
      accountLinkIntent.findUnique.mockResolvedValue(intent);
      accountLinkIntent.updateMany.mockResolvedValue({ count: 1 });
      teamMember.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        where.kloudUserId ? { id: 4, kloudUserId: '501', status: 'ACTIVE' } : null,
      );
      const res = await callback(callbackRequest({ state: 's1', token: 'tok-12345' }, linkCookie));
      expect(errorOf(res)).toMatch(/already connected to another/);
      expect(teamMember.update).not.toHaveBeenCalled();
    });
  });
});
