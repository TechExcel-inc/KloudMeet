import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { resolveMemberAccountId } from '@/lib/peerTimeCompany';
import { normalizeEmails } from '@/lib/meetingInvites';

/**
 * People in the caller's company, for inviting to a Private meeting (pre-join and the
 * schedule dialog). GET ?q=<name or email> → up to 8 matches; ?check=a@x.com,b@y.com →
 * which of those addresses belong to the company (the others "can't join a private meeting").
 * { companyName: null } when the caller has no company account.
 */
export async function GET(request: NextRequest) {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;

    const accountId = await resolveMemberAccountId(member.id);
    if (!accountId) return NextResponse.json({ companyName: null, people: [], companyEmails: [] });
    const account = await prisma.kloudMeetAccount.findUnique({
      where: { id: accountId },
      select: { accountName: true },
    });

    const [memberships, admins] = await Promise.all([
      prisma.accountMembership.findMany({
        where: { accountId, status: 'ACTIVE', deletedAt: null },
        select: { teamMemberId: true },
      }),
      prisma.accountOwnerAndAdmin.findMany({
        where: { accountId, status: 'ACTIVE' },
        select: { teamMemberId: true },
      }),
    ]);
    const ids = [...new Set([...memberships, ...admins].map((r) => r.teamMemberId))];

    const q = (request.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 80);
    const check = normalizeEmails((request.nextUrl.searchParams.get('check') ?? '').split(','));

    const people = ids.length
      ? await prisma.teamMember.findMany({
          where: { id: { in: ids }, status: 'ACTIVE', deletedAt: null },
          select: { id: true, email: true, fullName: true, username: true, avatarUrl: true },
        })
      : [];

    const matches = q
      ? people
          .filter((p) => p.id !== member.id && p.email)
          .filter((p) =>
            [p.fullName, p.username, p.email].some((v) => (v ?? '').toLowerCase().includes(q)),
          )
          .slice(0, 8)
          .map((p) => ({ id: p.id, name: p.fullName || p.username, email: p.email, avatarUrl: p.avatarUrl }))
      : [];
    const companyEmailSet = new Set(people.map((p) => (p.email ?? '').toLowerCase()).filter(Boolean));

    return NextResponse.json({
      companyName: account?.accountName ?? null,
      people: matches,
      companyEmails: check.filter((email) => companyEmailSet.has(email)),
    });
  } catch (error) {
    console.error('[account company-people]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
