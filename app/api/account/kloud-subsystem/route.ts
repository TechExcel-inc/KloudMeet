import { NextRequest, NextResponse } from 'next/server';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { ensureKloudMembership, kloudSubsystemConfig } from '@/lib/kloudSubsystem.server';

/**
 * GET /api/account/kloud-subsystem — Account Settings → Kloud Integration status: whether SiMeet runs
 * as a Kloud subsystem, and this person's membership in it (joined now if they weren't yet).
 */
export async function GET(request: NextRequest) {
  const member = await getSessionTeamMember(request);
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const config = kloudSubsystemConfig();
  if (!config) return NextResponse.json({ enabled: false });

  const membership = await ensureKloudMembership(member).catch(() => null);
  return NextResponse.json({
    enabled: true,
    subsystemId: config.id,
    joined: Boolean(membership),
    isAdmin: membership?.isAdmin ?? false,
    kloudUserId: membership?.kloudUserId ?? member.kloudUserId ?? null,
  });
}
