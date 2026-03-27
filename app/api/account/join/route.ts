import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

async function getSessionMember(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const session = await prisma.session.findUnique({
    where: { token },
    include: { teamMember: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (session.teamMember.status !== 'ACTIVE') return null;
  return session.teamMember;
}

// POST /api/account/join — Join by code or email domain
export async function POST(request: NextRequest) {
  try {
    const member = await getSessionMember(request);
    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { joinCode, accountId } = body;

    // Join by code
    if (joinCode) {
      const account = await prisma.kloudMeetAccount.findFirst({
        where: { joinTeamCode: joinCode.trim(), status: 1 },
      });
      if (!account) {
        return NextResponse.json({ error: 'Invalid join code' }, { status: 400 });
      }

      // Check if already a member
      const existing = await prisma.accountMembership.findFirst({
        where: { accountId: account.id, teamMemberId: member.id },
      });
      if (existing) {
        return NextResponse.json({
          id: account.id,
          accountCode: account.accountCode,
          accountName: account.accountName,
          message: 'Already a member',
        });
      }

      await prisma.accountMembership.create({
        data: {
          accountId: account.id,
          teamMemberId: member.id,
          status: 'ACTIVE',
          joinedVia: 'JOIN_CODE',
          joinedAt: new Date(),
          createdBy: member.username,
        },
      });

      return NextResponse.json({
        id: account.id,
        accountCode: account.accountCode,
        accountName: account.accountName,
        message: 'Joined successfully',
      });
    }

    // Join by accountId (email domain auto-match)
    if (accountId) {
      const account = await prisma.kloudMeetAccount.findFirst({
        where: { id: accountId, status: 1 },
      });
      if (!account) {
        return NextResponse.json({ error: 'Account not found' }, { status: 400 });
      }

      // Verify email domain match
      if (!member.email || !member.email.includes('@')) {
        return NextResponse.json({ error: 'Email required for domain-based join' }, { status: 400 });
      }
      const domain = member.email.split('@')[1].toLowerCase();
      const allowedDomains = (account.emailDomains || '').split(',').map((d) => d.trim().toLowerCase());

      if (!account.enableAutoJoinViaEmail || !allowedDomains.includes(domain)) {
        return NextResponse.json({ error: 'Your email domain does not match this account' }, { status: 400 });
      }

      // Check if already a member
      const existing = await prisma.accountMembership.findFirst({
        where: { accountId: account.id, teamMemberId: member.id },
      });
      if (existing) {
        return NextResponse.json({
          id: account.id,
          accountCode: account.accountCode,
          accountName: account.accountName,
          message: 'Already a member',
        });
      }

      await prisma.accountMembership.create({
        data: {
          accountId: account.id,
          teamMemberId: member.id,
          status: 'ACTIVE',
          joinedVia: 'EMAIL_DOMAIN',
          joinedAt: new Date(),
          createdBy: member.username,
        },
      });

      return NextResponse.json({
        id: account.id,
        accountCode: account.accountCode,
        accountName: account.accountName,
        message: 'Joined successfully',
      });
    }

    return NextResponse.json({ error: 'Join code or account ID required' }, { status: 400 });
  } catch (error) {
    console.error('[account join]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET /api/account/join — Find joinable accounts for current user
export async function GET(request: NextRequest) {
  try {
    const member = await getSessionMember(request);
    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get existing memberships
    const memberships = await prisma.accountMembership.findMany({
      where: { teamMemberId: member.id, status: 'ACTIVE' },
      include: { account: true },
    });

    const existingAccounts = memberships.map((m) => ({
      id: m.account.id,
      accountCode: m.account.accountCode,
      accountName: m.account.accountName,
      organizationType: m.account.organizationType,
      isExisting: true,
    }));

    // Find suggested accounts by email domain
    let suggestedAccounts: Array<{
      id: number;
      accountCode: string;
      accountName: string;
      organizationType: number | null;
      isExisting: boolean;
    }> = [];

    if (member.email && member.email.includes('@')) {
      const domain = member.email.split('@')[1].toLowerCase();
      const allAccounts = await prisma.kloudMeetAccount.findMany({
        where: { enableAutoJoinViaEmail: true, status: 1 },
      });

      const existingIds = new Set(memberships.map((m) => m.accountId));
      suggestedAccounts = allAccounts
        .filter((a) => {
          if (existingIds.has(a.id)) return false;
          const domains = (a.emailDomains || '').split(',').map((d) => d.trim().toLowerCase());
          return domains.includes(domain);
        })
        .map((a) => ({
          id: a.id,
          accountCode: a.accountCode,
          accountName: a.accountName,
          organizationType: a.organizationType,
          isExisting: false,
        }));
    }

    return NextResponse.json({
      existingAccounts,
      suggestedAccounts,
    });
  } catch (error) {
    console.error('[account join GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
