/**
 * RFC 5545 iCalendar generation for Kloud Meet meetings.
 * Pure functions (no Node/DOM deps) so they run in route handlers, the browser and vitest.
 */

export const DEFAULT_MEETING_DURATION_MINUTES = 30;
export const REMINDER_MINUTES_BEFORE = 10;
const PRODID = '-//Kloud//Kloud Meet//EN';
const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;

/** The subset of a Meeting row (plus host display data) that goes into a calendar event. */
export interface CalendarMeeting {
  roomName: string;
  title?: string | null;
  description?: string | null;
  scheduledFor: Date | string;
  durationMinutes?: number | null;
  timezone?: string | null;
  status?: string | null;
  createdAt?: Date | string | null;
  modifiedAt?: Date | string | null;
  hostName?: string | null;
  /** Only set when the reader is allowed to see it (e.g. the host's own feed). */
  hostEmail?: string | null;
}

export interface CalendarEventOptions {
  /** Public join URL, e.g. https://meet.example.com/rooms/abc-123 */
  joinUrl: string;
  /** DTSTAMP; defaults to now. */
  now?: Date;
}

export interface CalendarDocumentOptions {
  method?: 'PUBLISH' | 'CANCEL';
  /** X-WR-CALNAME for subscription feeds. */
  calendarName?: string;
  /** Suggested refresh interval for subscription feeds, in minutes. */
  refreshMinutes?: number;
}

