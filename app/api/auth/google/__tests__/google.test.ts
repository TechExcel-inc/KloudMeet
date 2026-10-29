import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  prisma: {
    teamMember: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    session: { create: vi.fn() },
    desktopAuthHandoff: { create: vi.fn(), deleteMany: vi.fn() },
    accountLinkIntent: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => db);

import { GET as start } from '../route';
import { GET as callback } from '../callback/route';
import { GOOGLE_STATE_COOKIE, encodeGoogleState } from '@/lib/googleOAuth';

const ORIGIN = 'http://localhost:3201';
const { teamMember, session, desktopAuthHandoff, accountLinkIntent } = db.prisma;

function callbackRequest(query: string, cookie?: string) {
  return new NextRequest(`${ORIGIN}/api/auth/google/callback?${query}`, {
    headers: cookie ? { cookie: `${GOOGLE_STATE_COOKIE}=${cookie}` } : {},
  });
}

function mockGoogle(profile: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('/token')
        ? Response.json({ access_token: 'at' })
        : Response.json(profile),
    ),
  );
}

const PROFILE = {
  id: 'g-123',
  email: 'ana@example.com',
  verified_email: true,
  name: 'Ana Silva',
  given_name: 'Ana',
  family_name: 'Silva',
  picture: 'https://example.com/a.png',
};

function errorOf(res: Response) {
  return new URL(res.headers.get('location')!).searchParams.get('error');
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN);
  vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
  teamMember.findUnique.mockResolvedValue(null);
  session.create.mockResolvedValue({});
  desktopAuthHandoff.create.mockResolvedValue({});
  desktopAuthHandoff.deleteMany.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('GET /api/auth/google', () => {
  it('redirects to Google with a state that matches the cookie and keeps a safe next path', async () => {
    const res = await start(new NextRequest(`${ORIGIN}/api/auth/google?next=/recordings/abc`));
    const location = new URL(res.headers.get('location')!);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/google/callback`);

    const cookie = res.cookies.get(GOOGLE_STATE_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    const saved = JSON.parse(Buffer.from(cookie.value, 'base64url').toString());
    expect(saved.state).toBe(location.searchParams.get('state'));
    expect(saved.next).toBe('/recordings/abc');
  });

  it('remembers the desktop app PKCE challenge and ignores a malformed one', async () => {
    const challenge = 'a'.repeat(43);
    const ok = await start(new NextRequest(`${ORIGIN}/api/auth/google?desktop=${challenge}`));
    const saved = JSON.parse(Buffer.from(ok.cookies.get(GOOGLE_STATE_COOKIE)!.value, 'base64url').toString());
    expect(saved.desktop).toBe(challenge);

    const bad = await start(new NextRequest(`${ORIGIN}/api/auth/google?desktop=short`));
    const savedBad = JSON.parse(Buffer.from(bad.cookies.get(GOOGLE_STATE_COOKIE)!.value, 'base64url').toString());
    expect(savedBad.desktop).toBeNull();
  });

  it('drops an unsafe next path', async () => {
    const res = await start(new NextRequest(`${ORIGIN}/api/auth/google?next=https://evil.test`));
    const saved = JSON.parse(Buffer.from(res.cookies.get(GOOGLE_STATE_COOKIE)!.value, 'base64url').toString());
    expect(saved.next).toBeNull();
  });

  it('explains instead of returning a 500 when Google is not configured', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    const res = await start(new NextRequest(`${ORIGIN}/api/auth/google`));
    expect(res.status).toBe(307);
    expect(errorOf(res)).toMatch(/not available/);
  });
});

