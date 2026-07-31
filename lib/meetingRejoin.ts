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

/** 全员离开后，空会持续该分钟数则自动结束（可用 MEETING_IDLE_GRACE_MINUTES 覆盖）。 */
export const DEFAULT_IDLE_GRACE_MINUTES = 30;

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
  const parsed = raw ? parseInt(raw, 10) : DEFAULT_IDLE_GRACE_MINUTES;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_IDLE_GRACE_MINUTES;
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

const idleExpireTimers = new Map<number, ReturnType<typeof setTimeout>>();

function clearScheduledIdleMeetingExpire(meetingId: number) {
  const timer = idleExpireTimers.get(meetingId);
  if (!timer) return;
  clearTimeout(timer);
  idleExpireTimers.delete(meetingId);
}

/** 进程内定时：到点后把 IDLE 转为 ENDED（服务重启后依赖 cron / 懒过期兜底）。 */
function scheduleIdleMeetingExpire(meetingId: number, rejoinableUntil: Date) {
  clearScheduledIdleMeetingExpire(meetingId);
  const delayMs = Math.max(1000, rejoinableUntil.getTime() - Date.now() + 500);
  const timer = setTimeout(() => {
    idleExpireTimers.delete(meetingId);
    void (async () => {
      const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: {
          id: true,
          status: true,
          endedReason: true,
          rejoinableUntil: true,
          roomEmptyAt: true,
          createdByMemberId: true,
          actualStartedAt: true,
          startedAt: true,
        },
      });
      if (!meeting) return;
      await expireIdleMeetingIfNeeded(meeting);
    })().catch((err: unknown) => {
      console.error('[meetingRejoin] scheduled idle expire failed', err);
    });
  }, delayMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  idleExpireTimers.set(meetingId, timer);
}

/** IDLE past grace → ENDED. Returns updated row when transitioned. */
export async function expireIdleMeetingIfNeeded<
  T extends MeetingLifecycleFields,
>(meeting: T): Promise<T> {
  if (meeting.status !== MEETING_STATUS.IDLE) return meeting;
  if (isWithinIdleGrace(meeting.rejoinableUntil)) return meeting;

  clearScheduledIdleMeetingExpire(meeting.id);

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

/** 批量结束已过宽限期的空会（供 cron / webhook 兜底）。 */
export async function expireStaleIdleMeetings(): Promise<number> {
  const now = new Date();
  const stale = await prisma.meeting.findMany({
    where: {
      status: MEETING_STATUS.IDLE,
      OR: [{ rejoinableUntil: { lt: now } }, { rejoinableUntil: null }],
    },
    select: {
      id: true,
      status: true,
      endedReason: true,
      rejoinableUntil: true,
      roomEmptyAt: true,
      createdByMemberId: true,
      actualStartedAt: true,
      startedAt: true,
    },
  });

  let expired = 0;
  for (const meeting of stale) {
    const after = await expireIdleMeetingIfNeeded(meeting);
    if (after.status === MEETING_STATUS.ENDED) {
      expired += 1;
    }
  }
  return expired;
}

/** Anyone joining within grace resumes an IDLE meeting. */
export async function resumeIdleMeeting(meetingId: number) {
  clearScheduledIdleMeetingExpire(meetingId);
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
  const rejoinableUntil = computeRejoinableUntil(emptyAt);
  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: MEETING_STATUS.IDLE,
      roomEmptyAt: emptyAt,
      endedReason: MEETING_END_REASON.ROOM_EMPTY,
      rejoinableUntil,
      endedAt: null,
    },
  });
  scheduleIdleMeetingExpire(meetingId, rejoinableUntil);
  return updated;
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
