import { prisma } from '@/lib/db';
import { archivePersonalRoomMeeting } from '@/lib/personalRoom';

/** LiveKit room empty — meeting enters IDLE until grace expires. */
export const MEETING_END_REASON = {
  ROOM_EMPTY: 'ROOM_EMPTY',
  HOST_ENDED: 'HOST_ENDED',
} as const;

export type MeetingEndReason =
  (typeof MEETING_END_REASON)[keyof typeof MEETING_END_REASON];

export const MEETING_STATUS = {
  ACTIVE: 'ACTIVE',
  IDLE: 'IDLE',
  ENDED: 'ENDED',
  CANCELED: 'CANCELED',
  PAST_DUE: 'PAST_DUE',
} as const;

export type MeetingLifecycleFields = {
  id: number;
  status: string;
  endedReason: string | null;
  rejoinableUntil: Date | null;
  roomEmptyAt?: Date | null;
  createdByMemberId: number;
  actualStartedAt?: Date | null;
  startedAt?: Date;
};

export function getIdleGraceMinutes(): number {
  const raw =
    process.env.MEETING_IDLE_GRACE_MINUTES ??
    process.env.MEETING_REJOIN_GRACE_MINUTES;
  const parsed = raw ? parseInt(raw, 10) : 120;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

export function computeRejoinableUntil(from: Date = new Date()): Date {
  return new Date(from.getTime() + getIdleGraceMinutes() * 60 * 1000);
}

export function isWithinIdleGrace(rejoinableUntil: Date | null): boolean {
  if (!rejoinableUntil) return false;
  return rejoinableUntil.getTime() > Date.now();
}

export function isMeetingPermanentlyClosed(status: string): boolean {
  return status === MEETING_STATUS.ENDED || status === MEETING_STATUS.CANCELED;
}

export function isMeetingJoinable(status: string): boolean {
  return !isMeetingPermanentlyClosed(status);
}

export function canResumeIdleMeeting(
  meeting: MeetingLifecycleFields,
  memberId: number | null | undefined,
): boolean {
  if (!memberId) return false;
  if (meeting.status !== MEETING_STATUS.IDLE) return false;
  if (meeting.endedReason !== MEETING_END_REASON.ROOM_EMPTY) return false;
  if (meeting.createdByMemberId !== memberId) return false;
  return isWithinIdleGrace(meeting.rejoinableUntil);
}

export function withMeetingLifecycleMeta<T extends MeetingLifecycleFields>(
  meeting: T,
  memberId: number | null | undefined,
): T & { hostRejoinable: boolean; isIdle: boolean } {
  return {
    ...meeting,
    isIdle: meeting.status === MEETING_STATUS.IDLE,
    hostRejoinable: canResumeIdleMeeting(meeting, memberId),
  };
}

function computeDurationMinutes(
  meeting: Pick<MeetingLifecycleFields, 'actualStartedAt' | 'startedAt'>,
  endedAt: Date,
): number {
  const start = meeting.actualStartedAt ?? meeting.startedAt ?? endedAt;
  const startMs =
    start instanceof Date ? start.getTime() : new Date(start).getTime();
  return Math.max(1, Math.round((endedAt.getTime() - startMs) / 60000));
}

/** IDLE past grace → ENDED (lazy, no cron). Returns updated row when transitioned. */
export async function expireIdleMeetingIfNeeded<
  T extends MeetingLifecycleFields,
>(meeting: T): Promise<T> {
  if (meeting.status !== MEETING_STATUS.IDLE) return meeting;
  if (isWithinIdleGrace(meeting.rejoinableUntil)) return meeting;

  const endedAt = meeting.roomEmptyAt ?? new Date();
  const updated = await prisma.meeting.update({
    where: { id: meeting.id },
    data: {
      status: MEETING_STATUS.ENDED,
      endedAt,
      endedReason: MEETING_END_REASON.ROOM_EMPTY,
      rejoinableUntil: null,
      actualDurationMinutes: computeDurationMinutes(meeting, endedAt),
    },
  });

  await archivePersonalRoomMeeting(updated);
  return { ...meeting, ...updated } as T;
}

/** Anyone joining within grace resumes an IDLE meeting. */
export async function resumeIdleMeeting(meetingId: number) {
  return prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: MEETING_STATUS.ACTIVE,
      roomEmptyAt: null,
      endedReason: null,
      rejoinableUntil: null,
      endedAt: null,
    },
  });
}

/** room_finished: ACTIVE/PAST_DUE → IDLE (not ENDED). */
export async function markMeetingIdleFromEmptyRoom(meetingId: number) {
  const emptyAt = new Date();
  return prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: MEETING_STATUS.IDLE,
      roomEmptyAt: emptyAt,
      endedReason: MEETING_END_REASON.ROOM_EMPTY,
      rejoinableUntil: computeRejoinableUntil(emptyAt),
      endedAt: null,
    },
  });
}

/** Before issuing a token: expire stale IDLE, then resume joinable IDLE. */
export async function prepareMeetingForJoin<
  T extends MeetingLifecycleFields,
>(meeting: T): Promise<T> {
  let current = await expireIdleMeetingIfNeeded(meeting);
  if (current.status === MEETING_STATUS.IDLE) {
    const resumed = await resumeIdleMeeting(current.id);
    current = { ...current, ...resumed } as T;
  }
  return current;
}
