import { prisma } from '@/lib/db';
import { createReplaySpokenNames } from '@/lib/replaySpokenNames';

export async function loadReplaySpokenNames(meetingId: number, language: string) {
  const attendees = await prisma.meetingParticipant.findMany({
    where: { meetingId },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, displayName: true,
      teamMember: { select: { id: true, username: true, fullName: true } },
    },
  });
  return createReplaySpokenNames(attendees, language);
}
