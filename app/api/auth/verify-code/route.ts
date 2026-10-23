import { NextRequest, NextResponse } from 'next/server';
import { codePurpose, normalizeEmail } from '@/lib/authPolicy';
import { clientIp, rateLimited } from '@/lib/rateLimit';
import { checkCode, codeErrorMessage } from '@/lib/verificationCodes';

/**
 * POST /api/auth/verify-code { target, code, intent } — checks a code without using it up,
 * so the form can confirm it before asking for a password. Wrong guesses count toward the cap.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body?.target);
    const code = typeof body?.code === 'string' ? body.code.trim() : '';

    if (!email || !code) {
      return NextResponse.json({ valid: false, error: 'Email and code required' }, { status: 400 });
    }
    if (rateLimited(`verify-code:ip:${clientIp(request)}`, 30, 15 * 60 * 1000)) {
      return NextResponse.json({ valid: false, error: 'Too many attempts. Please try again later.' }, { status: 429 });
    }

    const result = await checkCode(email, codePurpose(body?.intent), code);
    if (!result.ok) {
      return NextResponse.json(
        { valid: false, error: codeErrorMessage(result), attemptsLeft: result.attemptsLeft },
        { status: 400 },
      );
    }
    return NextResponse.json({ valid: true });
  } catch (error) {
    console.error('[verify-code]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
