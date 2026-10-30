import { NextRequest, NextResponse } from 'next/server';
import { publicOrigin } from '@/lib/calendar/server';
import { DESIGN_ALLOW_LOCAL_HTTP, parseDesignLink, type StoredDesignLink } from '@/lib/designLink';
import { meetingDesignLinksEnabled } from '@/lib/designLinksSetting.server';
import { verifyParticipant } from '@/lib/livekitParticipantAuth';
import { parseKloudMemberIdFromIdentity } from '@/lib/meetingOwner';
import { parseMeetingRoomView, setMeetingRoomDesignLink } from '@/lib/meetingRoomView';

/**
 * POST — Design mode: set the link everyone views ({ url, embed? }) or clear it ({ url: null, view }).
 * Bearer: the caller's LiveKit token for this room. Signed-in participants only, so a guest
 * can't leave a link behind for late joiners; who may switch the stage is enforced in the
 * meeting UI, as for the other views. A new link needs the host's Design links setting on;
 * clearing one is always allowed.
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

    const participant = await verifyParticipant(request);
    if (!participant || participant.room !== roomName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (parseKloudMemberIdFromIdentity(participant.identity) === null) {
      return NextResponse.json({ error: 'Sign in to show a link to everyone' }, { status: 403 });
    }

    let payload: { url?: unknown; view?: unknown; embed?: unknown };
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (payload.url === null) {
      // Stopping: clear the link and set the next view in one write
      const view = parseMeetingRoomView(payload.view);
      const ok = await setMeetingRoomDesignLink(roomName, null, view && view !== 'design' ? view : undefined);
      if (!ok) return NextResponse.json({ error: 'Failed to update room' }, { status: 502 });
      return NextResponse.json({ designLink: null });
    }

    if (!(await meetingDesignLinksEnabled({ roomName }))) {
      return NextResponse.json(
        { error: 'Design links are off for this meeting', code: 'DESIGN_LINKS_OFF' },
        { status: 403 },
      );
    }

    const parsed = parseDesignLink(typeof payload.url === 'string' ? payload.url : '', {
      appOrigin: publicOrigin(request),
      allowLocalHttp: DESIGN_ALLOW_LOCAL_HTTP,
    });
    if (!parsed.ok) {
      return NextResponse.json({ error: 'Invalid link', code: parsed.error }, { status: 400 });
    }

    const designLink: StoredDesignLink = {
      url: parsed.link.url,
      setBy: participant.identity,
      ...(participant.name ? { setByName: participant.name.slice(0, 120) } : {}),
      setAt: Date.now(),
      // What the presenter's embed check found, so late joiners see the same state
      ...(payload.embed === 'blocked' ? { embed: 'blocked' as const } : {}),
    };
    const ok = await setMeetingRoomDesignLink(roomName, designLink, 'design');
    if (!ok) return NextResponse.json({ error: 'Failed to update room' }, { status: 502 });
    return NextResponse.json({ designLink });
  } catch (error) {
    console.error('[POST /api/meetings/[roomName]/design]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
