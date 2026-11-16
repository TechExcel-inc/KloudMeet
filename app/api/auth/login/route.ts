import { prisma } from '@/lib/db';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { clientIp, rateLimited } from '@/lib/rateLimit';
import { joinKloudSubsystemInBackground } from '@/lib/kloudSubsystem.server';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export async function POST(request: NextRequest) {
  return runWithLocale(request, async () => {
  try {
    const body = await request.json();
    const { identifier, password, phone, code } = body;

    // Phone + SMS code login is not available (no SMS provider yet).
    if (phone || code) {
      return apiJson(
        { error: 'Phone sign-in is not available yet. Please use your email address.' },
        { status: 400 },
      );
    }

    // Email/username + password login
    if (!identifier || !password) {
      return apiJson({ error: 'Identifier and password required' }, { status: 400 });
    }

    const id = String(identifier).trim();
    const ip = clientIp(request);
    if (
      rateLimited(`login:ip:${ip}`, 30, 15 * 60 * 1000) ||
      rateLimited(`login:id:${id.toLowerCase()}`, 10, 15 * 60 * 1000)
    ) {
      return apiJson(
        { error: 'Too many sign-in attempts. Please wait a few minutes or reset your password.' },
        { status: 429 },
      );
    }

    // Find user by email or username
    const member = await prisma.teamMember.findFirst({
      where: {
        OR: [
          { email: id },
          { username: id },
        ],
      },
    });

    // Same answer for an unknown account and a wrong password.
    const badCredentials = 'Incorrect email/login name or password';
    if (!member) {
      return apiJson({ error: badCredentials }, { status: 401 });
    }

    // Verify password
    const valid = await bcrypt.compare(String(password), member.passwordHash);
    if (!valid) {
      if (member.googleId && member.createdBy === 'google') {
        return apiJson(
          { error: 'This account uses Google sign-in. Continue with Google, or reset your password to add one.', code: 'USE_GOOGLE' },
          { status: 401 },
        );
      }
      return apiJson({ error: badCredentials }, { status: 401 });
    }
    if (member.status !== 'ACTIVE') {
      return apiJson({ error: 'Account is inactive or suspended' }, { status: 401 });
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
    joinKloudSubsystemInBackground(member);

    return apiJson({
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
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