export function isCanceledStatus(status?: string | null): boolean {
  const s = (status || '').toUpperCase();
  return s === 'CANCELED' || s === 'CANCELLED';
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** 2026-10-23T09:05:00.000Z → 20261023T090500Z */
export function formatIcsUtc(value: Date | string): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date');
  return (
    `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Start/end instants of a meeting; duration falls back to 30 minutes. */
export function meetingTimes(meeting: Pick<CalendarMeeting, 'scheduledFor' | 'durationMinutes'>): {
  start: Date;
  end: Date;
} {
  const start = toDate(meeting.scheduledFor);
  if (Number.isNaN(start.getTime())) throw new Error('Meeting has no valid scheduledFor');
  const minutes =
    typeof meeting.durationMinutes === 'number' && meeting.durationMinutes > 0
      ? meeting.durationMinutes
      : DEFAULT_MEETING_DURATION_MINUTES;
  return { start, end: new Date(start.getTime() + minutes * 60_000) };
}

/** Escape a TEXT value (RFC 5545 §3.3.11). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Quote a parameter value (e.g. CN); DQUOTE is not allowed inside, control chars are dropped. */
function quoteParam(value: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/["\u0000-\u001f\u007f]/g, '').trim();
  return `"${clean}"`;
}

function utf8Length(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/**
 * Fold a content line so no physical line exceeds 75 octets (RFC 5545 §3.1).
 * Never splits a UTF-8 multi-byte character; continuation lines start with one space.
 */
export function foldIcsLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let octets = 0;
  let limit = MAX_LINE_OCTETS;
  for (const ch of line) {
    const len = utf8Length(ch);
    if (octets + len > limit) {
      out.push(current);
      current = ' ';
      octets = 1;
      limit = MAX_LINE_OCTETS;
    }
    current += ch;
    octets += len;
  }
  out.push(current);
  return out.join(CRLF);
}

/** Human-readable body shared by the .ics DESCRIPTION and the add-to-calendar links. */
export function buildMeetingDetails(meeting: CalendarMeeting, joinUrl: string): string {
  const lines = [`Join Kloud Meet: ${joinUrl}`, `Meeting ID: ${meeting.roomName}`];
  if (meeting.hostName) lines.push(`Host: ${meeting.hostName}`);
  const description = (meeting.description || '').trim();
  if (description) lines.push('', description);
  return lines.join('\n');
}

export function meetingTitle(meeting: Pick<CalendarMeeting, 'title' | 'roomName'>): string {
  return (meeting.title || '').trim() || 'Kloud Meet meeting';
}

export function meetingUid(roomName: string): string {
  return `meeting-${roomName}@kloudmeet`;
}

/**
 * SEQUENCE must grow every time the organizer changes the event. Derived from modifiedAt
 * (seconds since creation, so it stays well inside a 32-bit int).
 */
export function meetingSequence(meeting: Pick<CalendarMeeting, 'createdAt' | 'modifiedAt'>): number {
  if (!meeting.modifiedAt) return 0;
  const modified = toDate(meeting.modifiedAt).getTime();
  if (Number.isNaN(modified)) return 0;
  const created = meeting.createdAt ? toDate(meeting.createdAt).getTime() : NaN;
  const base = Number.isNaN(created) ? 0 : created;
  return Math.max(0, Math.floor((modified - base) / 1000));
}

/** VEVENT content lines (unfolded) for one meeting. */
export function buildMeetingEventLines(
  meeting: CalendarMeeting,
  options: CalendarEventOptions,
): string[] {
  const { start, end } = meetingTimes(meeting);
  const canceled = isCanceledStatus(meeting.status);
  const title = meetingTitle(meeting);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${meetingUid(meeting.roomName)}`,
    `DTSTAMP:${formatIcsUtc(options.now ?? new Date())}`,
    `DTSTART:${formatIcsUtc(start)}`,
    `DTEND:${formatIcsUtc(end)}`,
    `SEQUENCE:${meetingSequence(meeting)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(buildMeetingDetails(meeting, options.joinUrl))}`,
    `LOCATION:${escapeIcsText(options.joinUrl)}`,
    `URL:${options.joinUrl}`,
  ];
  if (meeting.createdAt) lines.push(`CREATED:${formatIcsUtc(meeting.createdAt)}`);
  if (meeting.modifiedAt) lines.push(`LAST-MODIFIED:${formatIcsUtc(meeting.modifiedAt)}`);
  if (meeting.hostEmail) {
    const cn = meeting.hostName ? `;CN=${quoteParam(meeting.hostName)}` : '';
    lines.push(`ORGANIZER${cn}:mailto:${meeting.hostEmail.trim()}`);
  }
  lines.push(`STATUS:${canceled ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push('TRANSP:OPAQUE');
  if (!canceled) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(title)}`,
      `TRIGGER:-PT${REMINDER_MINUTES_BEFORE}M`,
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT');
  return lines;
}

/** Wrap VEVENT line groups in a VCALENDAR, fold every line and join with CRLF. */
export function buildCalendarDocument(
  events: string[][],
  options: CalendarDocumentOptions = {},
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    `METHOD:${options.method ?? 'PUBLISH'}`,
  ];
  if (options.calendarName) lines.push(`X-WR-CALNAME:${escapeIcsText(options.calendarName)}`);
  if (options.refreshMinutes) {
    lines.push(
      `REFRESH-INTERVAL;VALUE=DURATION:PT${options.refreshMinutes}M`,
      `X-PUBLISHED-TTL:PT${options.refreshMinutes}M`,
    );
  }
  for (const event of events) lines.push(...event);
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

/** A single-meeting .ics: METHOD:CANCEL + STATUS:CANCELLED when the meeting was canceled. */
export function buildMeetingIcs(meeting: CalendarMeeting, options: CalendarEventOptions): string {
  return buildCalendarDocument([buildMeetingEventLines(meeting, options)], {
    method: isCanceledStatus(meeting.status) ? 'CANCEL' : 'PUBLISH',
  });
}

/** Safe `Content-Disposition` for `<title>.ics`, with an RFC 5987 UTF-8 variant. */
export function icsContentDisposition(title: string): string {
  const base =
    title
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'meeting';
  const ascii = base.replace(/[^\x20-\x7e]/g, '_').replace(/[%;]/g, '_');
  const encoded = encodeURIComponent(`${base}.ics`).replace(/['()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}.ics"; filename*=UTF-8''${encoded}`;
}
