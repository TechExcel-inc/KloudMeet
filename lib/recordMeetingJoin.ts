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

interface RecordGuestJoinInput {
  /** Meeting.id */
  meetingId: number;
  /** 入会时填写的显示名 */
  displayName: string;
}

function personName(displayName: string): string {
  return displayName.trim().slice(0, NAME_MAX) || 'Participant';
}

/**
 * recordMeetingJoin — 登录用户拿到入会令牌后记下参会关系。
 * 同一成员对同一会议只保留一条，供会议列表查出「我参加过的会」。
 * 若已有同名匿名记录，则挂上成员，避免人数重复。
 */
export async function recordMeetingJoin(input: RecordMeetingJoinInput): Promise<void> {
  const existing = await prisma.meetingParticipant.findFirst({
    where: { meetingId: input.meetingId, teamMemberId: input.memberId },
    select: { id: true },
  });
  if (existing) return;

  const name = personName(input.displayName);
  const guest = await prisma.meetingParticipant.findFirst({
    where: { meetingId: input.meetingId, displayName: name, teamMemberId: null },
    select: { id: true },
  });
  if (guest) {
    await prisma.meetingParticipant.update({
      where: { id: guest.id },
      data: {
        teamMemberId: input.memberId,
        displayName: name,
        ...(input.host ? { roles: 'HOST' } : {}),
      },
    });
    return;
  }

  await prisma.meetingParticipant.create({
    data: {
      meetingId: input.meetingId,
      teamMemberId: input.memberId,
      displayName: name,
      roles: input.host ? 'HOST' : 'PARTICIPANT',
    },
  });
}

/**
 * recordGuestJoin — 匿名用户按显示名记一条参会记录。
 * 只和已有的匿名记录比名字；登录用户同名时仍另记一条。
 */
export async function recordGuestJoin(input: RecordGuestJoinInput): Promise<void> {
  const name = personName(input.displayName);
  const existing = await prisma.meetingParticipant.findFirst({
    where: { meetingId: input.meetingId, displayName: name, teamMemberId: null },
    select: { id: true },
  });
  if (existing) return;

  await prisma.meetingParticipant.create({
    data: {
      meetingId: input.meetingId,
      displayName: name,
      roles: 'PARTICIPANT',
    },
  });
}
