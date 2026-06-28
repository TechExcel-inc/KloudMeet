import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const PEER_TIME_API_BASE =
  process.env.PEER_TIME_API_BASE_URL ?? 'https://api.peertime.cn';

/**
 * GET /api/auth/sso
 *
 * Reads the `kloud_sso_token` cookie (set by kloud.cn on the parent domain),
 * validates it against the PeerTime API, and creates/finds a matching
 * KloudMeet user + session.
 *
 * Returns the same shape as /api/auth/login: { token, user }.
 */
export async function GET(request: NextRequest) {
  try {
    const ssoToken = request.cookies.get('kloud_sso_token')?.value;
    if (!ssoToken) {
      return NextResponse.json({ error: 'No SSO token' }, { status: 401 });
    }

    // ── 1. Validate the PeerTime token and fetch user profile ──
    const decodedToken = decodeURIComponent(ssoToken);
    const profileRes = await fetch(
      `${PEER_TIME_API_BASE}/peertime/V1/User/UserProfile`,
      { headers: { UserToken: decodedToken } },
    );

    if (!profileRes.ok) {
      return NextResponse.json(
        { error: 'SSO token invalid or expired' },
        { status: 401 },
      );
    }

    const profileData = await profileRes.json();
    // PeerTime returns { RetCode: 0, RetData: { ... } } on success
    if (profileData.RetCode !== 0 || !profileData.RetData) {
      return NextResponse.json(
        { error: 'SSO token rejected by PeerTime' },
        { status: 401 },
      );
    }

    const ptUser = profileData.RetData;
    const email = (ptUser.Email || ptUser.email || '').toString().trim().toLowerCase();
    const fullName =
      ptUser.Name || ptUser.name || ptUser.UserName || ptUser.username || '';
    const username =
      ptUser.UserName ||
      ptUser.username ||
      email.split('@')[0] ||
      `kloud_${ptUser.UserID || Date.now()}`;
    const phone = ptUser.Mobile || ptUser.mobile || ptUser.phone || null;
    const avatarUrl = ptUser.AvatarUrl || ptUser.avatarUrl || ptUser.Avatar || null;
    const peerTimeUserId = String(ptUser.UserID || ptUser.userid || '');

    // ── 2. Find-or-create matching TeamMember in KloudMeet ──
    let member = null;

    // Try by email first
    if (email) {
      member = await prisma.teamMember.findFirst({ where: { email } });
    }
    // Fallback: match by peerTimeUserId if we stored it
    if (!member && peerTimeUserId) {
      member = await prisma.teamMember.findFirst({
        where: { username: `kloud_${peerTimeUserId}` },
      });
    }

    if (!member) {
      // Auto-provision a new KloudMeet account
      const safeUsername =
        email ? email.split('@')[0] : `kloud_${peerTimeUserId || Date.now()}`;

      // Ensure username uniqueness
      let finalUsername = safeUsername;
      const existing = await prisma.teamMember.findFirst({
        where: { username: finalUsername },
      });
      if (existing) {
        finalUsername = `${safeUsername}_${peerTimeUserId || Date.now()}`;
      }

      member = await prisma.teamMember.create({
        data: {
          email: email || null,
          username: finalUsername,
          fullName,
          phone,
          avatarUrl,
          passwordHash: crypto.randomBytes(32).toString('hex'), // random — login via SSO only
          emailVerified: true,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      });
    } else {
      // Update profile info from PeerTime in case it changed
      member = await prisma.teamMember.update({
        where: { id: member.id },
        data: {
          fullName: fullName || member.fullName,
          avatarUrl: avatarUrl || member.avatarUrl,
          phone: phone || member.phone,
        },
      });
    }

    if (member.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'Account is inactive or suspended' },
        { status: 401 },
      );
    }

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
