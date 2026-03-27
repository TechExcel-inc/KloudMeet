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

// GET /api/account/members?accountId=1 — List members of an account
export async function GET(request: NextRequest) {
  try {
    const member = await getSessionMember(request);
    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = parseInt(request.nextUrl.searchParams.get('accountId') || '');
    if (!accountId) {
      return NextResponse.json({ error: 'Account ID required' }, { status: 400 });
    }

    // Verify caller is a member of this account
    const callerMembership = await prisma.accountMembership.findFirst({
      where: { accountId, teamMemberId: member.id, status: 'ACTIVE' },
    });
    if (!callerMembership) {
      return NextResponse.json({ error: 'Not a member of this account' }, { status: 403 });
    }

    // Get all members
    const memberships = await prisma.accountMembership.findMany({
      where: { accountId, status: 'ACTIVE' },
      include: { teamMember: true },
    });

    // Get owners
    const owners = await prisma.accountOwnerAndAdmin.findMany({
      where: { accountId, status: 'ACTIVE' },
    });
    const ownerMap = new Map(owners.map((o) => [o.teamMemberId, o.role]));

    const members = memberships.map((m) => ({
      id: m.teamMember.id,
      email: m.teamMember.email,
      username: m.teamMember.username,
      fullName: m.teamMember.fullName,
      avatarUrl: m.teamMember.avatarUrl,
      role: ownerMap.get(m.teamMember.id) || 'MEMBER',
      joinedAt: m.joinedAt,
      joinedVia: m.joinedVia,
    }));

    return NextResponse.json({ members });
  } catch (error) {
    console.error('[account members]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
