import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import {
  canManageMeeting,
  forbidden,
  isAuthError,
  requireSession,
} from '@/lib/apiAuth';
import { deleteLiveKitRoom } from '@/lib/livekitRooms';
import {
  archivePersonalRoomMeeting,
  findPersonalRoomOwner,
} from '@/lib/personalRoom';
import { MEETING_END_REASON, MEETING_STATUS } from '@/lib/meetingRejoin';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
) {
  return runWithLocale(request, async () => {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;

    const resolvedParams = await params;
    const roomName = resolvedParams?.roomName;
    if (!roomName) {
      return apiJson({ error: 'Room name not provided' }, { status: 400 });
    }

    let meeting = await prisma.meeting.findUnique({ where: { roomName } });
    if (!meeting) {
      const owner = await findPersonalRoomOwner(roomName);
      if (!owner || !canManageMeeting(member.id, { createdByMemberId: owner.id })) {
        return apiJson({ error: 'Meeting not found' }, { status: 404 });
      }
      await deleteLiveKitRoom(roomName);
      return apiJson({
        success: true,
        meeting: { roomName, status: 'ENDED', isPersonalRoom: true },
      });
    }
    if (!canManageMeeting(member.id, meeting)) {
      return forbidden('Only the meeting host can end this meeting');
    }

    if (meeting.status === MEETING_STATUS.ENDED) {
      await deleteLiveKitRoom(roomName);
      await archivePersonalRoomMeeting(meeting);
      const archived = await prisma.meeting.findUnique({ where: { id: meeting.id } });
      return apiJson({ success: true, meeting: archived ?? meeting });
    }

    const endedAt = new Date();
    const startMs = (
      meeting.actualStartedAt ||
      meeting.startedAt
    ).getTime();
    const actualDurationMinutes = Math.max(
      1,
      Math.round((endedAt.getTime() - startMs) / 60000),
    );

    await deleteLiveKitRoom(roomName);

    const updated = await prisma.meeting.update({
      where: { roomName },
      data: {
        status: MEETING_STATUS.ENDED,
        endedAt,
        endedReason: MEETING_END_REASON.HOST_ENDED,
        rejoinableUntil: null,
        roomEmptyAt: null,
        actualDurationMinutes: meeting.actualDurationMinutes ?? actualDurationMinutes,
      },
    });

    await archivePersonalRoomMeeting(updated);

    const finalMeeting = await prisma.meeting.findUnique({
      where: { id: updated.id },
    });

    return apiJson({ success: true, meeting: finalMeeting ?? updated });
  } catch (error) {
    console.error('[meetings end POST]', error);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
