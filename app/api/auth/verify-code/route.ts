import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { target, code } = body;

    const decodedTarget = decodeURIComponent((target || '').trim());
    const decodedCode = decodeURIComponent((code || '').trim());

    if (!decodedTarget || !decodedCode) {
      return NextResponse.json({ error: 'Target and code required' }, { status: 400 });
    }

    const vc = await prisma.verificationCode.findFirst({
      where: {
        target: decodedTarget,
        code: decodedCode,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!vc) {
      return NextResponse.json({ valid: false, error: 'Invalid or expired code' }, { status: 400 });
    }

    return NextResponse.json({ valid: true });
  } catch (error) {
    console.error('[verify-code]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
