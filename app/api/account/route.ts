import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// Helper: extract session member from Authorization header
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

// POST /api/account — Create a new KloudMeetAccount
export async function POST(request: NextRequest) {
  try {
    const member = await getSessionMember(request);
    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { accountCode, accountName, organizationType, teamSize, emailDomains, description } = body;

    if (!accountCode?.trim() || !accountName?.trim()) {
      return NextResponse.json({ error: 'Account code and name required' }, { status: 400 });
    }

    // Check uniqueness
    const existing = await prisma.kloudMeetAccount.findFirst({
      where: { accountCode: accountCode.trim() },
    });
    if (existing) {
      return NextResponse.json({ error: 'Account code already taken' }, { status: 400 });
    }

    // Generate a random join team code
    const joinTeamCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Create account
    const account = await prisma.kloudMeetAccount.create({
      data: {
        accountCode: accountCode.trim(),
        accountName: accountName.trim(),
        organizationType: organizationType || null,
        teamSize: teamSize || null,
        emailDomains: emailDomains?.trim() || null,
        enableAutoJoinViaEmail: !!emailDomains,
        joinTeamCode,
        description: description?.trim() || null,
        status: 1,
        createdBy: member.username,
      },
    });

    // Make creator the OWNER
    await prisma.accountOwnerAndAdmin.create({
      data: {
        accountId: account.id,
        teamMemberId: member.id,
        role: 'OWNER',
        assignedAt: new Date(),
        status: 'ACTIVE',
        createdBy: member.username,
      },
    });

    // Add creator as AccountMembership
    await prisma.accountMembership.create({
      data: {
        accountId: account.id,
        teamMemberId: member.id,
        status: 'ACTIVE',
        joinedVia: 'MANUAL',
        joinedAt: new Date(),
        createdBy: member.username,
      },
    });

    return NextResponse.json({
      id: account.id,
      accountCode: account.accountCode,
      accountName: account.accountName,
      joinTeamCode: account.joinTeamCode,
    });
  } catch (error) {
    console.error('[account create]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
