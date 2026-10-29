import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  GOOGLE_STATE_COOKIE,
  appOrigin,
  decodeGoogleState,
  googleRedirectUri,
  googleStateCookieOptions,
  stateMatches,
  usernameBaseFromEmail,
} from '@/lib/googleOAuth';
import { createDesktopHandoff } from '@/lib/desktopAuth';
import { redeemLinkIntent } from '@/lib/accountLinking';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  const origin = appOrigin(request);
  const redirectUri = googleRedirectUri(origin);
  const saved = decodeGoogleState(request.cookies.get(GOOGLE_STATE_COOKIE)?.value);

  // Every exit clears the one-time state cookie.
  const finish = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin));
    response.cookies.set(GOOGLE_STATE_COOKIE, '', googleStateCookieOptions(origin, 0));
    return response;
  };
  const fail = (message: string) => finish(`/?error=${encodeURIComponent(message)}`);

  if (error) {
    // The user closed or declined the Google consent screen.
    return error === 'access_denied' ? finish('/?signin=1') : fail(`Google sign-in failed: ${error}`);
  }
  if (!code) {
    return fail('Google sign-in failed. Please try again.');
  }
  if (!saved || !stateMatches(saved.state, searchParams.get('state'))) {
    return fail('Google sign-in expired. Please try again.');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return fail('Google sign-in is not available yet');
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
      console.error('[google callback] token error', tokenData?.error, tokenData?.error_description);
      return fail('Google sign-in failed. Please try again.');
    }

    const { access_token } = tokenData;

    // 2. Fetch user profile
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const profileData = await profileRes.json();
    if (!profileRes.ok) {
      console.error('[google callback] profile error', profileData?.error);
      return fail('Could not read your Google profile. Please try again.');
    }

    const { id: googleId, name, given_name, family_name, picture } = profileData;
    const email = typeof profileData.email === 'string' ? profileData.email.trim().toLowerCase() : '';

    if (!googleId || !email) {
      return fail('Your Google account must have an email address');
    }
    // Linking or creating by email is only safe when Google has verified the address.
    if (profileData.verified_email !== true) {
      return fail('Please verify your Google email address first');
    }

    const googleSub = String(googleId);

    // "Connect Google" from My Profile: bind to the account that asked, whatever its email.
    if (saved.link) {
      const ownerId = await redeemLinkIntent(saved.link, 'google');
      if (!ownerId) {
        return fail('This link has expired. Open My Profile and choose Connect again.');
      }
      const holder = await prisma.teamMember.findUnique({ where: { googleId: googleSub } });
      if (holder && holder.id !== ownerId) {
        return fail('This Google account is already connected to another Kloud Meet account.');
      }
      const owner = await prisma.teamMember.findUnique({ where: { id: ownerId } });
      if (!owner || owner.status !== 'ACTIVE') {
        return fail('Account is suspended');
      }
      if (owner.googleId && owner.googleId !== googleSub) {
        return fail('Your account is already connected to a different Google account. Disconnect it first.');
      }
      if (!owner.googleId) {
        // Google has verified this address, so the owner's matching email counts as verified too.
        const sameEmail = owner.email?.toLowerCase() === email;
        await prisma.teamMember.update({
          where: { id: owner.id },
          data: {
            googleId: googleSub,
            avatarUrl: owner.avatarUrl || picture || null,
            ...(sameEmail && !owner.emailVerified ? { emailVerified: true, emailVerifiedAt: new Date() } : {}),
            modifiedAt: new Date(),
            modifiedBy: 'connect-google',
          },
        });
      }
      return finish('/?linked=google');
    }

    // 3. Find or create TeamMember: the connected Google ID first, then an account whose email is
    //    verified on both sides. An unverified account with this email is not taken over.
    let member = await prisma.teamMember.findUnique({ where: { googleId: googleSub } });

    if (!member) {
      const sameEmail = await prisma.teamMember.findUnique({ where: { email } });
      if (sameEmail?.googleId) {
        console.warn('[google callback] email already linked to another Google account', sameEmail.id);
        return fail('This email is already linked to a different Google account');
      }
      if (sameEmail && !sameEmail.emailVerified) {
        return fail(
          'An account with this email already exists. Sign in with your password, then connect Google in My Profile.',
        );
      }
      if (sameEmail) {
        member = await prisma.teamMember.update({
          where: { id: sameEmail.id },
          data: {
            googleId: googleSub,
            avatarUrl: sameEmail.avatarUrl || picture || null,
          },
        });
      }
    }

    if (!member) {
      // Create new user with a distinct username derived from the email
      const baseUsername = usernameBaseFromEmail(email);
      let username = baseUsername;
      let counter = 1;
      while (await prisma.teamMember.findUnique({ where: { username } })) {
        username = `${baseUsername}${counter}`;
        counter++;
      }

      member = await prisma.teamMember.create({
        data: {
          googleId: googleSub,
          email,
          username,
          fullName: name || username,
          firstName: given_name || null,
          lastName: family_name || null,
          avatarUrl: picture || null,
          emailVerified: true,
          emailVerifiedAt: new Date(),
          passwordHash: crypto.randomBytes(32).toString('hex'), // Impossible to guess dummy password
          status: 'ACTIVE',
          createdBy: 'google',
        },
      });
    }

    if (member.status !== 'ACTIVE') {
      return fail('Account is suspended');
    }

    // Started from the desktop app: hand off to it through kloudmeet:// instead of signing in this browser.
    if (saved.desktop) {
      const handoff = await createDesktopHandoff({
        teamMemberId: member.id,
        challenge: saved.desktop,
        next: saved.next,
      });
      return finish(`/auth/desktop?${new URLSearchParams({ code: handoff }).toString()}`);
    }

    // 4. Create session
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

    // 5. Back to the app; the home page stores the session and follows `next`.
    const params = new URLSearchParams({ sso_token: token });
    if (saved.next) params.set('next', saved.next);
    return finish(`/?${params.toString()}`);
  } catch (err) {
    console.error('[google callback] unhandled error', err);
    return fail('Google sign-in failed. Please try again.');
  }
}
