/**
 * Private per-member calendar subscription feed (webcal://…/api/calendar/feed/<token>.ics).
 *
 * Security model: the URL itself is the credential (like Google's "secret address in iCal
 * format"). Tokens are 256-bit random values, stored on TeamMember.calendarFeedToken, looked
 * up by exact match, revocable (reset = new token, off = null) and only ever grant read access
 * to the member's own scheduled meetings.
 */
import { randomBytes } from 'crypto';
import { buildCalendarDocument, buildMeetingEventLines, isCanceledStatus, type CalendarMeeting } from './ics';
import { meetingJoinUrl } from './links';

/** 32 random bytes → 43 base64url chars. */
export const FEED_TOKEN_BYTES = 32;
const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Past meetings stay visible for this long so they don't vanish right after they happen. */
export const FEED_LOOKBACK_DAYS = 30;
export const FEED_LOOKAHEAD_DAYS = 366;
export const FEED_MAX_EVENTS = 500;
export const FEED_REFRESH_MINUTES = 60;

export function generateCalendarFeedToken(): string {
  return randomBytes(FEED_TOKEN_BYTES).toString('base64url');
}

/** Route param "<token>.ics" (or bare token) → token, or null if malformed. */
export function parseFeedTokenParam(param: string | null | undefined): string | null {
  if (!param) return null;
  let value = param;
  try {
    value = decodeURIComponent(param);
  } catch {
    return null;
  }
  const token = value.replace(/\.ics$/i, '');
  return FEED_TOKEN_RE.test(token) ? token : null;
}

export function feedWindow(now: Date): { from: Date; to: Date } {
  const day = 24 * 60 * 60 * 1000;
  return {
    from: new Date(now.getTime() - FEED_LOOKBACK_DAYS * day),
    to: new Date(now.getTime() + FEED_LOOKAHEAD_DAYS * day),
  };
}

/**
 * Which meetings belong in the feed. A subscription is a full snapshot, so canceled meetings
 * are simply left out and calendar apps remove them on the next refresh.
 */
export function selectFeedMeetings(meetings: CalendarMeeting[], now: Date): CalendarMeeting[] {
  const { from, to } = feedWindow(now);
  return meetings
    .filter((m) => {
      if (isCanceledStatus(m.status)) return false;
      const start = new Date(m.scheduledFor).getTime();
      return !Number.isNaN(start) && start >= from.getTime() && start <= to.getTime();
    })
    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
    .slice(0, FEED_MAX_EVENTS);
}

export function buildCalendarFeedIcs(
  meetings: CalendarMeeting[],
  {
    origin,
    calendarName,
    now = new Date(),
  }: { origin: string; calendarName: string; now?: Date },
): string {
  const events = selectFeedMeetings(meetings, now).map((m) =>
    buildMeetingEventLines(m, { joinUrl: meetingJoinUrl(origin, m.roomName), now }),
  );
  return buildCalendarDocument(events, {
    method: 'PUBLISH',
    calendarName,
    refreshMinutes: FEED_REFRESH_MINUTES,
  });
}
