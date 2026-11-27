import { NextRequest } from 'next/server';
import { TokenVerifier } from 'livekit-server-sdk';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { findMeetingByRoomName } from '@/lib/meetingRoomIsActive';
import { getRoomServiceClient, listRoomParticipants } from '@/lib/livekitRooms';
import {
  parseKloudMemberIdFromIdentity,
  parseKloudMemberIdFromMetadata,
} from '@/lib/meetingOwner';
import { resolveCanonicalRoomName } from '@/lib/personalRoom';
import { recordMeetingJoin } from '@/lib/recordMeetingJoin';
import { isRecorderParticipant } from '@/lib/recorderParticipant';
import { ROOM_TOKEN_HEADER } from '@/lib/roomAuth';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

/**
 * readRoomParticipant — 用参会 token 确认调用者就是这个 LiveKit 身份，不能改别人。
 */
async function readRoomParticipant(
  request: NextRequest,
): Promise<{ identity: string; room: string } | null> {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const token = request.headers.get(ROOM_TOKEN_HEADER)?.trim() ?? '';
  if (!key || !secret || !token) return null;
  try {
    const claims = await new TokenVerifier(key, secret).verify(token);
    const room = claims.video?.room;
    if (typeof claims.sub !== 'string' || !claims.sub || !room || claims.video?.roomJoin !== true) {
      return null;
    }
    return { identity: claims.sub, room };
  } catch (err) {
    console.error('[POST /api/meetings/account] token', err);
    return null;
  }
}

function readMetadata(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* 不是 JSON 就换成成员身份 */
  }
  return {};
}

/** POST — 会议中登录后，把当前参会者的姓名和成员身份写进这场会，不重新进会。 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
) {
  return runWithLocale(request, async () => {
    try {
      const member = await requireSession(request);
      if (isAuthError(member)) return member;

      const { roomName: raw } = await params;
      const asked = await resolveCanonicalRoomName(raw ?? '');
      if (!asked) return apiJson({ error: 'Room name not provided' }, { status: 400 });

      const participant = await readRoomParticipant(request);
      if (!participant) return apiJson({ error: 'Not in this meeting' }, { status: 401 });
      const liveRoom = participant.room;
      const sameRoom =
        liveRoom.toLowerCase() === asked.toLowerCase() ||
        liveRoom.toLowerCase() === (raw ?? '').trim().toLowerCase();
      if (!sameRoom) return apiJson({ error: 'Not in this meeting' }, { status: 403 });

      const people = await listRoomParticipants(liveRoom);
      if (!people) return apiJson({ error: 'Could not reach the meeting' }, { status: 503 });
      const mine = people.find((person) => person.identity === participant.identity);
      if (!mine || isRecorderParticipant(mine)) {
        return apiJson({ error: 'Not in this meeting' }, { status: 403 });
      }

      const bound =
        parseKloudMemberIdFromMetadata(mine.metadata) ??
        (parseKloudMemberIdFromIdentity(mine.identity) != null
          ? String(parseKloudMemberIdFromIdentity(mine.identity))
          : null);
      if (bound && bound !== String(member.id)) {
        return apiJson({ error: 'Already signed in as someone else' }, { status: 403 });
      }

      const displayName = (member.fullName || member.username || 'Participant').trim().slice(0, 64);
      const client = getRoomServiceClient();
      if (!client) return apiJson({ error: 'Meeting service is unavailable' }, { status: 503 });
      const meta = readMetadata(mine.metadata);
      meta.kloudMemberId = member.id;
      await client.updateParticipant(liveRoom, mine.identity, {
        name: displayName,
        metadata: JSON.stringify(meta),
      });

      const meeting =
        (await findMeetingByRoomName(liveRoom)) ??
        (await findMeetingByRoomName(asked));
      const isHost = Boolean(meeting && String(member.id) === String(meeting.createdByMemberId));
      if (meeting) {
        await recordMeetingJoin({
          meetingId: meeting.id,
          memberId: member.id,
          displayName,
          host: isHost,
        });
      }

      return apiJson({
        displayName,
        memberId: member.id,
        isHost,
        createdByMemberId: meeting?.createdByMemberId ?? null,
        title: meeting?.title ?? null,
      });
    } catch (err) {
      console.error('[POST /api/meetings/account]', err);
      return apiJson({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
