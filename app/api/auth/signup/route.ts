import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { isValidPassword, isValidUsername, normalizeEmail } from '@/lib/authPolicy';
import { checkCode, codeErrorMessage } from '@/lib/verificationCodes';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { phone, password, verificationCode, firstName, lastName } = body ?? {};
    const username = typeof body?.username === 'string' ? body.username.trim() : '';

    if (phone && !body?.email) {
      return NextResponse.json(
        { error: 'Phone sign-up is not available yet. Please use your email address.' },
        { status: 400 },
      );
    }
    const email = normalizeEmail(body?.email);
    if (!email) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
    }
    if (!isValidUsername(username)) {
      return NextResponse.json(
        { error: 'Login name: 2-20 letters and numbers, not all digits' },
        { status: 400 },
      );
    }
    if (!isValidPassword(password)) {
      return NextResponse.json(
        { error: 'Password: 8-64 characters with at least one letter and one number' },
        { status: 400 },
      );
    }

    // Check uniqueness before using up the code, so a taken name doesn't cost a new email.
    const existing = await prisma.teamMember.findFirst({ where: { email }, select: { id: true } });
    if (existing) {
      return NextResponse.json(
        { error: 'This email is already registered. Sign in or reset your password.', code: 'EMAIL_TAKEN' },
        { status: 400 },
      );
    }
    const existingUsername = await prisma.teamMember.findFirst({ where: { username }, select: { id: true } });
    if (existingUsername) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 400 });
    }

    const verified = await checkCode(email, 'signup', verificationCode, { consume: true });
    if (!verified.ok) {
      return NextResponse.json({ error: codeErrorMessage(verified), code: 'BAD_CODE' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Compute full name
    const fName = typeof firstName === 'string' ? firstName.trim() : '';
    const lName = typeof lastName === 'string' ? lastName.trim() : '';
    const fullName = (fName + ' ' + lName).trim() || username;

    const now = new Date();
    let member;
    try {
      member = await prisma.teamMember.create({
        data: {
          email,
          username,
          passwordHash,
          fullName,
          firstName: fName || null,
          lastName: lName || null,
          emailVerified: true,
          emailVerifiedAt: now,
          status: 'ACTIVE',
          createdBy: 'signup',
        },
      });
    } catch (e) {
      // Lost a race with another sign-up for the same email or username.
      if ((e as { code?: string })?.code === 'P2002') {
        return NextResponse.json({ error: 'This email or username was just taken. Please try another.' }, { status: 400 });
      }
      throw e;
    }

    // Create session
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.session.create({
      data: {
        teamMemberId: member.id,
        token,
        expiresAt,
        ipAddress: request.headers.get('x-forwarded-for') || null,
        userAgent: request.headers.get('user-agent') || null,
      },
    });

    return NextResponse.json({
      token,
      user: {
        id: member.id,
        email: member.email,
        username: member.username,
        fullName: member.fullName,
        avatarUrl: member.avatarUrl,
      },
    });
  } catch (error) {
    console.error('[signup]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
