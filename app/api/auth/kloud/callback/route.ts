import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { appOrigin, stateMatches, usernameBaseFromEmail } from '@/lib/googleOAuth';
import { redeemLinkIntent } from '@/lib/accountLinking';
import {
  KLOUD_STATE_COOKIE,
  decodeKloudState,
  fetchKloudUser,
  kloudStateCookieOptions,
  recordKloudCompanies,
} from '@/lib/kloudAuth';

const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{8,512}$/;

/**
 * POST /api/auth/kloud/callback (form: state, token) — kloud.cn sends the confirmed Kloud user back.
 * - Started from "Connect Kloud account": binds the Kloud user to the account that asked.
 * - Otherwise signs in the Kloud Meet account already bound to this Kloud user, or creates one.
 *   An existing account with the same email is not taken over: the person signs in to it and connects.
 */
export async function POST(request: NextRequest) {
  const origin = appOrigin(request);
  const saved = decodeKloudState(request.cookies.get(KLOUD_STATE_COOKIE)?.value);

  // 303: the browser follows with a GET. Every exit clears the one-time state cookie.
  const finish = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin), 303);
    response.cookies.set(KLOUD_STATE_COOKIE, '', kloudStateCookieOptions(origin, 0));
    return response;
  };
  const fail = (message: string) => finish(`/?error=${encodeURIComponent(message)}`);

  try {
    const form = await request.formData().catch(() => null);
    const state = typeof form?.get('state') === 'string' ? (form!.get('state') as string) : null;
    const token = typeof form?.get('token') === 'string' ? (form!.get('token') as string).trim() : '';

    if (!saved || !stateMatches(saved.state, state)) {
      return fail('Kloud sign-in expired. Please try again.');
    }
    if (!TOKEN_RE.test(token)) {
      return fail('Kloud sign-in failed. Please try again.');
    }

    const kloud = await fetchKloudUser(token);
    if (!kloud) {
      return fail('Kloud sign-in failed. Please sign in to Kloud and try again.');
    }
    const now = new Date();

    // "Connect Kloud account" from My Profile: bind to the account that asked, whatever its email.
    if (saved.link) {
      const ownerId = await redeemLinkIntent(saved.link, 'kloud');
      if (!ownerId) {
        return fail('This link has expired. Open My Profile and choose Connect again.');
      }
      const holder = await prisma.teamMember.findUnique({ where: { kloudUserId: kloud.id } });
      if (holder && holder.id !== ownerId) {
        return fail('This Kloud account is already connected to another Kloud Meet account.');
      }
      const owner = await prisma.teamMember.findUnique({ where: { id: ownerId } });
      if (!owner || owner.status !== 'ACTIVE') {
        return fail('Account is suspended');
      }
      if (owner.kloudUserId && owner.kloudUserId !== kloud.id) {
        return fail('Your account is already connected to a different Kloud account. Disconnect it first.');
      }
      if (!owner.kloudUserId) {
        await prisma.teamMember.update({
          where: { id: owner.id },
          data: {
            kloudUserId: kloud.id,
            kloudLinkedAt: now,
            avatarUrl: owner.avatarUrl || kloud.avatarUrl,
            modifiedAt: now,
            modifiedBy: 'connect-kloud',
          },
        });
      }
      await recordKloudCompanies(owner.id, kloud.companies, now);
      return finish('/?linked=kloud');
    }

    let member = await prisma.teamMember.findUnique({ where: { kloudUserId: kloud.id } });

    if (!member) {
      // Kloud does not prove the email is verified, so an account with this email is never taken over.
      if (kloud.email && (await prisma.teamMember.findUnique({ where: { email: kloud.email }, select: { id: true } }))) {
        return fail(
          'An account with this email already exists. Sign in to your Kloud Meet account, then connect Kloud in My Profile.',
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
          // The address still has to be confirmed in My Profile.
          emailVerified: false,
          passwordHash: crypto.randomBytes(32).toString('hex'), // Impossible to guess dummy password
          status: 'ACTIVE',
          createdBy: 'kloud',
        },
      });
    }

    if (member.status !== 'ACTIVE') {
      return fail('Account is suspended');
    }
    await recordKloudCompanies(member.id, kloud.companies, now);

    const sessionToken = crypto.randomBytes(32).toString('hex');
    await prisma.session.create({
      data: {
        teamMemberId: member.id,
        token: sessionToken,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: request.headers.get('x-forwarded-for') || null,
        userAgent: request.headers.get('user-agent') || null,
      },
    });

    const params = new URLSearchParams({ sso_token: sessionToken, via: 'kloud' });
    if (saved.next) params.set('next', saved.next);
    return finish(`/?${params.toString()}`);
  } catch (err) {
    console.error('[kloud callback] unhandled error', err);
    return fail('Kloud sign-in failed. Please try again.');
  }
}
