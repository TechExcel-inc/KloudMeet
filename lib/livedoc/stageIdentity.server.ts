import { fetchKloudUserId } from '@/lib/kloudAuth';

export type StageIdentity = {
  /** The browser's Kloud login, or null to use the anonymous instant account. */
  token: string | null;
};

/**
 * Which Kloud account a person uses on the LiveDoc stage. Like Kloud's own meeting page, it is the
 * Kloud login in this browser (the kloud_sso_token cookie kloud.cn sets), so From Space opens the
 * meeting company's spaces and Kloud decides what that person may see. A Kloud Meet account linked
 * to a different Kloud user doesn't borrow someone else's login (shared computer).
 */
export async function resolveStageIdentity(options: {
  member: { kloudUserId: string | null } | null;
  ssoToken: string | null;
}): Promise<StageIdentity> {
  const { member, ssoToken } = options;
  if (!ssoToken) return { token: null };
  const kloudUserId = await fetchKloudUserId(ssoToken);
  if (!kloudUserId) return { token: null };
  if (member?.kloudUserId && member.kloudUserId !== kloudUserId) return { token: null };
  return { token: ssoToken };
}
