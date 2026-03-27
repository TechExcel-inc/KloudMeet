import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, phone, code, password } = body;

    const target = (email || phone || '').trim();
    if (!target) {
      return NextResponse.json({ error: 'Email or phone required' }, { status: 400 });
    }
    if (!code) {
      return NextResponse.json({ error: 'Verification code required' }, { status: 400 });
    }
    if (!password) {
      return NextResponse.json({ error: 'New password required' }, { status: 400 });
    }

    const isPhone = target.startsWith('+');
    const codeType = isPhone ? 'RESET_SMS' : 'RESET_EMAIL';

    // Verify the reset code
    const vc = await prisma.verificationCode.findFirst({
      where: {
        target,
        code: code.trim(),
        type: codeType,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });
    if (!vc) {
      return NextResponse.json({ error: 'Invalid or expired verification code' }, { status: 400 });
    }

    // Find the user
    const member = isPhone
      ? await prisma.teamMember.findFirst({ where: { phone: target } })
      : await prisma.teamMember.findFirst({ where: { email: target } });

    if (!member) {
      return NextResponse.json({ error: 'Account not found' }, { status: 400 });
    }

    // Update password
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.teamMember.update({
      where: { id: member.id },
      data: {
        passwordHash,
        modifiedAt: new Date(),
        modifiedBy: 'reset-password',
      },
    });

    // Mark code as used
    await prisma.verificationCode.update({
      where: { id: vc.id },
      data: { used: true },
    });

    return NextResponse.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('[reset-password]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
