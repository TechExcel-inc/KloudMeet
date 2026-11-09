import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveStageIdentity } from './stageIdentity.server';
import type { SubsystemMember, SubsystemMembership } from '@/lib/kloudSubsystem.server';

const { fetchKloudUserId } = vi.hoisted(() => ({ fetchKloudUserId: vi.fn() }));
vi.mock('@/lib/kloudAuth', () => ({ fetchKloudUserId: (t: string) => fetchKloudUserId(t) }));
vi.mock('@/lib/db', () => ({ prisma: {} }));

const member = (kloudUserId: string | null): SubsystemMember => ({
  id: 7,
  email: 'a@example.com',
  emailVerified: true,
  username: 'a',
  fullName: 'A',
  phone: null,
  phoneVerified: false,
  kloudUserId,
});

const membership = (role: number): SubsystemMembership => ({
  subsystemId: 219000,
  kloudUserId: '501',
  token: 'sub-tok',
  role,
  isAdmin: role === 7 || role === 8,
  expiresAt: Date.now() + 86_400_000,
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchKloudUserId.mockResolvedValue('501');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveStageIdentity without the SiMeet SubSystem', () => {
  it("uses the browser's Kloud login, signed in to SiMeet or not", async () => {
    const ok = { token: 'tok', kloudLogin: true };
    await expect(resolveStageIdentity({ member: null, ssoToken: 'tok' })).resolves.toEqual(ok);
    await expect(resolveStageIdentity({ member: member(null), ssoToken: 'tok' })).resolves.toEqual(ok);
    await expect(resolveStageIdentity({ member: member('501'), ssoToken: 'tok' })).resolves.toEqual(ok);
  });

  it('falls back to the anonymous account without a valid Kloud login', async () => {
    const none = { token: null, kloudLogin: false };
    await expect(resolveStageIdentity({ member: null, ssoToken: null })).resolves.toEqual(none);
    fetchKloudUserId.mockResolvedValue(null);
    await expect(resolveStageIdentity({ member: null, ssoToken: 'expired' })).resolves.toEqual(none);
  });

  it("doesn't borrow the Kloud login of someone other than the linked Kloud user", async () => {
    fetchKloudUserId.mockResolvedValue('999');
    await expect(resolveStageIdentity({ member: member('501'), ssoToken: 'tok' })).resolves.toEqual({
      token: null,
      kloudLogin: false,
    });
  });
});

describe('resolveStageIdentity with the SiMeet SubSystem', () => {
  beforeEach(() => {
    vi.stubEnv('SIMEET_KLOUD_SUBSYSTEM_ID', '219000');
    vi.stubEnv('SIMEET_KLOUD_SUBSYSTEM_TOKEN', 'secret');
  });

  it("uses the member's subsystem login, never the browser's, and From Space only for admins", async () => {
    const asMember = vi.fn().mockResolvedValue(membership(2));
    await expect(
      resolveStageIdentity({ member: member(null), ssoToken: 'browser-tok', ensureMembership: asMember }),
    ).resolves.toEqual({ token: 'sub-tok', kloudLogin: false });

    const asAdmin = vi.fn().mockResolvedValue(membership(7));
    await expect(
      resolveStageIdentity({ member: member(null), ssoToken: null, ensureMembership: asAdmin }),
    ).resolves.toEqual({ token: 'sub-tok', kloudLogin: true });
    expect(fetchKloudUserId).not.toHaveBeenCalled();
  });

  it('falls back to the anonymous account when Kloud cannot be reached', async () => {
    const down = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(
      resolveStageIdentity({ member: member(null), ssoToken: 'browser-tok', ensureMembership: down }),
    ).resolves.toEqual({ token: null, kloudLogin: false });
  });

  it("keeps the browser's login for someone not signed in", async () => {
    await expect(resolveStageIdentity({ member: null, ssoToken: 'tok' })).resolves.toEqual({
      token: 'tok',
      kloudLogin: true,
    });
  });
});
