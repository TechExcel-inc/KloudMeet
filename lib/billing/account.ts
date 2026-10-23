/**
 * Who pays: the KloudMeetAccount (design doc §1.2).
 * Only account Owner / Admin (the same AccountOwnerAndAdmin check behind
 * `isAccountAdmin`) may purchase or manage billing. A member with no account
 * gets a personal account on first checkout, with themselves as OWNER.
 */
import crypto from 'crypto';
import type { TeamMember } from '@prisma/client';
import { prisma } from '@/lib/db';

export type BillingAccountResult =
  | { ok: true; accountId: number; created: boolean }
  | { ok: false; status: number; error: string };

/** Same rule as `/api/auth/profile` → `isAccountAdmin`, scoped to one account. */
export async function isAccountAdminOf(teamMemberId: number, accountId: number): Promise<boolean> {
  const row = await prisma.accountOwnerAndAdmin.findFirst({
    where: { teamMemberId, accountId, status: 'ACTIVE' },
    select: { id: true },
  });
  return Boolean(row);
}

/** Account the member manages billing for, without creating anything. */
export async function findManagedAccountId(teamMemberId: number): Promise<number | null> {
  const row = await prisma.accountOwnerAndAdmin.findFirst({
    where: { teamMemberId, status: 'ACTIVE' },
    select: { accountId: true },
    orderBy: { id: 'asc' },
  });
  return row?.accountId ?? null;
}

/**
 * Account to bill for a purchase by `member`:
 * - admin of an account → that account;
 * - plain member of an account → 403 (ask an admin);
 * - no account → a new personal account (member becomes OWNER).
 */
export async function resolveBillingAccountForPurchase(
  member: Pick<TeamMember, 'id' | 'username' | 'fullName' | 'email'>,
): Promise<BillingAccountResult> {
  const managed = await findManagedAccountId(member.id);
  if (managed) return { ok: true, accountId: managed, created: false };

  const membership = await prisma.accountMembership.findFirst({
    where: { teamMemberId: member.id, status: 'ACTIVE' },
    select: { accountId: true },
  });
  if (membership) {
    return { ok: false, status: 403, error: 'Only an account owner or admin can manage billing' };
  }

  const accountId = await createPersonalAccount(member);
  return { ok: true, accountId, created: true };
}

export async function createPersonalAccount(
  member: Pick<TeamMember, 'id' | 'username' | 'fullName' | 'email'>,
): Promise<number> {
  const suffix = crypto.randomBytes(3).toString('hex');
  const accountId = await prisma.$transaction(async (tx) => {
    const account = await tx.kloudMeetAccount.create({
      data: {
        accountCode: `personal-${member.id}-${suffix}`,
        accountName: member.fullName?.trim() || member.username,
        teamSize: '1',
        contactEmail: member.email ?? null,
        description: 'Personal billing account',
        status: 1,
        createdBy: 'billing',
      },
    });
    await tx.accountOwnerAndAdmin.create({
      data: {
        accountId: account.id,
        teamMemberId: member.id,
        role: 'OWNER',
        status: 'ACTIVE',
        createdBy: 'billing',
      },
    });
    await tx.accountMembership.create({
      data: {
        accountId: account.id,
        teamMemberId: member.id,
        status: 'ACTIVE',
        joinedVia: 'BILLING',
        createdBy: 'billing',
      },
    });
    // Usage metered while the member had no account now belongs to the new one.
    await tx.usageEvent.updateMany({
      where: { accountId: null, teamMemberId: member.id },
      data: { accountId: account.id },
    });
    return account.id;
  });
  return accountId;
}

/** Owner automatically holds the first Team seat. */
export async function ensureOwnerSeat(accountId: number): Promise<void> {
  const owner = await prisma.accountOwnerAndAdmin.findFirst({
    where: { accountId, role: 'OWNER', status: 'ACTIVE' },
    select: { teamMemberId: true },
    orderBy: { id: 'asc' },
  });
  if (!owner) return;
  await prisma.billingSeat.createMany({
    data: [{ accountId, teamMemberId: owner.teamMemberId }],
    skipDuplicates: true,
  });
}
