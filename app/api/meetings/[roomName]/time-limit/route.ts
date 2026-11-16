/**
 * POST /api/meetings/[roomName]/time-limit
 *
 * Called by meeting clients when the host plan's meeting length runs out (Free: 40 min).
 * The server re-checks the elapsed time itself and only then ends the LiveKit room,
 * so any participant may call it and an early call is a harmless no-op.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveCanonicalRoomName } from '@/lib/personalRoom';
import { MEETING_STATUS } from '@/lib/meetingRejoin';
import { isBillingEnabled } from '@/lib/billing/entitlements';
import { endMeetingForTimeLimit, meetingEndsAt } from '@/lib/billing/limits';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

/** Client clocks drift; accept a call this many ms before the deadline. */
const CLOCK_SKEW_MS = 5_000;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
) {
  return runWithLocale(_request, async () => {
  try {
    if (!isBillingEnabled()) {
      return apiJson({ error: 'Billing is not enabled' }, { status: 404 });
    }
    const { roomName } = await params;
    if (!roomName) {
      return apiJson({ error: 'Room name not provided' }, { status: 400 });
    }
    const canonical = await resolveCanonicalRoomName(roomName);
    const meeting = await prisma.meeting.findUnique({
      where: { roomName: canonical },
      select: { id: true, roomName: true, status: true, createdByMemberId: true, actualStartedAt: true },
    });
    if (!meeting) {
      return apiJson({ error: 'Meeting not found' }, { status: 404 });
    }
    if (meeting.status === MEETING_STATUS.ENDED || meeting.status === MEETING_STATUS.CANCELED) {
      return apiJson({ ended: true });
    }

    const endsAt = await meetingEndsAt(meeting);
    if (!endsAt) {
      return apiJson({ ended: false, reason: 'no_limit' }, { status: 409 });
    }
    if (Date.now() + CLOCK_SKEW_MS < endsAt.getTime()) {
      return apiJson(
        { ended: false, reason: 'not_yet', meetingEndsAt: endsAt.toISOString() },
        { status: 409 },
      );
    }

    await endMeetingForTimeLimit(meeting);
    return apiJson({ ended: true, meetingEndsAt: endsAt.toISOString() });
  } catch (error) {
    console.error('[meetings time-limit POST]', error);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
