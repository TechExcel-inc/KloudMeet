import { NextRequest, NextResponse } from 'next/server';
import { appendPresence, type PresenceInput } from '@/lib/livedoc/presenceRecord';
import { isPresenceKind } from '@/lib/livedoc/presence';
import { verifyParticipant } from '@/lib/livekitParticipantAuth';

/**
 * POST — a person in the meeting reports presence for a LiveDoc Full recording:
 * joining or leaving, and microphone or camera on or off.
 * The caller is a LiveKit participant of this room (members and guests).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
) {
  try {
    const roomName = (await params)?.roomName;
    if (!roomName) return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });
    const participant = await verifyParticipant(request);
    if (!participant || participant.room !== roomName) {
      return NextResponse.json({ error: 'Not in this meeting' }, { status: 401 });
    }

    const body = (await request.json()) as { events?: unknown };
    if (!Array.isArray(body.events) || body.events.length === 0 || body.events.length > 40) {
      return NextResponse.json({ error: 'events must be 1 to 40 items' }, { status: 400 });
    }
    const events: PresenceInput[] = [];
    for (const item of body.events) {
      if (!item || typeof item !== 'object') {
        return NextResponse.json({ error: 'Bad event' }, { status: 400 });
      }
      const row = item as { identity?: unknown; name?: unknown; kind?: unknown; on?: unknown };
      if (typeof row.identity !== 'string' || typeof row.name !== 'string' || typeof row.on !== 'boolean' || !isPresenceKind(row.kind)) {
        return NextResponse.json({ error: 'Bad event' }, { status: 400 });
      }
      events.push({ identity: row.identity, name: row.name, kind: row.kind, on: row.on });
    }
    const wrote = await appendPresence(roomName, events);
    return NextResponse.json({ success: true, wrote });
  } catch (err) {
    console.error('[POST /api/meetings/presence]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
