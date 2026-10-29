import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { normalizeEmail } from '@/lib/authPolicy';
import { emailCodeTarget } from '@/lib/accountLinking';
import { rateLimited } from '@/lib/rateLimit';
import { checkCode, codeErrorMessage } from '@/lib/verificationCodes';

/**
 * POST /api/account/email/confirm { email, code }
 * With the code from /send-code, makes `email` the account's verified email. Until then the
 * previous address stays in place.
 */
export async function POST(request: NextRequest) {
  try {
    const member = await getSessionTeamMember(request);
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!email || !code) {
      return NextResponse.json({ error: 'Email and code required' }, { status: 400 });
    }
    if (rateLimited(`email-confirm:member:${member.id}`, 30, 15 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
    }

    const result = await checkCode(emailCodeTarget(member.id, email), 'email', code, { consume: true });
    if (!result.ok) {
      return NextResponse.json(
        { error: codeErrorMessage(result), attemptsLeft: result.attemptsLeft, code: 'CODE_INVALID' },
        { status: 400 },
      );
    }

    try {
      const now = new Date();
      const updated = await prisma.teamMember.update({
        where: { id: member.id },
        data: { email, emailVerified: true, emailVerifiedAt: now, modifiedAt: now, modifiedBy: 'email-confirm' },
      });
      return NextResponse.json({ email: updated.email, emailVerified: true });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return NextResponse.json({ error: 'This email is already in use.', code: 'EMAIL_IN_USE' }, { status: 400 });
      }
      throw error;
    }
  } catch (error) {
    console.error('[email confirm]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
