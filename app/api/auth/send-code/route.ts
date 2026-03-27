import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

const CODE_LENGTH = 6;
const CODE_EXPIRY_MINUTES = 10;

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { target, type, intent } = body;
    // type: 0 = email, 1 = phone/SMS
    // intent: "signup" (default) or "reset"

    const decodedTarget = decodeURIComponent((target || '').trim());
    if (!decodedTarget) {
      return NextResponse.json({ error: 'Target (email or phone) required' }, { status: 400 });
    }

    const isPhone = decodedTarget.startsWith('+');
    const isReset = intent === 'reset';

    // Determine code type
    let codeType: string;
    if (type === 1 || isPhone) {
      codeType = isReset ? 'RESET_SMS' : 'SIGNUP_SMS';
    } else {
      codeType = isReset ? 'RESET_EMAIL' : 'SIGNUP_EMAIL';
    }

    // For signup, check that target is not already registered
    if (!isReset) {
      if (isPhone) {
        const existing = await prisma.teamMember.findFirst({ where: { phone: decodedTarget } });
        if (existing) {
          return NextResponse.json({ error: 'Phone already registered' }, { status: 400 });
        }
      } else {
        const existing = await prisma.teamMember.findFirst({ where: { email: decodedTarget } });
        if (existing) {
          return NextResponse.json({ error: 'Email already registered' }, { status: 400 });
        }
      }
    }

    // For reset, verify target exists
    if (isReset) {
      const existing = isPhone
        ? await prisma.teamMember.findFirst({ where: { phone: decodedTarget } })
        : await prisma.teamMember.findFirst({ where: { email: decodedTarget } });
      if (!existing) {
        return NextResponse.json({ error: 'Account not found' }, { status: 400 });
      }
    }

    // Generate and store code
    const code = generateCode();
    await prisma.verificationCode.create({
      data: {
        target: decodedTarget,
        code,
        type: codeType,
        expiresAt: new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000),
        used: false,
      },
    });

    // In development/test mode, log the code to console
    // In production, integrate with an email/SMS service
    console.log(`[send-code] ${isPhone ? 'SMS' : 'Email'} code for ${decodedTarget}: ${code}`);

    return NextResponse.json({
      message: 'Verification code sent',
      // Include code in development mode for testing
      ...(process.env.NODE_ENV === 'development' ? { code } : {}),
    });
  } catch (error) {
    console.error('[send-code]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
