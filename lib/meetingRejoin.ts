import { prisma } from '@/lib/db';

/** LiveKit room empty — host may rejoin within grace period. */
export const MEETING_END_REASON = {
  ROOM_EMPTY: 'ROOM_EMPTY',
  HOST_ENDED: 'HOST_ENDED',
} as const;

export type MeetingEndReason =
  (typeof MEETING_END_REASON)[keyof typeof MEETING_END_REASON];

export type MeetingRejoinFields = {
  id: number;
  status: string;
  endedReason: string | null;
  rejoinableUntil: Date | null;
  createdByMemberId: number;
};

export function getRejoinGraceMinutes(): number {
  const raw = process.env.MEETING_REJOIN_GRACE_MINUTES;
  const parsed = raw ? parseInt(raw, 10) : 10;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

export function computeRejoinableUntil(from: Date = new Date()): Date {
  return new Date(from.getTime() + getRejoinGraceMinutes() * 60 * 1000);
}

export function isWithinRejoinGrace(rejoinableUntil: Date | null): boolean {
  if (!rejoinableUntil) return false;
  return rejoinableUntil.getTime() > Date.now();
}

export function canHostRejoinMeeting(
  meeting: MeetingRejoinFields,
  memberId: number | null | undefined,
): boolean {
  if (!memberId) return false;
  if (meeting.status !== 'ENDED') return false;
  if (meeting.endedReason !== MEETING_END_REASON.ROOM_EMPTY) return false;
  if (meeting.createdByMemberId !== memberId) return false;
  return isWithinRejoinGrace(meeting.rejoinableUntil);
}

export function withHostRejoinable<T extends MeetingRejoinFields>(
  meeting: T,
  memberId: number | null | undefined,
): T & { hostRejoinable: boolean } {
  return {
    ...meeting,
    hostRejoinable: canHostRejoinMeeting(meeting, memberId),
  };
}

export async function restoreMeetingForHostRejoin(meetingId: number) {
  return prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: 'ACTIVE',
      endedAt: null,
      endedReason: null,
      rejoinableUntil: null,
      actualDurationMinutes: null,
    },
  });
}
