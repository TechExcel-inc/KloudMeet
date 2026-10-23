import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { isValidPassword, normalizeEmail } from '@/lib/authPolicy';
import { checkCode, codeErrorMessage } from '@/lib/verificationCodes';

/**
 * POST /api/auth/reset-password { email, code, password }
 * Sets a new password and signs the account out everywhere (all existing sessions end).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { phone, code, password } = body ?? {};

    if (phone && !body?.email) {
      return NextResponse.json(
        { error: 'Phone reset is not available yet. Please use your email address.' },
        { status: 400 },
      );
    }
    const email = normalizeEmail(body?.email);
    if (!email) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
    }
    if (!code) {
      return NextResponse.json({ error: 'Verification code required' }, { status: 400 });
    }
    if (!isValidPassword(password)) {
      return NextResponse.json(
        { error: 'Password: 8-64 characters with at least one letter and one number' },
        { status: 400 },
      );
    }

    const verified = await checkCode(email, 'reset', code, { consume: true });
    if (!verified.ok) {
      return NextResponse.json({ error: codeErrorMessage(verified), code: 'BAD_CODE' }, { status: 400 });
    }

    const member = await prisma.teamMember.findFirst({ where: { email }, select: { id: true } });
    if (!member) {
      // Codes are only issued for existing accounts; the account was removed since.
      return NextResponse.json({ error: codeErrorMessage({ attemptsLeft: 0 }) }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.$transaction([
      prisma.teamMember.update({
        where: { id: member.id },
        data: {
          passwordHash,
          // Receiving the code proves the mailbox belongs to this account.
          emailVerified: true,
          modifiedAt: new Date(),
          modifiedBy: 'reset-password',
        },
      }),
      prisma.session.deleteMany({ where: { teamMemberId: member.id } }),
    ]);

    return NextResponse.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('[reset-password]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
