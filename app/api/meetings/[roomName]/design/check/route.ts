import { NextRequest, NextResponse } from 'next/server';
import { publicOrigin } from '@/lib/calendar/server';
import { checkDesignEmbed } from '@/lib/designEmbedServer';
import { verifyParticipant } from '@/lib/livekitParticipantAuth';
import { clientIp, rateLimited } from '@/lib/rateLimit';

/** Checks per participant (and per address) in a window: pasting and editing links, not crawling */
const CHECKS_PER_WINDOW = 30;
const CHECK_WINDOW_MS = 5 * 60 * 1000;

/**
 * POST { url } — Design mode: before a link is shown to everyone, can this site be shown inside
 * the meeting? Answers { embed: 'ok' | 'blocked' | 'unknown', reason? }.
 * Bearer: the caller's LiveKit token for this room, as for the sibling design route (the
 * /dev/tiles preview runs without one in development). The server fetches only public https
 * pages (see checkDesignEmbed) and reads only their headers.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
): Promise<NextResponse> {
  try {
    const { roomName } = await params;
    if (!roomName) {
      return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });
    }
    const devPreview = process.env.NODE_ENV !== 'production' && !request.headers.get('authorization');
    let caller = 'dev-preview';
    if (!devPreview) {
      const participant = await verifyParticipant(request);
      if (!participant || participant.room !== roomName) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      caller = `${roomName}:${participant.identity}`;
    }
    if (
      rateLimited(`design-check:ip:${clientIp(request)}`, CHECKS_PER_WINDOW * 2, CHECK_WINDOW_MS) ||
      rateLimited(`design-check:id:${caller}`, CHECKS_PER_WINDOW, CHECK_WINDOW_MS)
    ) {
      return NextResponse.json({ embed: 'unknown', error: 'Too many checks' }, { status: 429 });
    }

    let payload: { url?: unknown };
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (typeof payload.url !== 'string' || !payload.url) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 400 });
    }

    const result = await checkDesignEmbed(payload.url, publicOrigin(request));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[POST /api/meetings/[roomName]/design/check]', error);
    return NextResponse.json({ embed: 'unknown' });
  }
}
