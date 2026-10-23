/**
 * "Add to calendar" links for a scheduled meeting: Google Calendar, Outlook.com, Office 365
 * and the .ics download (Apple Calendar / any iCalendar client). Pure functions.
 */
import {
  buildMeetingDetails,
  meetingTimes,
  meetingTitle,
  formatIcsUtc,
  type CalendarMeeting,
} from './ics';

export type CalendarProvider = 'google' | 'outlook' | 'office365' | 'ics';

export interface CalendarLinks {
  google: string;
  outlook: string;
  office365: string;
  ics: string;
}

/** Keep generated URLs comfortably below common URL length limits (~2k). */
const MAX_DETAILS_CHARS = 1000;

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, '');
}

export function meetingJoinUrl(origin: string, roomName: string): string {
  return `${trimOrigin(origin)}/rooms/${encodeURIComponent(roomName)}`;
}

export function meetingIcsUrl(origin: string, roomName: string): string {
  return `${trimOrigin(origin)}/api/meetings/${encodeURIComponent(roomName)}/calendar.ics`;
}

/** Query string with %20 for spaces (Outlook shows "+" literally). */
function query(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join('&');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 2026-10-23T09:05:00Z (Outlook deeplinks want ISO 8601 without milliseconds). */
function isoNoMillis(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function googleCalendarUrl(meeting: CalendarMeeting, joinUrl: string): string {
  const { start, end } = meetingTimes(meeting);
  return `https://calendar.google.com/calendar/render?${query({
    action: 'TEMPLATE',
    text: meetingTitle(meeting),
    dates: `${formatIcsUtc(start)}/${formatIcsUtc(end)}`,
    details: truncate(buildMeetingDetails(meeting, joinUrl), MAX_DETAILS_CHARS),
    location: joinUrl,
    ctz: meeting.timezone || undefined,
  })}`;
}

function outlookComposeUrl(host: string, meeting: CalendarMeeting, joinUrl: string): string {
  const { start, end } = meetingTimes(meeting);
  return `https://${host}/calendar/0/deeplink/compose?${query({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: meetingTitle(meeting),
    startdt: isoNoMillis(start),
    enddt: isoNoMillis(end),
    body: truncate(buildMeetingDetails(meeting, joinUrl), MAX_DETAILS_CHARS),
    location: joinUrl,
  })}`;
}

/** Outlook.com (personal Microsoft accounts). */
export function outlookCalendarUrl(meeting: CalendarMeeting, joinUrl: string): string {
  return outlookComposeUrl('outlook.live.com', meeting, joinUrl);
}

/** Outlook on the web for Microsoft 365 work/school accounts. */
export function office365CalendarUrl(meeting: CalendarMeeting, joinUrl: string): string {
  return outlookComposeUrl('outlook.office.com', meeting, joinUrl);
}

/** All links for a meeting, built against the site origin (e.g. window.location.origin). */
export function buildCalendarLinks(meeting: CalendarMeeting, origin: string): CalendarLinks {
  const joinUrl = meetingJoinUrl(origin, meeting.roomName);
  return {
    google: googleCalendarUrl(meeting, joinUrl),
    outlook: outlookCalendarUrl(meeting, joinUrl),
    office365: office365CalendarUrl(meeting, joinUrl),
    ics: meetingIcsUrl(origin, meeting.roomName),
  };
}

/** Subscription URLs for a private calendar feed token. */
export function calendarFeedUrls(origin: string, token: string): {
  https: string;
  webcal: string;
  google: string;
} {
  const https = `${trimOrigin(origin)}/api/calendar/feed/${encodeURIComponent(token)}.ics`;
  const webcal = https.replace(/^https?:\/\//i, 'webcal://');
  return {
    https,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
  };
}
