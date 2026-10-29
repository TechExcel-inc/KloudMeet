import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { normalizeEmail } from '@/lib/authPolicy';
import { emailCodeTarget } from '@/lib/accountLinking';
import { rateLimited } from '@/lib/rateLimit';
import { sendMail } from '@/lib/mail';
import { verificationEmail } from '@/lib/mail/templates';
import { discardCode, issueCode, issueErrorMessage } from '@/lib/verificationCodes';

/**
 * POST /api/account/email/send-code { email }
 * Emails a code that confirms `email` for the signed-in account: either a new address (it replaces the
 * current one only after /confirm) or the current, not yet verified one.
 */
export async function POST(request: NextRequest) {
  try {
    const member = await getSessionTeamMember(request);
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    if (!email) {
      return NextResponse.json({ error: 'Please enter a valid email address', code: 'EMAIL_INVALID' }, { status: 400 });
    }
    if (email === member.email?.toLowerCase() && member.emailVerified) {
      return NextResponse.json({ error: 'This email is already verified', code: 'EMAIL_ALREADY_VERIFIED' }, { status: 400 });
    }
    const taken = await prisma.teamMember.findFirst({
      where: { email, id: { not: member.id } },
      select: { id: true },
    });
    if (taken) {
      return NextResponse.json({ error: 'This email is already in use.', code: 'EMAIL_IN_USE' }, { status: 400 });
    }
    if (rateLimited(`email-code:member:${member.id}`, 10, 60 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }

    const issued = await issueCode(emailCodeTarget(member.id, email), 'email');
    if (!issued.ok) {
      return NextResponse.json(
        { error: issueErrorMessage(issued), retryAfter: issued.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(issued.retryAfterSeconds) } },
      );
    }

    const sent = await sendMail(verificationEmail(email, issued.code, 'email'));
    if (!sent.ok) {
      console.error('[email send-code] email delivery failed:', sent.provider, sent.error);
      await discardCode(issued.id);
      return NextResponse.json(
        { error: "We couldn't send the email right now. Please try again in a minute." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      message: 'Verification code sent',
      ...(process.env.NODE_ENV === 'development' ? { code: issued.code } : {}),
    });
  } catch (error) {
    console.error('[email send-code]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
