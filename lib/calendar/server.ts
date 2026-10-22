import type { NextRequest } from 'next/server';
import type { CalendarMeeting } from './ics';

/**
 * Public origin used for join links inside calendar files.
 * NEXT_PUBLIC_APP_URL wins (it is what Google OAuth already redirects to); otherwise the
 * proxy-forwarded host, then the request URL.
 */
export function publicOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const url = new URL(request.url);
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(/:$/, '');
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host') ||
    url.host;
  return `${proto}://${host}`;
}

export const ICS_RESPONSE_HEADERS = {
  'Content-Type': 'text/calendar; charset=utf-8',
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
} as const;

interface MeetingRowForCalendar {
  roomName: string;
  title: string | null;
  description: string | null;
  scheduledFor: Date | null;
  durationMinutes: number | null;
  timezone: string | null;
  status: string;
  createdAt: Date;
  modifiedAt: Date | null;
  createdByMember?: { fullName: string | null; username: string; email?: string | null } | null;
}

/**
 * Map a Meeting row to calendar data. The host email is only included when `includeHostEmail`
 * (the private feed of the host themself) — the public .ics shares what "Copy Invite" shares.
 */
export function toCalendarMeeting(
  row: MeetingRowForCalendar & { scheduledFor: Date },
  { includeHostEmail = false }: { includeHostEmail?: boolean } = {},
): CalendarMeeting {
  const host = row.createdByMember;
  return {
    roomName: row.roomName,
    title: row.title,
    description: row.description,
    scheduledFor: row.scheduledFor,
    durationMinutes: row.durationMinutes,
    timezone: row.timezone,
    status: row.status,
    createdAt: row.createdAt,
    modifiedAt: row.modifiedAt,
    hostName: host ? host.fullName || host.username : null,
    hostEmail: includeHostEmail ? host?.email ?? null : null,
  };
}
