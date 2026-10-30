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
import { followOwnerLiveRoom, otherLiveMeetingOfHost } from '@/lib/oneMeetingPerHost';
import { readMeetingRoomFlags, setParticipantLiveDocAi } from '@/lib/meetingRoomView';
import { meetingDesignLinksEnabled } from '@/lib/designLinksSetting.server';
import { prisma } from '@/lib/db';
import { createLiveKitParticipantToken } from '@/lib/livekitParticipantToken';
import { joinBlockCode, parseAccessLevel } from '@/lib/meetingAccess';
import { INVITE_PARAM, evaluateJoin, meetingAccessSelect, meetingHasStarted } from '@/lib/meetingAccess.server';
import { SPEAK_TOKEN_PARAM } from '@/lib/recordingSpeakActivity';
import { recordGuestJoin, recordMeetingJoin } from '@/lib/recordMeetingJoin';
import { RECORDER_PARTICIPANT_METADATA } from '@/lib/recorderParticipant';
import { isBillingEnabled, resolveEntitlements } from '@/lib/billing/entitlements';
import {
  endMeetingForTimeLimit,
  meetingEndsAtFor,
  participantCapReached,
} from '@/lib/billing/limits';
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

    let livekitRoomName = await resolveCanonicalRoomName(roomName);
    // One host, one meeting: a personal ID reaches the meeting its owner is hosting
    // now (e.g. m5888 → their instant meeting), never a second room of its own.
    const ownerLiveRoom = await followOwnerLiveRoom(livekitRoomName);
    if (ownerLiveRoom) {
      console.log(`[connection-details] Personal ID "${livekitRoomName}" follows its owner into "${ownerLiveRoom}"`);
      livekitRoomName = ownerLiveRoom;
    }

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

    // One host, one meeting: starting another while hosting a live one asks first
    // (the room page shows the same choice as the home page).
    if (member && member.id === meeting.createdByMemberId) {
      const activeMeeting = await otherLiveMeetingOfHost(member.id, livekitRoomName);
      if (activeMeeting) {
        return NextResponse.json({ code: 'HOST_ALREADY_IN_MEETING', activeMeeting }, { status: 409 });
      }
    }

    // Waiting for the host: until the creator has joined this meeting (and again once everyone has
    // left) others stay on the pre-join page, which lets them in as soon as it starts.
    const joinerIsCreator = Boolean(member && member.id === meeting.createdByMemberId);
    if (!joinerIsCreator && !(await meetingHasStarted(meeting))) {
      return NextResponse.json(
        { code: 'NOT_STARTED', error: 'The host hasn’t started this meeting yet' },
        { status: 403 },
      );
    }

    meeting = await prepareMeetingForJoin(meeting);

    if (isMeetingPermanentlyClosed(meeting.status) && !isPersonalRoom) {
      return new NextResponse('Meeting has already ended', { status: 403 });
    }

    // Access level (lib/meetingAccess.ts). The host sets it from the pre-join dropdown when
    // starting; everyone else is checked against it before getting a token.
    const isCreator = Boolean(member && member.id === meeting.createdByMemberId);
    const requestedLevel = parseAccessLevel(request.nextUrl.searchParams.get('accessLevel'));
    let accessMeeting = await prisma.meeting.findUnique({
      where: { id: meeting.id },
      select: meetingAccessSelect,
    });
    if (!accessMeeting) {
      return new NextResponse('Meeting not found', { status: 404 });
    }
    // Private needs a company to invite from; the dropdown disables it without one.
    if (isCreator && requestedLevel && (requestedLevel !== 'PRIVATE' || accessMeeting.accountId)) {
      accessMeeting = await prisma.meeting.update({
        where: { id: meeting.id },
        data: { accessLevel: requestedLevel },
        select: meetingAccessSelect,
      });
    }
    const { decision, facts } = await evaluateJoin({
      meeting: accessMeeting,
      member,
      inviteToken: request.nextUrl.searchParams.get(INVITE_PARAM),
      recorderToken: request.nextUrl.searchParams.get(SPEAK_TOKEN_PARAM),
    });
    // The recording bot: marked in its token so the meeting doesn't show it as a person.
    const isRecorder = facts.isRecorder;
    const blocked = joinBlockCode(decision);
    if (blocked) {
      // 403, not 401: the client treats 401 as an expired session and signs the person out.
      return NextResponse.json(
        { code: blocked, error: 'You need the host’s permission to join this meeting' },
        { status: 403 },
      );
    }

    // Billing (skipped entirely when BILLING_ENABLED is off): the host's plan sets the
    // meeting length and participant cap. Past the length limit the room is ended and
    // new joins are refused.
    const hostEntitlements = isBillingEnabled()
      ? await resolveEntitlements(meeting.createdByMemberId)
      : null;
    let meetingEndsAt: Date | null = null;
    if (hostEntitlements) {
      meetingEndsAt = await meetingEndsAtFor(hostEntitlements, meeting);
      if (meetingEndsAt && meetingEndsAt.getTime() <= Date.now()) {
        await endMeetingForTimeLimit(meeting);
        return new NextResponse('This meeting reached the time limit of the host’s plan', { status: 403 });
      }
    }

    let identity: string;
    // Metadata is server-authored only: member id for logged-in users, the recorder mark for the
    // recording bot, empty for other guests.
    let tokenMetadata = '';
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
      // `guest_` prefix: guest identities can never parse as `km_{memberId}`.
      const guestName = participantName.slice(0, 64);
      identity = guestDeviceId
        ? `guest_${guestName}__${randomParticipantPostfix}_${guestDeviceId}`
        : `guest_${guestName}__${randomParticipantPostfix}`;
      headers['Set-Cookie'] = `${COOKIE_KEY}=${randomParticipantPostfix}; Path=/; HttpOnly; SameSite=Strict; Secure; Expires=${getCookieExpirationTime()}`;
      if (isRecorder) tokenMetadata = RECORDER_PARTICIPANT_METADATA;
    }

    if (
      hostEntitlements &&
      !isRecorder &&
      (await participantCapReached({
        hostEntitlements,
        roomName: livekitRoomName,
        joinerIdentity: identity,
        joinerMemberId: member?.id ?? null,
        hostMemberId: meeting.createdByMemberId,
      }))
    ) {
      return new NextResponse('This meeting is full', { status: 403 });
    }

    // Kick other devices/tabs for this member before minting. Same identity
    // (page refresh / renew) is skipped — LiveKit replaces on join; removing
    // it would set a Cloud revoke cutoff that breaks subsequent tickets.
    if (member) {
      console.log(`[connection-details] Evicting for room="${livekitRoomName}" memberId=${member.id} newIdentity="${identity}"`);
      const evictedCount = await evictParticipantsByMemberId(
        livekitRoomName,
        member.id,
        identity,
      );
      console.log(`[connection-details] Evicted ${evictedCount} old session(s)`);
    }

    if (!API_KEY || !API_SECRET) {
      throw new Error('LiveKit API key/secret is not configured');
    }
    const participantToken = await createLiveKitParticipantToken({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      identity,
      name: participantName,
      metadata: tokenMetadata,
      roomName: livekitRoomName,
      ttl: '2h',
    });

    // 参会记录本应由 LiveKit participant_joined webhook 写入（拿到票但没真正入会不算参会），
    // 但生产环境收不到 LiveKit webhook（见 a7ada47），所以拿票时先记一笔兜底；
    // webhook 通了以后由它负责在场时间窗（joinedAt / leftAt）。
    try {
      if (member) {
        await recordMeetingJoin({
          meetingId: meeting.id,
          memberId: member.id,
          displayName: participantName.trim() || member.fullName || member.username,
          host: member.id === meeting.createdByMemberId,
        });
      } else if (!isRecorder) {
        await recordGuestJoin({
          meetingId: meeting.id,
          displayName: participantName,
        });
      }
    } catch (err) {
      console.error('[connection-details] record join', err);
    }

    // Late joiners: adopt room's current stage without flashing default webcam.
    // First host open: room has no metadata → currentView omitted → client keeps webcam.
    const roomFlags = await readMeetingRoomFlags(livekitRoomName);
    const currentView = roomFlags.currentView;
    const liveDocParam = request.nextUrl.searchParams.get('participantLiveDocAi');
    const requestedLiveDoc = liveDocParam === '0' ? false : liveDocParam === '1' ? true : null;
    let participantLiveDocAi = roomFlags.participantLiveDocAi;
    if (
      requestedLiveDoc !== null &&
      member &&
      member.id === meeting.createdByMemberId
    ) {
      await setParticipantLiveDocAi(livekitRoomName, requestedLiveDoc);
      participantLiveDocAi = requestedLiveDoc;
    }
    const livedocBind = await prisma.meeting.findUnique({
      where: { id: meeting.id },
      select: { kloudMeetingId: true },
    });
    const livedocInstanceId =
      livedocBind?.kloudMeetingId != null && livedocBind.kloudMeetingId > 0
        ? String(livedocBind.kloudMeetingId)
        : null;

    const data: ConnectionDetails = {
      serverUrl: livekitServerUrl,
      roomName: livekitRoomName,
      participantToken: participantToken,
      participantName: participantName,
      meetingId: meeting.id,
      isPersonalRoom,
      ...(currentView ? { currentView } : {}),
      ...(roomFlags.designLink ? { designLink: roomFlags.designLink } : {}),
      designLinksEnabled: await meetingDesignLinksEnabled({ id: meeting.id }),
      participantLiveDocAi,
      livedocInstanceId,
      accessLevel: parseAccessLevel(accessMeeting.accessLevel),
      ...(meetingEndsAt ? { meetingEndsAt: meetingEndsAt.toISOString() } : {}),
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

function getCookieExpirationTime(): string {
  var now = new Date();
  var time = now.getTime();
  var expireTime = time + 60 * 120 * 1000;
  now.setTime(expireTime);
  return now.toUTCString();
}
