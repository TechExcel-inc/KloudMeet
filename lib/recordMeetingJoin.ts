import { prisma } from '@/lib/db';

const NAME_MAX = 191;

interface RecordMeetingJoinInput {
  /** Meeting.id */
  meetingId: number;
  /** 登录成员 TeamMember.id */
  memberId: number;
  /** 入会时使用的显示名 */
  displayName: string;
  /** 是否为这场会的创建者 */
  host: boolean;
}

/**
 * recordMeetingJoin — 登录用户拿到入会令牌后记下参会关系。
 * 同一成员对同一会议只保留一条，供会议列表查出「我参加过的会」。
 */
export async function recordMeetingJoin(input: RecordMeetingJoinInput): Promise<void> {
  const existing = await prisma.meetingParticipant.findFirst({
    where: { meetingId: input.meetingId, teamMemberId: input.memberId },
    select: { id: true },
  });
  if (existing) return;

  const name = input.displayName.trim().slice(0, NAME_MAX) || 'Participant';
  await prisma.meetingParticipant.create({
    data: {
      meetingId: input.meetingId,
      teamMemberId: input.memberId,
      displayName: name,
      roles: input.host ? 'HOST' : 'PARTICIPANT',
    },
  });
}
