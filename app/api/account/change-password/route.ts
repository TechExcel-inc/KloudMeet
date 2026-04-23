import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

async function getAuthMember(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  const session = await prisma.session.findUnique({
    where: { token },
    include: { teamMember: true }
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.teamMember;
}

export async function POST(request: NextRequest) {
  try {
    const member = await getAuthMember(request);
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Current and new password are required' }, { status: 400 });
    }

    if (newPassword.length < 8 || newPassword.length > 30) {
      return NextResponse.json({ error: 'New password must be 8-30 characters' }, { status: 400 });
    }

    // Check if the password has both letters and numbers
    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return NextResponse.json({ error: 'Password must contain both letters and numbers' }, { status: 400 });
    }

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, member.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    // Hash and update new password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.teamMember.update({
      where: { id: member.id },
      data: {
        passwordHash,
        modifiedAt: new Date(),
        modifiedBy: 'change-password',
      },
    });

    return NextResponse.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('[change-password]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
