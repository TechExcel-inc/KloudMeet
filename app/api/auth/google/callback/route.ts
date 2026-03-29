import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  const host = request.headers.get('host') || 'localhost:3201';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const origin = `${protocol}://${host}`;
  const redirectUri = `${origin}/api/auth/google/callback`;

  if (error) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error)}`, origin));
  }
  if (!code) {
    return NextResponse.redirect(new URL('/?error=No+code+provided', origin));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/?error=Google+OAuth+not+configured', origin));
  }

  try {
    // 1. Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error('[google callback] token error', tokenData);
      return NextResponse.redirect(new URL('/?error=Failed+to+exchange+token', origin));
    }

    const { access_token } = tokenData;

    // 2. Fetch user profile
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const profileData = await profileRes.json();
    if (!profileRes.ok) {
      console.error('[google callback] profile error', profileData);
      return NextResponse.redirect(new URL('/?error=Failed+to+fetch+profile', origin));
    }

    const { id: googleId, email, name, given_name, family_name, picture } = profileData;

    if (!email) {
      return NextResponse.redirect(new URL('/?error=Google+account+must+have+an+email', origin));
    }

    // 3. Find or Create TeamMember
    let member = await prisma.teamMember.findFirst({
      where: {
        OR: [
          { googleId },
          { email }
        ]
      }
    });

    if (member) {
      // Update googleId if matched by email
      if (!member.googleId) {
        member = await prisma.teamMember.update({
          where: { id: member.id },
          data: { googleId }
        });
      }
    } else {
      // Create new user
      // Generate a distinct username from email
      const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
      let username = baseUsername;
      let counter = 1;
      while (await prisma.teamMember.findUnique({ where: { username } })) {
        username = `${baseUsername}${counter}`;
        counter++;
      }

      member = await prisma.teamMember.create({
        data: {
          googleId,
          email,
          username,
          fullName: name || null,
          firstName: given_name || null,
          lastName: family_name || null,
          avatarUrl: picture || null,
          emailVerified: true,
          passwordHash: crypto.randomBytes(32).toString('hex'), // Impossible to guess dummy password
          status: 'ACTIVE',
        }
      });
    }

    if (member.status !== 'ACTIVE') {
      return NextResponse.redirect(new URL('/?error=Account+is+suspended', origin));
    }

    // 4. Create Session
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

    // 5. Redirect back to homepage with session token
    return NextResponse.redirect(new URL(`/?sso_token=${token}`, origin));

  } catch (error) {
    console.error('[google callback] unhandled error', error);
    return NextResponse.redirect(new URL('/?error=Internal+server+error', origin));
  }
}
