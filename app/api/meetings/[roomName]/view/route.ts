import { NextRequest, NextResponse } from 'next/server';
import { TokenVerifier } from 'livekit-server-sdk';
import {
  parseMeetingRoomView,
  setMeetingRoomCurrentView,
} from '@/lib/meetingRoomView';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

function getBearerToken(request: NextRequest): string {
  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

async function verifyRoomParticipant(
  request: NextRequest,
  roomName: string,
): Promise<boolean> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const token = getBearerToken(request);
  if (!apiKey || !apiSecret || !token) return false;

  try {
    const claims = await new TokenVerifier(apiKey, apiSecret).verify(token);
    const identity = claims.sub;
    return (
      typeof identity === 'string' &&
      !!identity &&
      claims.video?.room === roomName &&
      claims.video?.roomJoin === true
    );
  } catch {
    return false;
  }
}

/** POST — persist authoritative meeting view for late joiners (LiveKit room metadata). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
): Promise<NextResponse> {
  return runWithLocale(request, async () => {
  try {
    const { roomName } = await params;
    if (!roomName) {
      return apiJson({ error: 'Room name not provided' }, { status: 400 });
    }

    const allowed = await verifyRoomParticipant(request, roomName);
    if (!allowed) {
      return apiJson({ error: 'Unauthorized' }, { status: 401 });
    }

    let payload: { view?: unknown };
    try {
      payload = await request.json();
    } catch {
      return apiJson({ error: 'Invalid JSON' }, { status: 400 });
    }

    const view = parseMeetingRoomView(payload.view);
    if (!view) {
      return apiJson({ error: 'Invalid view' }, { status: 400 });
    }

    const ok = await setMeetingRoomCurrentView(roomName, view);
    if (!ok) {
      return apiJson({ error: 'Failed to update room view' }, { status: 502 });
    }

    return apiJson({ view });
  } catch (error) {
    console.error('[POST /api/meetings/[roomName]/view]', error);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
