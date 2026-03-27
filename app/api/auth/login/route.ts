import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { identifier, password, phone, code } = body;

    // Phone + SMS code login
    if (phone && code) {
      const vc = await prisma.verificationCode.findFirst({
        where: {
          target: phone.trim(),
          code: code.trim(),
          used: false,
          expiresAt: { gt: new Date() },
        },
      });
      if (!vc) {
        return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 });
      }

      const member = await prisma.teamMember.findFirst({ where: { phone: phone.trim() } });
      if (!member) {
        return NextResponse.json({ error: 'Account not found' }, { status: 401 });
      }
      if (member.status !== 'ACTIVE') {
        return NextResponse.json({ error: 'Account is inactive or suspended' }, { status: 401 });
      }

      // Mark code used
      await prisma.verificationCode.update({ where: { id: vc.id }, data: { used: true } });

      // Create session
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
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
    }

    // Email/username + password login
    if (!identifier || !password) {
      return NextResponse.json({ error: 'Identifier and password required' }, { status: 400 });
    }

    // Find user by email or username
    const member = await prisma.teamMember.findFirst({
      where: {
        OR: [
          { email: identifier.trim() },
          { username: identifier.trim() },
        ],
      },
    });

    if (!member) {
      return NextResponse.json({ error: 'Account not found' }, { status: 401 });
    }
    if (member.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Account is inactive or suspended' }, { status: 401 });
    }

    // Verify password
    const valid = await bcrypt.compare(password, member.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
    }

    // Create session
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
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
    console.error('[login]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
