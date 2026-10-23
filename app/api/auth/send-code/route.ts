import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { sendEmailVerification } from '@/lib/brevo';
import { codePurpose, normalizeEmail } from '@/lib/authPolicy';
import { clientIp, rateLimited } from '@/lib/rateLimit';
import { discardCode, issueCode, issueErrorMessage } from '@/lib/verificationCodes';

const PHONE_UNAVAILABLE = 'Phone sign-in is not available yet. Please use your email address.';

/**
 * POST /api/auth/send-code { target: email, intent: "signup" | "reset" }
 * Emails a 6-digit code. For "reset" the response is the same whether or not the account
 * exists, so this endpoint cannot be used to look up who has an account.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawTarget = typeof body?.target === 'string' ? body.target.trim() : '';
    const purpose = codePurpose(body?.intent);

    if (!rawTarget) {
      return NextResponse.json({ error: 'Please enter your email address' }, { status: 400 });
    }
    if (rawTarget.startsWith('+') || body?.type === 1) {
      return NextResponse.json({ error: PHONE_UNAVAILABLE }, { status: 400 });
    }
    const email = normalizeEmail(rawTarget);
    if (!email) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
    }
    if (rateLimited(`send-code:ip:${clientIp(request)}`, 20, 60 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }

    const existing = await prisma.teamMember.findFirst({ where: { email }, select: { id: true } });
    if (purpose === 'signup' && existing) {
      return NextResponse.json(
        { error: 'This email is already registered. Sign in or reset your password.', code: 'EMAIL_TAKEN' },
        { status: 400 },
      );
    }
    if (purpose === 'reset' && !existing) {
      // Same answer as a real send (no email goes out).
      return NextResponse.json({ message: 'Verification code sent' });
    }

    const issued = await issueCode(email, purpose);
    if (!issued.ok) {
      return NextResponse.json(
        { error: issueErrorMessage(issued), retryAfter: issued.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(issued.retryAfterSeconds) } },
      );
    }

    const sent = await sendEmailVerification(email, issued.code, purpose);
    if (!sent.success) {
      console.error('[send-code] email delivery failed:', sent.error);
      await discardCode(issued.id);
      return NextResponse.json(
        { error: "We couldn't send the email right now. Please try again in a minute." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      message: 'Verification code sent',
      // Include code in development mode for testing
      ...(process.env.NODE_ENV === 'development' ? { code: issued.code } : {}),
    });
  } catch (error) {
    console.error('[send-code]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
