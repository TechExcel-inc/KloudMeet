import { NextRequest, NextResponse } from 'next/server';
import {
  GOOGLE_STATE_COOKIE,
  appOrigin,
  buildGoogleAuthUrl,
  encodeGoogleState,
  googleRedirectUri,
  googleStateCookieOptions,
  newGoogleState,
} from '@/lib/googleOAuth';

export async function GET(request: NextRequest) {
  const origin = appOrigin(request);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error('[google] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set');
    return NextResponse.redirect(new URL('/?error=Google+sign-in+is+not+available+yet', origin));
  }

  const { searchParams } = request.nextUrl;
  // `desktop`: PKCE challenge from the desktop app, which opened this page in the system browser.
  const payload = newGoogleState(searchParams.get('next'), searchParams.get('desktop'));
  const response = NextResponse.redirect(
    buildGoogleAuthUrl(clientId, googleRedirectUri(origin), payload.state),
  );
  response.cookies.set(GOOGLE_STATE_COOKIE, encodeGoogleState(payload), googleStateCookieOptions(origin));
  return response;
}
