/** UI glue for "Add to calendar" menus and the Copy Invite text (browser + tests). */
import type { CalendarMeeting } from './ics';
import { buildCalendarLinks, type CalendarProvider } from './links';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface CalendarMenuItem {
  key: CalendarProvider;
  label: string;
  href: string;
  /** Set for the .ics item so the browser downloads instead of navigating. */
  download?: boolean;
}

interface MeetingLike {
  roomName?: string | null;
  title?: string | null;
  description?: string | null;
  scheduledFor?: string | Date | null;
  durationMinutes?: number | null;
  timezone?: string | null;
  status?: string | null;
  deletedAt?: string | Date | null;
  createdByMember?: { fullName?: string | null; username?: string | null } | null;
}

/** Only meetings with a start time that have not ended or been canceled can be added. */
export function isCalendarEligible(meeting: MeetingLike | null | undefined): boolean {
  if (!meeting?.roomName || !meeting.scheduledFor || meeting.deletedAt) return false;
  if (Number.isNaN(new Date(meeting.scheduledFor).getTime())) return false;
  const status = (meeting.status || '').toUpperCase();
  return status !== 'ENDED' && status !== 'FINISHED' && status !== 'CANCELED';
}

export function toCalendarMeetingFromClient(
  meeting: MeetingLike,
  overrides: Partial<CalendarMeeting> = {},
): CalendarMeeting {
  const host = meeting.createdByMember;
  return {
    roomName: meeting.roomName || '',
    title: meeting.title,
    description: meeting.description,
    scheduledFor: meeting.scheduledFor as string | Date,
    durationMinutes: meeting.durationMinutes,
    timezone: meeting.timezone,
    status: meeting.status,
    hostName: host ? host.fullName || host.username || null : null,
    ...overrides,
  };
}

export function calendarMenuItems(
  meeting: CalendarMeeting,
  origin: string,
  t: Translate,
): CalendarMenuItem[] {
  const links = buildCalendarLinks(meeting, origin);
  return [
    { key: 'google', label: t('calendar.google'), href: links.google },
    { key: 'outlook', label: t('calendar.outlook'), href: links.outlook },
    { key: 'office365', label: t('calendar.office365'), href: links.office365 },
    { key: 'ics', label: t('calendar.ics'), href: links.ics, download: true },
  ];
}

/** Lines appended to the Copy Invite text. */
export function inviteCalendarLines(meeting: CalendarMeeting, origin: string, t: Translate): string[] {
  const links = buildCalendarLinks(meeting, origin);
  return [
    t('calendar.inviteHeading'),
    `${t('calendar.google')}: ${links.google}`,
    `${t('calendar.inviteIcs')}: ${links.ics}`,
  ];
}
