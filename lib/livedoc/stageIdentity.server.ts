import { prisma } from '@/lib/db';
import { fetchKloudUserId } from '@/lib/kloudAuth';
import { isCompanyMember } from '@/lib/meetingAccess.server';
import type { LiveDocSpaceScope } from '@/lib/livedoc/client';

export type StageIdentity = {
  /** The person's own Kloud login, or null to use the anonymous instant account. */
  token: string | null;
  spaceScope: LiveDocSpaceScope;
  /** The host team's Kloud company, when spaceScope is "team". */
  kloudCompanyId: string | null;
};

const NONE: StageIdentity = { token: null, spaceScope: 'none', kloudCompanyId: null };

/**
 * Which Kloud account a person uses on the LiveDoc stage, and what From Space offers them:
 * - signed in with a linked Kloud account and a kloud.cn login (the .kloud.cn SSO cookie) for that
 *   same Kloud user → their own account; "team" when they belong to the meeting's company account
 *   and it mirrors a Kloud company, otherwise "own-public" (only public documents);
 * - anyone else → the anonymous instant account and no From Space.
 */
export async function resolveStageIdentity(options: {
  member: { id: number; kloudUserId: string | null } | null;
  ssoToken: string | null;
  roomName: string;
}): Promise<StageIdentity> {
  const { member, ssoToken, roomName } = options;
  if (!member?.kloudUserId || !ssoToken) return NONE;

  const kloudUserId = await fetchKloudUserId(ssoToken);
  // A kloud.cn login for someone else (shared computer) must not stand in for this person
  if (kloudUserId !== member.kloudUserId) return NONE;

  const meeting = roomName
    ? await prisma.meeting.findUnique({
        where: { roomName },
        select: { accountId: true, account: { select: { kloudCompanyId: true } } },
      })
    : null;
  const companyId = meeting?.account?.kloudCompanyId ?? null;
  if (companyId && (await isCompanyMember(meeting?.accountId, member.id))) {
    return { token: ssoToken, spaceScope: 'team', kloudCompanyId: companyId };
  }
  return { token: ssoToken, spaceScope: 'own-public', kloudCompanyId: null };
}
