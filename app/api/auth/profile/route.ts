import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeEmail } from '@/lib/authPolicy';

// Helper: extract session token from Authorization header
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

// GET /api/auth/profile — Get current user profile
export async function GET(request: NextRequest) {
  try {
    const member = await getSessionMember(request);
    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = await prisma.accountOwnerAndAdmin.findFirst({
      where: { teamMemberId: member.id, status: 'ACTIVE' },
      select: { id: true },
    });

    return NextResponse.json({
      id: member.id,
      isAccountAdmin: Boolean(admin),
      email: member.email,
      username: member.username,
      phone: member.phone,
      fullName: member.fullName,
      firstName: member.firstName,
      lastName: member.lastName,
      avatarUrl: member.avatarUrl,
      emailVerified: member.emailVerified,
      phoneVerified: member.phoneVerified,
      status: member.status,
      createdAt: member.createdAt,
    });
  } catch (error) {
    console.error('[profile GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/auth/profile — Update profile
export async function PUT(request: NextRequest) {
  try {
    const member = await getSessionMember(request);
    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { firstName, lastName, email, phone } = body;

    const updateData: Record<string, unknown> = {
      modifiedAt: new Date(),
      modifiedBy: 'profile-update',
    };

    if (firstName !== undefined) updateData.firstName = firstName?.trim() || null;
    if (lastName !== undefined) updateData.lastName = lastName?.trim() || null;

    // Update fullName
    const fName = (firstName !== undefined ? firstName : member.firstName) || '';
    const lName = (lastName !== undefined ? lastName : member.lastName) || '';
    const fullName = (fName.trim() + ' ' + lName.trim()).trim();
    if (fullName) updateData.fullName = fullName;

    // The email only changes through /api/account/email (a code sent to the new address).
    if (email !== undefined && email !== null && email !== '' && normalizeEmail(email) !== (member.email ?? '').toLowerCase()) {
      return NextResponse.json(
        { error: 'Confirm the new email with a code first.', code: 'EMAIL_NEEDS_CODE' },
        { status: 400 },
      );
    }

    // If phone is being changed, check uniqueness
    if (phone !== undefined && phone !== member.phone) {
      const existing = await prisma.teamMember.findFirst({ where: { phone: phone.trim() } });
      if (existing && existing.id !== member.id) {
        return NextResponse.json({ error: 'Phone already registered' }, { status: 400 });
      }
      updateData.phone = phone.trim();
    }

    const updated = await prisma.teamMember.update({
      where: { id: member.id },
      data: updateData,
    });

    return NextResponse.json({
      id: updated.id,
      email: updated.email,
      username: updated.username,
      phone: updated.phone,
      fullName: updated.fullName,
      firstName: updated.firstName,
      lastName: updated.lastName,
      avatarUrl: updated.avatarUrl,
    });
  } catch (error) {
    console.error('[profile PUT]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
