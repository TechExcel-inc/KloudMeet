import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateMany } = vi.hoisted(() => ({ updateMany: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { teamMember: { updateMany: (a: unknown) => updateMany(a) } } }));

import {
  clearKloudSubsystemCache,
  ensureKloudMembership,
  kloudSubsystemConfig,
  type SubsystemMember,
} from '@/lib/kloudSubsystem.server';

const member = (over: Partial<SubsystemMember> = {}): SubsystemMember => ({
  id: 42,
  email: 'pat@example.com',
  emailVerified: true,
  username: 'pat',
  fullName: 'Pat Lee',
  phone: '+15550100',
  phoneVerified: false,
  kloudUserId: null,
  ...over,
});

const ok = (retData: Record<string, unknown>) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify({ RetCode: 0, RetData: retData }), { status: 200 }));

beforeEach(() => {
  clearKloudSubsystemCache();
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  vi.stubEnv('SIMEET_KLOUD_SUBSYSTEM_ID', '219000');
  vi.stubEnv('SIMEET_KLOUD_SUBSYSTEM_TOKEN', 'sub-secret');
});

afterEach(() => vi.unstubAllEnvs());

describe('kloudSubsystemConfig', () => {
  it('is off unless both settings are present', () => {
    expect(kloudSubsystemConfig()).toEqual({ id: 219000, token: 'sub-secret' });
    vi.stubEnv('SIMEET_KLOUD_SUBSYSTEM_TOKEN', '');
    expect(kloudSubsystemConfig()).toBeNull();
  });
});

describe('ensureKloudMembership', () => {
  it('asks Kloud with the subsystem token and only verified contact details', async () => {
    const fetchImpl = ok({ UserID: 501, UserToken: 'kt', ExpiresIn: 86400, Role: 2 });
    const m = await ensureKloudMembership(member(), { fetchImpl, now: 0 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/peertime/V1/P1Integration/SubSystemExchangeToken');
    expect(init.headers.SubSystemToken).toBe('sub-secret');
    expect(JSON.parse(init.body)).toEqual({
      SubSystemID: 219000,
      UniqueID: 'simeet:42',
      Email: 'pat@example.com',
      LoginName: 'Pat Lee',
    });
    expect(m).toMatchObject({ kloudUserId: '501', token: 'kt', role: 2, isAdmin: false, expiresAt: 86_400_000 });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 42, kloudUserId: null }, data: expect.objectContaining({ kloudUserId: '501' }) }),
    );
  });

  it('does not send an unverified email', async () => {
    const fetchImpl = ok({ UserID: 501, UserToken: 'kt', ExpiresIn: 86400, Role: 2 });
    await ensureKloudMembership(member({ emailVerified: false }), { fetchImpl, now: 0 });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).Email).toBeUndefined();
  });

  it("treats Kloud's owners and admins as subsystem admins", async () => {
    const fetchImpl = ok({ UserID: 501, UserToken: 'kt', ExpiresIn: 86400, Role: 7 });
    await expect(ensureKloudMembership(member(), { fetchImpl, now: 0 })).resolves.toMatchObject({ isAdmin: true });
  });

  it('reuses the token until an hour before it expires', async () => {
    const fetchImpl = ok({ UserID: 501, UserToken: 'kt', ExpiresIn: 86400, Role: 2 });
    await ensureKloudMembership(member(), { fetchImpl, now: 0 });
    await ensureKloudMembership(member(), { fetchImpl, now: 22 * 3600_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await ensureKloudMembership(member(), { fetchImpl, now: 23.5 * 3600_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps an existing link to a different Kloud user', async () => {
    const fetchImpl = ok({ UserID: 501, UserToken: 'kt', ExpiresIn: 86400, Role: 2 });
    await ensureKloudMembership(member({ kloudUserId: '777' }), { fetchImpl, now: 0 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('returns null when Kloud refuses, and when the subsystem is off', async () => {
    const refused = vi.fn().mockResolvedValue(new Response(JSON.stringify({ RetCode: -4001 }), { status: 200 }));
    await expect(ensureKloudMembership(member(), { fetchImpl: refused, now: 0 })).resolves.toBeNull();
    vi.stubEnv('SIMEET_KLOUD_SUBSYSTEM_ID', '');
    const never = vi.fn();
    await expect(ensureKloudMembership(member(), { fetchImpl: never, now: 0 })).resolves.toBeNull();
    expect(never).not.toHaveBeenCalled();
  });
});
