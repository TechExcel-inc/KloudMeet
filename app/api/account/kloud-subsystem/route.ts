import { NextRequest } from 'next/server';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { ensureKloudMembership, kloudSubsystemConfig } from '@/lib/kloudSubsystem.server';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

/**
 * GET /api/account/kloud-subsystem — Account Settings → Kloud Integration status: whether SiMeet runs
 * as a Kloud subsystem, and this person's membership in it (joined now if they weren't yet).
 */
export async function GET(request: NextRequest) {
  return runWithLocale(request, async () => {
  const member = await getSessionTeamMember(request);
  if (!member) return apiJson({ error: 'Unauthorized' }, { status: 401 });

  const config = kloudSubsystemConfig();
  if (!config) return apiJson({ enabled: false });

  const membership = await ensureKloudMembership(member).catch(() => null);
  return apiJson({
    enabled: true,
    subsystemId: config.id,
    joined: Boolean(membership),
    isAdmin: membership?.isAdmin ?? false,
    kloudUserId: membership?.kloudUserId ?? member.kloudUserId ?? null,
  });

  });
}
