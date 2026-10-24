/**
 * Schedule dialog → attendees, invitation and reminder emails. Pure helpers and the email
 * templates; lib/meetingInvites.server.ts does the database work and sending.
 */
import { buildCalendarLinks, meetingJoinUrl } from './calendar/links';
import type { CalendarMeeting } from './calendar/ics';

/** Reminders when the host hasn't set any: 1 day and 8 hours before (as the dialog shows). */
export const DEFAULT_REMINDER_OFFSETS = [1440, 480];
/** Longest reminder lead time accepted: 30 days. */
export const MAX_REMINDER_MINUTES = 30 * 24 * 60;
export const MAX_INVITEES = 100;

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 191 && EMAIL_RE.test(value);
}

/** Trimmed, lower-cased, valid and unique addresses, at most MAX_INVITEES. */
export function normalizeEmails(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const email = raw.trim().toLowerCase();
    if (!isValidEmail(email) || out.includes(email)) continue;
    out.push(email);
    if (out.length >= MAX_INVITEES) break;
  }
  return out;
}

/** Reminder lead times in minutes: positive, at most 30 days, unique, longest first. */
export function parseReminderOffsets(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_REMINDER_OFFSETS];
  const set = new Set<number>();
  for (const v of raw) {
    const n = typeof v === 'number' ? Math.round(v) : NaN;
    if (Number.isFinite(n) && n > 0 && n <= MAX_REMINDER_MINUTES) set.add(n);
  }
  return [...set].sort((a, b) => b - a);
}

/**
 * Which reminders are due now: the send time (start − offset) has passed, the meeting hasn't
 * started, and that reminder wasn't sent for this start time yet. A reminder whose send time
 * had already passed when the meeting was scheduled (e.g. "8 hours before" for a meeting in
 * 3 hours) is skipped: the invitation just went out, and its "starts in 8 hours" would be wrong.
 */
export function dueReminderOffsets(opts: {
  now: Date;
  scheduledFor: Date;
  createdAt: Date;
  offsets: number[];
  sent: number[];
}): number[] {
  const start = opts.scheduledFor.getTime();
  const now = opts.now.getTime();
  if (now >= start) return [];
  const scheduledAt = opts.createdAt.getTime();
  const pending = opts.offsets.filter((o) => {
    const sendAt = start - o * 60000;
    return !opts.sent.includes(o) && now >= sendAt && sendAt >= scheduledAt;
  });
  if (pending.length === 0) return [];
  // Only the closest-to-start reminder that is due: never several reminders in one go.
  return [Math.min(...pending)];
}

/** "1 day", "8 hours", "30 minutes" */
export function formatLeadTime(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Start time in the meeting's time zone, e.g. "Saturday, October 24, 2026 at 8:00 PM (GMT+8) Asia/Shanghai". */
export function formatMeetingWhen(scheduledFor: Date, timezone?: string | null): string {
  const zone = timezone || 'UTC';
  try {
    const when = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: zone,
    }).format(scheduledFor);
    return `${when} (${zone})`;
  } catch {
    return scheduledFor.toUTCString();
  }
}

export type InviteKind = 'new' | 'updated';

interface MeetingForEmail extends CalendarMeeting {
  scheduledFor: Date;
}

function layout(heading: string, intro: string, rows: Array<[string, string]>, joinUrl: string, footer: string, extraHtml = '') {
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:4px 0;color:#111827;font-size:14px">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  return `
    <div style="font-family: 'Plus Jakarta Sans', Inter, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px;">
      <h2 style="color:#111827;margin:0 0 8px">${escapeHtml(heading)}</h2>
      <p style="color:#4b5563;font-size:15px;margin:0 0 20px">${escapeHtml(intro)}</p>
      <table style="border-collapse:collapse;margin:0 0 24px">${rowsHtml}</table>
      <a href="${escapeHtml(joinUrl)}" style="display:inline-block;background:#5E5CE6;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">Join meeting</a>
      ${extraHtml}
      <p style="color:#9ca3af;font-size:13px;margin:28px 0 0">${escapeHtml(footer)}</p>
    </div>`;
}

function meetingRows(meeting: MeetingForEmail): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['Meeting', meeting.title || 'Kloud Meet meeting'],
    ['When', formatMeetingWhen(meeting.scheduledFor, meeting.timezone)],
  ];
  if (meeting.durationMinutes) rows.push(['Duration', `${meeting.durationMinutes} minutes`]);
  if (meeting.hostName) rows.push(['Host', meeting.hostName]);
  rows.push(['Meeting ID', meeting.roomName]);
  if (meeting.description?.trim()) rows.push(['Details', meeting.description.trim()]);
  return rows;
}

/** Invitation (or "time changed" update) for one attendee. */
export function invitationEmail(to: string, meeting: MeetingForEmail, origin: string, kind: InviteKind) {
  const joinUrl = meetingJoinUrl(origin, meeting.roomName);
  const links = buildCalendarLinks(meeting, origin);
  const title = meeting.title || 'Kloud Meet meeting';
  const heading = kind === 'new' ? "You're invited" : 'Meeting time updated';
  const intro =
    kind === 'new'
      ? `${meeting.hostName || 'Your host'} invited you to a Kloud Meet meeting.`
      : `${meeting.hostName || 'Your host'} changed the time of this meeting. Here are the new details.`;
  const rows = meetingRows(meeting);
  const calendarHtml = `<p style="color:#4b5563;font-size:14px;margin:20px 0 0">Add to calendar:
      <a href="${escapeHtml(links.google)}" style="color:#5E5CE6">Google</a> ·
      <a href="${escapeHtml(links.outlook)}" style="color:#5E5CE6">Outlook</a> ·
      <a href="${escapeHtml(links.ics)}" style="color:#5E5CE6">Apple / .ics</a></p>`;
  const text = [
    intro,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Join meeting: ${joinUrl}`,
    '',
    `Add to Google Calendar: ${links.google}`,
    `Add to Outlook: ${links.outlook}`,
    `Calendar file (.ics): ${links.ics}`,
    '',
    'Please join a few minutes early to test your audio and video.',
  ].join('\n');
  return {
    to,
    tag: kind === 'new' ? 'meeting-invite' : 'meeting-invite-update',
    subject: kind === 'new' ? `Invitation: ${title}` : `Updated: ${title}`,
    text,
    html: layout(heading, intro, rows, joinUrl, 'Please join a few minutes early to test your audio and video.', calendarHtml),
  };
}

/** Reminder sent `offsetMinutes` before the start. */
export function reminderEmail(to: string, meeting: MeetingForEmail, origin: string, offsetMinutes: number) {
  const joinUrl = meetingJoinUrl(origin, meeting.roomName);
  const title = meeting.title || 'Kloud Meet meeting';
  const lead = formatLeadTime(offsetMinutes);
  const intro = `This meeting starts in ${lead}.`;
  const rows = meetingRows(meeting);
  const text = [
    intro,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Join meeting: ${joinUrl}`,
    '',
    'Join from a computer, phone or tablet — no download needed in the browser.',
  ].join('\n');
  return {
    to,
    tag: 'meeting-reminder',
    subject: `Reminder: ${title} starts in ${lead}`,
    text,
    html: layout(`Starts in ${lead}`, intro, rows, joinUrl, 'Join from a computer, phone or tablet — no download needed in the browser.'),
  };
}