describe('GET /api/auth/google/callback', () => {
  const cookie = encodeGoogleState({ state: 's1', next: '/recordings/abc' });

  it('rejects a response without our state cookie', async () => {
    mockGoogle(PROFILE);
    const res = await callback(callbackRequest('code=c&state=s1'));
    expect(errorOf(res)).toMatch(/expired/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a mismatched state', async () => {
    mockGoogle(PROFILE);
    const res = await callback(callbackRequest('code=c&state=other', cookie));
    expect(errorOf(res)).toMatch(/expired/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends a cancelled consent back to sign-in without an error', async () => {
    const res = await callback(callbackRequest('error=access_denied&state=s1', cookie));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/?signin=1`);
  });

  it('refuses an unverified Google email', async () => {
    mockGoogle({ ...PROFILE, verified_email: false });
    const res = await callback(callbackRequest('code=c&state=s1', cookie));
    expect(errorOf(res)).toMatch(/verify/);
    expect(teamMember.create).not.toHaveBeenCalled();
  });

  it('creates a new account, signs in and returns to next', async () => {
    mockGoogle(PROFILE);
    teamMember.create.mockResolvedValue({ id: 7, status: 'ACTIVE' });
    const res = await callback(callbackRequest('code=c&state=s1', cookie));

    expect(teamMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        googleId: 'g-123',
        email: 'ana@example.com',
        username: 'ana',
        fullName: 'Ana Silva',
        emailVerified: true,
        createdBy: 'google',
      }),
    });
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('sso_token')).toMatch(/^[0-9a-f]{64}$/);
    expect(location.searchParams.get('next')).toBe('/recordings/abc');
    expect(res.cookies.get(GOOGLE_STATE_COOKIE)?.value).toBe('');
  });

  it('picks a free username when the email local part is taken', async () => {
    mockGoogle(PROFILE);
    teamMember.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) =>
      where.username === 'ana' ? { id: 1 } : null,
    );
    teamMember.create.mockResolvedValue({ id: 7, status: 'ACTIVE' });
    await callback(callbackRequest('code=c&state=s1', cookie));
    expect(teamMember.create.mock.calls[0][0].data.username).toBe('ana1');
  });

  it('links Google to an existing account whose email is verified', async () => {
    mockGoogle(PROFILE);
    teamMember.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) =>
      where.email ? { id: 3, googleId: null, status: 'ACTIVE', avatarUrl: null, emailVerified: true } : null,
    );
    teamMember.update.mockResolvedValue({ id: 3, googleId: 'g-123', status: 'ACTIVE' });
    const res = await callback(callbackRequest('code=c&state=s1', cookie));

    expect(teamMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3 }, data: expect.objectContaining({ googleId: 'g-123' }) }),
    );
    expect(teamMember.create).not.toHaveBeenCalled();
    expect(new URL(res.headers.get('location')!).searchParams.get('sso_token')).toBeTruthy();
  });

  it('does not take over an account whose email is not verified', async () => {
    mockGoogle(PROFILE);
    teamMember.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) =>
      where.email ? { id: 3, googleId: null, status: 'ACTIVE', emailVerified: false } : null,
    );
    const res = await callback(callbackRequest('code=c&state=s1', cookie));
    expect(errorOf(res)).toMatch(/connect Google in My Profile/);
    expect(teamMember.update).not.toHaveBeenCalled();
    expect(teamMember.create).not.toHaveBeenCalled();
    expect(session.create).not.toHaveBeenCalled();
  });

  it('matches the email case-insensitively', async () => {
    mockGoogle({ ...PROFILE, email: 'Ana@Example.com' });
    teamMember.create.mockResolvedValue({ id: 7, status: 'ACTIVE' });
    await callback(callbackRequest('code=c&state=s1', cookie));
    expect(teamMember.findUnique).toHaveBeenCalledWith({ where: { email: 'ana@example.com' } });
    expect(teamMember.create.mock.calls[0][0].data.email).toBe('ana@example.com');
  });

  describe('Connect Google from My Profile', () => {
    const link = 'L'.repeat(43);
    const linkCookie = () => encodeGoogleState({ state: 's1', next: null, link });

    it('binds Google to the account that asked, even with a different email', async () => {
      mockGoogle(PROFILE);
      accountLinkIntent.findUnique.mockResolvedValue({
        id: 1, provider: 'google', teamMemberId: 9, usedAt: null, expiresAt: new Date(Date.now() + 60_000),
      });
      accountLinkIntent.updateMany.mockResolvedValue({ count: 1 });
      teamMember.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        where.id === 9 ? { id: 9, googleId: null, status: 'ACTIVE', email: 'someone@else.com', emailVerified: false } : null,
      );
      const res = await callback(callbackRequest('code=c&state=s1', linkCookie()));

      expect(new URL(res.headers.get('location')!).searchParams.get('linked')).toBe('google');
      const update = teamMember.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 9 });
      expect(update.data.googleId).toBe('g-123');
      // A different address is not marked verified.
      expect(update.data.emailVerified).toBeUndefined();
      expect(session.create).not.toHaveBeenCalled();
    });

    it('refuses a Google account already connected elsewhere', async () => {
      mockGoogle(PROFILE);
      accountLinkIntent.findUnique.mockResolvedValue({
        id: 1, provider: 'google', teamMemberId: 9, usedAt: null, expiresAt: new Date(Date.now() + 60_000),
      });
      accountLinkIntent.updateMany.mockResolvedValue({ count: 1 });
      teamMember.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        where.googleId ? { id: 4, googleId: 'g-123', status: 'ACTIVE' } : null,
      );
      const res = await callback(callbackRequest('code=c&state=s1', linkCookie()));
      expect(errorOf(res)).toMatch(/already connected to another/);
      expect(teamMember.update).not.toHaveBeenCalled();
    });

    it('refuses a used or expired intent', async () => {
      mockGoogle(PROFILE);
      accountLinkIntent.findUnique.mockResolvedValue({
        id: 1, provider: 'google', teamMemberId: 9, usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
      });
      const res = await callback(callbackRequest('code=c&state=s1', linkCookie()));
      expect(errorOf(res)).toMatch(/expired/);
      expect(teamMember.update).not.toHaveBeenCalled();
    });
  });

  it('refuses an email already linked to a different Google account', async () => {
    mockGoogle(PROFILE);
    teamMember.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) =>
      where.email ? { id: 3, googleId: 'g-other', status: 'ACTIVE' } : null,
    );
    const res = await callback(callbackRequest('code=c&state=s1', cookie));
    expect(errorOf(res)).toMatch(/different Google account/);
    expect(session.create).not.toHaveBeenCalled();
  });

  it('refuses a suspended account', async () => {
    mockGoogle(PROFILE);
    teamMember.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) =>
      where.googleId ? { id: 3, googleId: 'g-123', status: 'SUSPENDED' } : null,
    );
    const res = await callback(callbackRequest('code=c&state=s1', cookie));
    expect(errorOf(res)).toMatch(/suspended/);
    expect(session.create).not.toHaveBeenCalled();
  });

  it('hands off to the desktop app instead of signing in the browser', async () => {
    mockGoogle(PROFILE);
    teamMember.create.mockResolvedValue({ id: 7, status: 'ACTIVE' });
    const challenge = 'b'.repeat(43);
    const desktopCookie = encodeGoogleState({ state: 's1', next: '/recordings/abc', desktop: challenge });
    const res = await callback(callbackRequest('code=c&state=s1', desktopCookie));

    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/auth/desktop');
    expect(location.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get('sso_token')).toBeNull();
    expect(session.create).not.toHaveBeenCalled();
    expect(desktopAuthHandoff.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ teamMemberId: 7, challenge, next: '/recordings/abc' }),
    });
    // Only a hash of the code is stored.
    expect(desktopAuthHandoff.create.mock.calls[0][0].data.codeHash).not.toBe(location.searchParams.get('code'));
  });
});
