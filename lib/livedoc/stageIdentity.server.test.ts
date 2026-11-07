import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveStageIdentity } from './stageIdentity.server';

const { fetchKloudUserId } = vi.hoisted(() => ({ fetchKloudUserId: vi.fn() }));
vi.mock('@/lib/kloudAuth', () => ({ fetchKloudUserId: (t: string) => fetchKloudUserId(t) }));

beforeEach(() => {
  vi.clearAllMocks();
  fetchKloudUserId.mockResolvedValue('501');
});

describe('resolveStageIdentity', () => {
  it("uses the browser's Kloud login, signed in to Kloud Meet or not", async () => {
    await expect(resolveStageIdentity({ member: null, ssoToken: 'tok' })).resolves.toEqual({ token: 'tok' });
    await expect(resolveStageIdentity({ member: { kloudUserId: null }, ssoToken: 'tok' })).resolves.toEqual({
      token: 'tok',
    });
    await expect(resolveStageIdentity({ member: { kloudUserId: '501' }, ssoToken: 'tok' })).resolves.toEqual({
      token: 'tok',
    });
  });

  it('falls back to the anonymous account without a valid Kloud login', async () => {
    await expect(resolveStageIdentity({ member: null, ssoToken: null })).resolves.toEqual({ token: null });
    fetchKloudUserId.mockResolvedValue(null);
    await expect(resolveStageIdentity({ member: null, ssoToken: 'expired' })).resolves.toEqual({ token: null });
  });

  it("doesn't borrow the Kloud login of someone other than the linked Kloud user", async () => {
    fetchKloudUserId.mockResolvedValue('999');
    await expect(resolveStageIdentity({ member: { kloudUserId: '501' }, ssoToken: 'tok' })).resolves.toEqual({
      token: null,
    });
  });
});
