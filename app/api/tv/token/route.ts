import { NextRequest, NextResponse } from 'next/server';
import { getRoomServiceClient } from '@/lib/livekitRooms';
import { createLiveKitParticipantToken } from '@/lib/livekitParticipantToken';
import { clientIp, rateLimited } from '@/lib/rateLimit';
import {
  REMOTE_IDENTITY_PREFIX,
  TV_IDENTITY_PREFIX,
  TV_ROOM_PREFIX,
  isPairCode,
} from '@/lib/tv/protocol';

/**
 * Kloud Meet TV pairing room tickets.
 *
 * The TV shows a 6-digit code and joins `kmtv-<code>`; a phone that enters the code (or
 * scans the QR) joins the same room as a remote. Both get data-only tickets: no audio, no
 * video, nothing published but small control messages. The meeting itself is joined
 * separately, through /api/connection-details, with the meeting's own access rules.
 *
 * - A code belongs to the TV that is online with it; another TV asking for it gets 409.
 * - Remotes only get a ticket while the TV is there (404 otherwise), so a remote never
 *   creates rooms. The TV still has to approve a remote unless it scanned the QR.
 */

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
  return name || fallback;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const role = body?.role;
  const code = body?.code;
  const deviceId = body?.deviceId;
  if ((role !== 'tv' && role !== 'remote') || !isPairCode(code) || typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
    return NextResponse.json({ code: 'BAD_REQUEST' }, { status: 400 });
  }

  const ip = clientIp(request);
  if (rateLimited(`tv-token:${role}:${ip}`, role === 'tv' ? 30 : 60, 10 * 60_000)) {
    return NextResponse.json({ code: 'TOO_MANY' }, { status: 429 });
  }

  const client = getRoomServiceClient();
  if (!client || !LIVEKIT_URL || !API_KEY || !API_SECRET) {
    return NextResponse.json({ code: 'UNAVAILABLE' }, { status: 503 });
  }

  const roomName = `${TV_ROOM_PREFIX}${code}`;
  const identity = `${role === 'tv' ? TV_IDENTITY_PREFIX : REMOTE_IDENTITY_PREFIX}${deviceId}`;

  let tvOnline: string | null = null;
  try {
    const participants = await client.listParticipants(roomName);
    tvOnline = participants.find((p) => p.identity.startsWith(TV_IDENTITY_PREFIX))?.identity ?? null;
  } catch {
    // No such room yet
  }

  if (role === 'tv') {
    if (tvOnline && tvOnline !== identity) {
      return NextResponse.json({ code: 'CODE_IN_USE' }, { status: 409 });
    }
    try {
      await client.createRoom({ name: roomName, emptyTimeout: 10 * 60, maxParticipants: 9 });
    } catch (err) {
      console.error('[tv/token] createRoom', err);
      return NextResponse.json({ code: 'UNAVAILABLE' }, { status: 503 });
    }
  } else if (!tvOnline) {
    return NextResponse.json({ code: 'TV_NOT_FOUND' }, { status: 404 });
  }

  const token = await createLiveKitParticipantToken({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    identity,
    name: cleanName(body?.name, role === 'tv' ? 'Kloud Meet TV' : 'Phone'),
    metadata: JSON.stringify({ kmtv: role }),
    roomName,
    ttl: role === 'tv' ? '24h' : '6h',
    grant: { canPublish: false, canPublishData: true, canSubscribe: true },
  });

  return NextResponse.json(
    { serverUrl: LIVEKIT_URL, token, roomName, identity },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
