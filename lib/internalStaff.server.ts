import { prisma } from '@/lib/db';
import { internalStaffEmails, isInternalEmail } from '@/lib/internalStaff';

/** Whether this signed-in member is on the INTERNAL_STAFF_EMAILS list (false when nobody is listed). */
export async function isInternalMember(memberId: number | null | undefined): Promise<boolean> {
  if (!memberId || internalStaffEmails().size === 0) return false;
  const member = await prisma.teamMember.findUnique({ where: { id: memberId }, select: { email: true } });
  return isInternalEmail(member?.email);
}
