import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { createPersonalAccount } from '@/lib/billing/account';
import { canMapKloudCompany, freshKloudCompanies, syncKloudMemberships } from '@/lib/kloudAuth';

/**
 * The Kloud Meet company ↔ Kloud company mapping (decision 3).
 * Only someone who owns the Kloud Meet company and is owner/admin of the Kloud company may set it;
 * the Kloud role comes from the company list read at the person's last Kloud sign-in (≤ 1 hour old).
 */

async function ownedAccount(teamMemberId: number) {
  const row = await prisma.accountOwnerAndAdmin.findFirst({
    where: { teamMemberId, role: 'OWNER', status: 'ACTIVE', account: { status: 1 } },
    orderBy: { id: 'asc' },
    select: { account: { select: { id: true, accountName: true, kloudCompanyId: true, kloudCompanyName: true } } },
  });
  return row?.account ?? null;
}

/** GET — the person's company, its mapping, and the Kloud companies they could map. */
export async function GET(request: NextRequest) {
  const member = await getSessionTeamMember(request);
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const account = await ownedAccount(member.id);
  const companies = member.kloudUserId ? freshKloudCompanies(member) : null;
  const ids = (companies ?? []).map((c) => c.id);
  const taken = ids.length
    ? await prisma.kloudMeetAccount.findMany({ where: { kloudCompanyId: { in: ids } }, select: { id: true, kloudCompanyId: true } })
    : [];
  const ownMembership = account
    ? null
    : await prisma.accountMembership.findFirst({
        where: { teamMemberId: member.id, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
  return NextResponse.json({
    kloudConnected: Boolean(member.kloudUserId),
    account,
    // A member of someone else's company can't link one from here.
    canLink: Boolean(account) || !ownMembership,
    // null = the list is too old: sign in with Kloud again (Reconnect) to refresh it.
    candidates:
      companies?.filter(canMapKloudCompany).map((c) => ({
        id: c.id,
        name: c.name,
        mappedElsewhere: taken.some((t) => t.kloudCompanyId === c.id && t.id !== account?.id),
      })) ?? null,
  });
}

/** POST { kloudCompanyId } — maps the person's company (creating one named after it if they own none). */
export async function POST(request: NextRequest) {
  try {
    const member = await getSessionTeamMember(request);
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!member.kloudUserId) {
      return NextResponse.json({ error: 'Connect your Kloud account first.', code: 'KLOUD_NOT_CONNECTED' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const rawId = body?.kloudCompanyId;
    const kloudCompanyId = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
    const companies = freshKloudCompanies(member);
    if (!companies) {
      return NextResponse.json(
        { error: 'Sign in with Kloud again to refresh your companies.', code: 'KLOUD_COMPANIES_STALE' },
        { status: 400 },
      );
    }
    const company = companies.find((c) => c.id === kloudCompanyId);
    if (!company || !canMapKloudCompany(company)) {
      return NextResponse.json(
        { error: 'Only an owner or admin of that Kloud company can link it.', code: 'NOT_KLOUD_ADMIN' },
        { status: 403 },
      );
    }

    let account = await ownedAccount(member.id);
    if (account?.kloudCompanyId && account.kloudCompanyId !== company.id) {
      return NextResponse.json(
        { error: 'Your company is already linked to another Kloud company. Unlink it first.', code: 'ALREADY_LINKED' },
        { status: 400 },
      );
    }
    if (!account) {
      // A member of someone else's company must not start a second one from here.
      const membership = await prisma.accountMembership.findFirst({
        where: { teamMemberId: member.id, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      if (membership) {
        return NextResponse.json(
          { error: 'Only the owner of your Kloud Meet company can link it.', code: 'NOT_OWNER' },
          { status: 403 },
        );
      }
      const accountId = await createPersonalAccount(member);
      await prisma.kloudMeetAccount.update({
        where: { id: accountId },
        data: { accountName: company.name, description: null },
      });
      account = await ownedAccount(member.id);
    }
    if (!account) throw new Error('company account missing after create');

    const now = new Date();
    try {
      await prisma.kloudMeetAccount.update({
        where: { id: account.id },
        data: {
          kloudCompanyId: company.id,
          kloudCompanyName: company.name,
          kloudLinkedAt: now,
          kloudLinkedBy: member.id,
          modifiedAt: now,
          modifiedBy: member.username,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return NextResponse.json(
          { error: 'That Kloud company is already linked to another Kloud Meet company.', code: 'KLOUD_COMPANY_TAKEN' },
          { status: 409 },
        );
      }
      throw error;
    }
    await syncKloudMemberships(member.id, companies, now);
    return NextResponse.json({ account: { ...account, kloudCompanyId: company.id, kloudCompanyName: company.name } });
  } catch (error) {
    console.error('[kloud-company POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE — unlinks; members who came from Kloud leave with the link, members added here stay. */
export async function DELETE(request: NextRequest) {
  try {
    const member = await getSessionTeamMember(request);
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const account = await ownedAccount(member.id);
    if (!account?.kloudCompanyId) {
      return NextResponse.json({ error: 'Your company is not linked to Kloud.', code: 'NOT_LINKED' }, { status: 400 });
    }
    const now = new Date();
    await prisma.$transaction([
      prisma.kloudMeetAccount.update({
        where: { id: account.id },
        data: {
          kloudCompanyId: null,
          kloudCompanyName: null,
          kloudLinkedAt: null,
          kloudLinkedBy: null,
          modifiedAt: now,
          modifiedBy: member.username,
        },
      }),
      prisma.accountMembership.updateMany({
        where: { accountId: account.id, joinedVia: 'KLOUD', status: 'ACTIVE' },
        data: { status: 'REMOVED', deletedAt: now, deletedBy: 'kloud-unlink', modifiedAt: now, modifiedBy: member.username },
      }),
    ]);
    return NextResponse.json({ account: { ...account, kloudCompanyId: null, kloudCompanyName: null } });
  } catch (error) {
    console.error('[kloud-company DELETE]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
