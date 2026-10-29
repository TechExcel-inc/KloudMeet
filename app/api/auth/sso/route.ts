import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { usernameBaseFromEmail } from '@/lib/googleOAuth';
import { fetchKloudUser, recordKloudCompanies } from '@/lib/kloudAuth';

/**
 * GET /api/auth/sso
 *
 * Reads the `kloud_sso_token` cookie (set by kloud.cn on the parent domain), reads the Kloud user
 * behind it, and signs in the Kloud Meet account bound to that Kloud user (or creates one).
 * Same rules as "Continue with Kloud": accounts are matched by Kloud user ID, and an existing
 * account with the same email is not taken over.
 *
 * Returns the same shape as /api/auth/login: { token, user }.
 */
export async function GET(request: NextRequest) {
  try {
    const ssoToken = request.cookies.get('kloud_sso_token')?.value;
    if (!ssoToken) {
      return NextResponse.json({ error: 'No SSO token' }, { status: 401 });
    }

    // ── 1. Validate the PeerTime token and fetch the Kloud user ──
    const kloud = await fetchKloudUser(decodeURIComponent(ssoToken));
    if (!kloud) {
      return NextResponse.json({ error: 'SSO token invalid or expired' }, { status: 401 });
    }

    // ── 2. Find-or-create the bound TeamMember in KloudMeet ──
    const now = new Date();
    let member = await prisma.teamMember.findUnique({ where: { kloudUserId: kloud.id } });

    if (!member) {
      if (kloud.email && (await prisma.teamMember.findUnique({ where: { email: kloud.email }, select: { id: true } }))) {
        return NextResponse.json(
          { error: 'Sign in to your existing Kloud Meet account to connect Kloud.', code: 'CONNECT_REQUIRED' },
          { status: 409 },
        );
      }
      const baseUsername = kloud.email ? usernameBaseFromEmail(kloud.email) : `kloud${kloud.id}`;
      let username = baseUsername;
      let counter = 1;
      while (await prisma.teamMember.findUnique({ where: { username }, select: { id: true } })) {
        username = `${baseUsername}${counter}`;
        counter++;
      }
      member = await prisma.teamMember.create({
        data: {
          kloudUserId: kloud.id,
          kloudLinkedAt: now,
          email: kloud.email,
          username,
          fullName: kloud.name || username,
          phone: kloud.phone,
          avatarUrl: kloud.avatarUrl,
          emailVerified: false,
          passwordHash: crypto.randomBytes(32).toString('hex'), // random — login via SSO only
          status: 'ACTIVE',
          createdBy: 'kloud',
        },
      });
    }

    if (member.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'Account is inactive or suspended' },
        { status: 401 },
      );
    }
    await recordKloudCompanies(member.id, kloud.companies, now);

    // ── 3. Create a KloudMeet session ──
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
    console.error('[SSO]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
