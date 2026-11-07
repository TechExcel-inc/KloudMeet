import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { resolveStageIdentity } from '@/lib/livedoc/stageIdentity.server';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/livedoc/stage-identity
 * The Kloud login this person uses on the meeting's LiveDoc stage.
 * `token: null` means: use the anonymous instant account (/api/livedoc/instant-account).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const member = await getSessionTeamMember(request);
  const rawSso = request.cookies.get('kloud_sso_token')?.value ?? null;
  let ssoToken = rawSso;
  if (rawSso) {
    try {
      ssoToken = decodeURIComponent(rawSso);
    } catch {
      ssoToken = rawSso;
    }
  }

  const identity = await resolveStageIdentity({ member, ssoToken });
  return NextResponse.json(identity, { headers: { 'Cache-Control': 'no-store' } });
}
