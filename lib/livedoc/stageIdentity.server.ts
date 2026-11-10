import { fetchKloudUserId } from '@/lib/kloudAuth';
import { ensureKloudMembership, kloudSubsystemConfig, type SubsystemMember } from '@/lib/kloudSubsystem.server';

export type StageIdentity = {
  /** The Kloud login for the stage, or null to use the anonymous instant account. */
  token: string | null;
  /** Whether the stage offers From Space (the Kloud company's spaces) with this login. */
  kloudLogin: boolean;
};

/**
 * Which Kloud account a person uses on the LiveDoc stage.
 *
 * With the SiMeet SubSystem on, a signed-in member uses their own subsystem login, so the meeting's
 * documents land in the subsystem; From Space (browsing the subsystem's content) is only for its
 * owners and admins. If Kloud can't be reached, they fall back to the anonymous account rather
 * than borrowing a browser login from another Kloud company.
 *
 * Without it (or for someone not signed in), it is the Kloud login in this browser, like Kloud's
 * own meeting page (the kloud_sso_token cookie kloud.cn sets). A SiMeet account linked to a
 * different Kloud user doesn't borrow someone else's login (shared computer).
 */
export async function resolveStageIdentity(options: {
  member: SubsystemMember | null;
  ssoToken: string | null;
  ensureMembership?: typeof ensureKloudMembership;
}): Promise<StageIdentity> {
  const { member, ssoToken } = options;

  if (member && kloudSubsystemConfig()) {
    const membership = await (options.ensureMembership ?? ensureKloudMembership)(member).catch(() => null);
    if (membership) return { token: membership.token, kloudLogin: membership.isAdmin };
    return { token: null, kloudLogin: false };
  }

  if (!ssoToken) return { token: null, kloudLogin: false };
  const kloudUserId = await fetchKloudUserId(ssoToken);
  if (!kloudUserId) return { token: null, kloudLogin: false };
  if (member?.kloudUserId && member.kloudUserId !== kloudUserId) return { token: null, kloudLogin: false };
  return { token: ssoToken, kloudLogin: true };
}
