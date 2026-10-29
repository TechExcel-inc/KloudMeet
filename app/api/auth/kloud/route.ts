import { NextRequest, NextResponse } from 'next/server';
import { appOrigin } from '@/lib/googleOAuth';
import {
  KLOUD_STATE_COOKIE,
  encodeKloudState,
  kloudConnectUrl,
  kloudSignInAvailable,
  kloudStateCookieOptions,
  newKloudState,
} from '@/lib/kloudAuth';

/** GET /api/auth/kloud?next=… | ?link=<Connect intent> — starts "Continue with Kloud" on kloud.cn. */
export async function GET(request: NextRequest) {
  const origin = appOrigin(request);
  if (!kloudSignInAvailable()) {
    return NextResponse.redirect(new URL('/?error=Kloud+sign-in+is+not+available+yet', origin));
  }
  const { searchParams } = request.nextUrl;
  const payload = newKloudState(searchParams.get('next'), searchParams.get('link'));
  const response = NextResponse.redirect(kloudConnectUrl(origin, payload.state));
  response.cookies.set(KLOUD_STATE_COOKIE, encodeKloudState(payload), kloudStateCookieOptions(origin));
  return response;
}
