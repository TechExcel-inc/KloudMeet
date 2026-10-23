import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { redeemDesktopHandoff } from '@/lib/desktopAuth';
import { clientIp, rateLimited } from '@/lib/rateLimit';

/**
 * POST /api/auth/desktop/exchange { code, verifier } — called by the desktop app's main process
 * after kloudmeet://auth?code=… arrives. Returns a session token for the app window.
 */
export async function POST(request: NextRequest) {
  try {
    if (rateLimited(`desktop-exchange:ip:${clientIp(request)}`, 30, 15 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
    }
    const body = await request.json().catch(() => ({}));
    const result = await redeemDesktopHandoff(body?.code, body?.verifier);
    if (!result.ok) {
      return NextResponse.json({ error: 'Sign-in link expired. Please sign in again.' }, { status: 400 });
    }

    const member = await prisma.teamMember.findUnique({
      where: { id: result.teamMemberId },
      select: { id: true, status: true },
    });
    if (!member || member.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Account is suspended' }, { status: 403 });
    }

    const token = crypto.randomBytes(32).toString('hex');
    await prisma.session.create({
      data: {
        teamMemberId: member.id,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: request.headers.get('x-forwarded-for') || null,
        userAgent: request.headers.get('user-agent') || null,
      },
    });
    return NextResponse.json({ token, next: result.next });
  } catch (error) {
    console.error('[desktop exchange]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
