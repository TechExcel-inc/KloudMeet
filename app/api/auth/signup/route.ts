import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, phone, username, password, verificationCode, firstName, lastName } = body;

    // Determine target (email or phone)
    const target = (email || phone || '').trim();
    if (!target) {
      return NextResponse.json({ error: 'Email or phone required' }, { status: 400 });
    }
    if (!username || !username.trim()) {
      return NextResponse.json({ error: 'Username required' }, { status: 400 });
    }
    if (!password) {
      return NextResponse.json({ error: 'Password required' }, { status: 400 });
    }

    const isPhone = target.startsWith('+');

    // Verify the verification code
    const codeType = isPhone ? 'SIGNUP_SMS' : 'SIGNUP_EMAIL';
    const vc = await prisma.verificationCode.findFirst({
      where: {
        target,
        code: (verificationCode || '').trim(),
        type: codeType,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });
    if (!vc) {
      return NextResponse.json({ error: 'Invalid or expired verification code' }, { status: 400 });
    }

    // Check uniqueness
    if (isPhone) {
      const existing = await prisma.teamMember.findFirst({ where: { phone: target } });
      if (existing) {
        return NextResponse.json({ error: 'Phone already registered' }, { status: 400 });
      }
    } else {
      const existing = await prisma.teamMember.findFirst({ where: { email: target } });
      if (existing) {
        return NextResponse.json({ error: 'Email already registered' }, { status: 400 });
      }
    }

    const existingUsername = await prisma.teamMember.findFirst({ where: { username: username.trim() } });
    if (existingUsername) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 400 });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Compute full name
    const fName = firstName?.trim() || '';
    const lName = lastName?.trim() || '';
    const fullName = (fName + ' ' + lName).trim() || username.trim();

    // Create TeamMember
    const now = new Date();
    const member = await prisma.teamMember.create({
      data: {
        email: isPhone ? null : (email?.trim() || null),
        username: username.trim(),
        phone: isPhone ? target : (phone?.trim() || null),
        passwordHash,
        fullName,
        firstName: fName || null,
        lastName: lName || null,
        emailVerified: !isPhone,
        emailVerifiedAt: !isPhone ? now : null,
        phoneVerified: isPhone,
        phoneVerifiedAt: isPhone ? now : null,
        status: 'ACTIVE',
        createdBy: 'signup',
      },
    });

    // Mark verification code as used
    await prisma.verificationCode.update({
      where: { id: vc.id },
      data: { used: true },
    });

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
