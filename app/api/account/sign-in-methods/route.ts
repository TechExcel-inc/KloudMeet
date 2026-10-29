import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { canDisconnect, createLinkIntent, signInMethodsOf, type LinkProvider } from '@/lib/accountLinking';
import { kloudSignInAvailable, removeKloudMemberships } from '@/lib/kloudAuth';

/** GET /api/account/sign-in-methods — what My Profile shows under "Sign-in methods". */
export async function GET(request: NextRequest) {
  const member = await getSessionTeamMember(request);
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(signInMethodsOf(member));
}

/**
 * POST /api/account/sign-in-methods { provider: "google" | "kloud", action: "connect" | "disconnect" }
 * - connect: returns { url } to open in this tab; the provider sends the browser back to the home page.
 * - disconnect: only while another way to sign in remains.
 */
export async function POST(request: NextRequest) {
  try {
    const member = await getSessionTeamMember(request);
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const provider: LinkProvider | null = body?.provider === 'google' || body?.provider === 'kloud' ? body.provider : null;
    const action = body?.action === 'connect' || body?.action === 'disconnect' ? body.action : null;
    if (!provider || !action) {
      return NextResponse.json({ error: 'Unknown sign-in method' }, { status: 400 });
    }

    if (action === 'connect') {
      if (provider === 'google' && !(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)) {
        return NextResponse.json({ error: 'Google sign-in is not available yet', code: 'UNAVAILABLE' }, { status: 400 });
      }
      if (provider === 'kloud' && !kloudSignInAvailable()) {
        return NextResponse.json({ error: 'Kloud sign-in is not available yet', code: 'UNAVAILABLE' }, { status: 400 });
      }
      if (provider === 'google' ? member.googleId : member.kloudUserId) {
        return NextResponse.json({ error: 'Already connected', code: 'ALREADY_CONNECTED' }, { status: 400 });
      }
      const token = await createLinkIntent(member.id, provider);
      return NextResponse.json({ url: `/api/auth/${provider}?${new URLSearchParams({ link: token }).toString()}` });
    }

    if (!canDisconnect(member, provider)) {
      return NextResponse.json(
        {
          error: 'Keep at least one way to sign in: verify your email or connect another method first.',
          code: 'LAST_METHOD',
        },
        { status: 400 },
      );
    }
    const now = new Date();
    const updated = await prisma.teamMember.update({
      where: { id: member.id },
      data:
        provider === 'google'
          ? { googleId: null, modifiedAt: now, modifiedBy: 'disconnect-google' }
          : { kloudUserId: null, kloudLinkedAt: null, modifiedAt: now, modifiedBy: 'disconnect-kloud' },
    });
    // Company memberships that came from Kloud end with the connection.
    if (provider === 'kloud') await removeKloudMemberships(member.id);
    return NextResponse.json(signInMethodsOf(updated));
  } catch (error) {
    console.error('[sign-in-methods]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
