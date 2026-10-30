import { prisma } from '@/lib/db';

/**
 * Design links (Figma) in a meeting follow its host's setting (My Profile → Meeting settings),
 * off by default. The host is the meeting's creator, whose plan and settings run the meeting.
 */
export async function meetingDesignLinksEnabled(where: { id: number } | { roomName: string }): Promise<boolean> {
  const meeting = await prisma.meeting.findUnique({
    where,
    select: { createdByMember: { select: { designLinksEnabled: true } } },
  });
  return meeting?.createdByMember.designLinksEnabled === true;
}
