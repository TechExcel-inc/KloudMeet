import { ensurePersonalRoomMeeting } from '@/lib/meetingRoomIsActive';
import {
  findPersonalRoomOwner,
  resolveCanonicalRoomName,
} from '@/lib/personalRoom';
import { randomString } from '@/lib/client-utils';
import { getLiveKitURL } from '@/lib/getLiveKitURL';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { ConnectionDetails } from '@/lib/types';
import {
  isMeetingPermanentlyClosed,
  prepareMeetingForJoin,
} from '@/lib/meetingRejoin';
import {
  buildKloudMemberIdentity,
  sanitizeKloudDeviceId,
} from '@/lib/meetingOwner';
import { evictParticipantsByMemberId } from '@/lib/livekitRooms';
import { AccessToken, AccessTokenOptions, VideoGrant } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

const COOKIE_KEY = 'random-participant-postfix';
const DEVICE_COOKIE_KEY = 'kloud-device-id';

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const roomName = request.nextUrl.searchParams.get('roomName');
    const participantName = request.nextUrl.searchParams.get('participantName');
    const metadata = request.nextUrl.searchParams.get('metadata') ?? '';
    const deviceIdParam = request.nextUrl.searchParams.get('deviceId');
    const region = request.nextUrl.searchParams.get('region');
    if (!LIVEKIT_URL) {
      throw new Error('LIVEKIT_URL is not defined');
    }
    const livekitServerUrl = region ? getLiveKitURL(LIVEKIT_URL, region) : LIVEKIT_URL;
    let randomParticipantPostfix = request.cookies.get(COOKIE_KEY)?.value;
    if (livekitServerUrl === undefined) {
      throw new Error('Invalid region');
    }

    if (typeof roomName !== 'string') {
      return new NextResponse('Missing required query parameter: roomName', { status: 400 });
    }
    if (participantName === null) {
      return new NextResponse('Missing required query parameter: participantName', { status: 400 });
    }

    const livekitRoomName = await resolveCanonicalRoomName(roomName);

    let meeting = await ensurePersonalRoomMeeting(livekitRoomName);
    const personalOwner = await findPersonalRoomOwner(livekitRoomName);
    const isPersonalRoom = Boolean(
      meeting && personalOwner && personalOwner.id === meeting.createdByMemberId,
    );

    if (!meeting) {
      return new NextResponse('Meeting not found', { status: 404 });
    }

    const authHeader = request.headers.get('authorization');
    const bearerToken =
      authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const clientClaimsLoggedIn = bearerToken.length > 0;

    const member = await getSessionTeamMember(request);
    if (clientClaimsLoggedIn && !member) {
      return new NextResponse('Session expired or invalid', { status: 401 });
    }

    meeting = await prepareMeetingForJoin(meeting);

    if (isMeetingPermanentlyClosed(meeting.status) && !isPersonalRoom) {
      return new NextResponse('Meeting has already ended', { status: 403 });
    }

    let identity: string;
    let tokenMetadata = metadata;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (member) {
      let deviceId =
        sanitizeKloudDeviceId(deviceIdParam) ??
        sanitizeKloudDeviceId(request.cookies.get(DEVICE_COOKIE_KEY)?.value);
      if (!deviceId) {
        deviceId = randomString(8);
      }
      identity = buildKloudMemberIdentity(member.id, deviceId);
      tokenMetadata = JSON.stringify({ kloudMemberId: member.id, kloudDeviceId: deviceId });
      headers['Set-Cookie'] = `${DEVICE_COOKIE_KEY}=${deviceId}; Path=/; HttpOnly; SameSite=Strict; Secure; Expires=${getCookieExpirationTime()}`;
    } else {
      const guestDeviceId = sanitizeKloudDeviceId(deviceIdParam);
      if (!randomParticipantPostfix) {
        randomParticipantPostfix = randomString(4);
      }
      identity = guestDeviceId
        ? `${participantName}__${randomParticipantPostfix}_${guestDeviceId}`
        : `${participantName}__${randomParticipantPostfix}`;
      headers['Set-Cookie'] = `${COOKIE_KEY}=${randomParticipantPostfix}; Path=/; HttpOnly; SameSite=Strict; Secure; Expires=${getCookieExpirationTime()}`;
    }

    // Evict any existing session for the same member BEFORE issuing the new
    // token. The old client receives PARTICIPANT_REMOVED and shows the
    // "Session Moved" popup instead of silently reconnecting.
    if (member) {
      console.log(`[connection-details] Evicting for room="${livekitRoomName}" memberId=${member.id} newIdentity="${identity}"`);
      const evictedCount = await evictParticipantsByMemberId(livekitRoomName, member.id);
      console.log(`[connection-details] Evicted ${evictedCount} old session(s)`);
    }

    const participantToken = await createParticipantToken(
      {
        identity,
        name: participantName,
        metadata: tokenMetadata,
      },
      livekitRoomName,
    );

    const data: ConnectionDetails = {
      serverUrl: livekitServerUrl,
      roomName: livekitRoomName,
      participantToken: participantToken,
      participantName: participantName,
      meetingId: meeting.id,
      isPersonalRoom,
    };
    return new NextResponse(JSON.stringify(data), {
      headers,
    });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
  }
}

function createParticipantToken(userInfo: AccessTokenOptions, roomName: string) {
  const at = new AccessToken(API_KEY, API_SECRET, userInfo);
  at.ttl = '2h';
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);
  return at.toJwt();
}

function getCookieExpirationTime(): string {
  var now = new Date();
  var time = now.getTime();
  var expireTime = time + 60 * 120 * 1000;
  now.setTime(expireTime);
  return now.toUTCString();
}
