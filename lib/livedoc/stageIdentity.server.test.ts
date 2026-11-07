import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveStageIdentity } from './stageIdentity.server';

const { fetchKloudUserId, findMeeting, isCompanyMember } = vi.hoisted(() => ({
  fetchKloudUserId: vi.fn(),
  findMeeting: vi.fn(),
  isCompanyMember: vi.fn(),
}));

vi.mock('@/lib/kloudAuth', () => ({ fetchKloudUserId: (t: string) => fetchKloudUserId(t) }));
vi.mock('@/lib/db', () => ({ prisma: { meeting: { findUnique: (a: unknown) => findMeeting(a) } } }));
vi.mock('@/lib/meetingAccess.server', () => ({
  isCompanyMember: (a: number, m: number) => isCompanyMember(a, m),
}));

const linked = { id: 7, kloudUserId: '501' };

beforeEach(() => {
  vi.clearAllMocks();
  fetchKloudUserId.mockResolvedValue('501');
  findMeeting.mockResolvedValue({ accountId: 3, account: { kloudCompanyId: '9001' } });
  isCompanyMember.mockResolvedValue(true);
});

describe('resolveStageIdentity', () => {
  it('gives a teammate of the host the team spaces with their own login', async () => {
    await expect(resolveStageIdentity({ member: linked, ssoToken: 'tok', roomName: 'r1' })).resolves.toEqual({
      token: 'tok',
      spaceScope: 'team',
      kloudCompanyId: '9001',
    });
    expect(isCompanyMember).toHaveBeenCalledWith(3, 7);
  });

  it('limits someone from another company to public documents of their own space', async () => {
    isCompanyMember.mockResolvedValue(false);
    await expect(resolveStageIdentity({ member: linked, ssoToken: 'tok', roomName: 'r1' })).resolves.toEqual({
      token: 'tok',
      spaceScope: 'own-public',
      kloudCompanyId: null,
    });
  });

  it('treats a host team without a Kloud company as another company', async () => {
    findMeeting.mockResolvedValue({ accountId: 3, account: { kloudCompanyId: null } });
    const r = await resolveStageIdentity({ member: linked, ssoToken: 'tok', roomName: 'r1' });
    expect(r.spaceScope).toBe('own-public');
  });

  it('falls back to the anonymous account without a session, a link or a kloud.cn login', async () => {
    const none = { token: null, spaceScope: 'none', kloudCompanyId: null };
    await expect(resolveStageIdentity({ member: null, ssoToken: 'tok', roomName: 'r1' })).resolves.toEqual(none);
    await expect(
      resolveStageIdentity({ member: { id: 7, kloudUserId: null }, ssoToken: 'tok', roomName: 'r1' }),
    ).resolves.toEqual(none);
    await expect(resolveStageIdentity({ member: linked, ssoToken: null, roomName: 'r1' })).resolves.toEqual(none);
  });

  it("refuses a kloud.cn login that belongs to a different Kloud user", async () => {
    fetchKloudUserId.mockResolvedValue('999');
    const r = await resolveStageIdentity({ member: linked, ssoToken: 'tok', roomName: 'r1' });
    expect(r).toEqual({ token: null, spaceScope: 'none', kloudCompanyId: null });
  });
});
