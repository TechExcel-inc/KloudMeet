import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { resolveStageIdentity } from '@/lib/livedoc/stageIdentity.server';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/livedoc/stage-identity { roomName }
 * The Kloud login and From Space scope for this person on the meeting's LiveDoc stage.
 * `token: null` means: use the anonymous instant account (/api/livedoc/instant-account).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let roomName = '';
  try {
    const body = (await request.json()) as { roomName?: unknown };
    if (typeof body?.roomName === 'string') roomName = body.roomName.trim().slice(0, 191);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

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

  const identity = await resolveStageIdentity({ member, ssoToken, roomName });
  return NextResponse.json(identity, { headers: { 'Cache-Control': 'no-store' } });
}
