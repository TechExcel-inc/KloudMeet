import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAuthError, requireInternalStaff } from '@/lib/apiAuth';
import { ensureKloudMembership, kloudSubsystemConfig } from '@/lib/kloudSubsystem.server';

/**
 * POST /api/account/kloud-subsystem/backfill — SiMeet staff only. Makes every active member a SiMeet
 * SubSystem member now, instead of at their next sign-in. One at a time, so Kloud isn't flooded.
 */
export async function POST(request: NextRequest) {
  const staff = await requireInternalStaff(request);
  if (isAuthError(staff)) return staff;
  if (!kloudSubsystemConfig()) {
    return NextResponse.json({ error: 'The SiMeet SubSystem is not configured.' }, { status: 400 });
  }

  const members = await prisma.teamMember.findMany({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } });
  let joined = 0;
  const failed: number[] = [];
  for (const member of members) {
    const membership = await ensureKloudMembership(member).catch(() => null);
    if (membership) joined += 1;
    else failed.push(member.id);
  }
  return NextResponse.json({ members: members.length, joined, failed });
}
