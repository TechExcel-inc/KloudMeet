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
  },
}));
vi.mock('@/lib/db', () => db);

import { GET as start } from '../route';
import { GET as callback } from '../callback/route';
import { GOOGLE_STATE_COOKIE, encodeGoogleState } from '@/lib/googleOAuth';

const ORIGIN = 'http://localhost:3201';
const { teamMember, session } = db.prisma;

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

  it('links Google to an existing account with the same email', async () => {
    mockGoogle(PROFILE);
    teamMember.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) =>
      where.email ? { id: 3, googleId: null, status: 'ACTIVE', avatarUrl: null, emailVerifiedAt: null } : null,
    );
    teamMember.update.mockResolvedValue({ id: 3, googleId: 'g-123', status: 'ACTIVE' });
    const res = await callback(callbackRequest('code=c&state=s1', cookie));

    expect(teamMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3 }, data: expect.objectContaining({ googleId: 'g-123' }) }),
    );
    expect(teamMember.create).not.toHaveBeenCalled();
    expect(new URL(res.headers.get('location')!).searchParams.get('sso_token')).toBeTruthy();
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
});
