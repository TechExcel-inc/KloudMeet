import { describe, expect, it } from 'vitest';
import {
  buildCalendarDocument,
  buildMeetingEventLines,
  buildMeetingIcs,
  escapeIcsText,
  foldIcsLine,
  formatIcsUtc,
  icsContentDisposition,
  meetingSequence,
  meetingTimes,
  type CalendarMeeting,
} from './ics';
import { toDateAndTimeInTimezone, zonedDateTimeToUtcIso } from './timezone';

const JOIN = 'https://meet.example.com/rooms/abc-123';
const NOW = new Date('2026-10-23T08:00:00Z');

const base: CalendarMeeting = {
  roomName: 'abc-123',
  title: 'Weekly sync',
  description: 'Agenda: roadmap; hiring, budget',
  scheduledFor: '2026-11-02T14:00:00.000Z',
  durationMinutes: 45,
  timezone: 'America/New_York',
  status: 'ACTIVE',
  createdAt: '2026-10-20T00:00:00.000Z',
  hostName: 'Ada Lovelace',
};

function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n');
}

describe('escapeIcsText', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });

  it('leaves colons and plain text alone', () => {
    expect(escapeIcsText('Join: https://x.test/a?b=1')).toBe('Join: https://x.test/a?b=1');
  });
});

describe('foldIcsLine', () => {
  const octets = (s: string) => new TextEncoder().encode(s).length;

  it('keeps lines of 75 octets or fewer intact', () => {
    const line = 'X'.repeat(75);
    expect(foldIcsLine(line)).toBe(line);
  });

  it('folds long ASCII lines at 75 octets with a leading space', () => {
    const line = `DESCRIPTION:${'a'.repeat(200)}`;
    const folded = foldIcsLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(octets(p)).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) expect(p.startsWith(' ')).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('never splits multi-byte UTF-8 characters', () => {
    const line = `SUMMARY:${'会議の議題🎉'.repeat(20)}`;
    const parts = foldIcsLine(line).split('\r\n');
    for (const p of parts) {
      expect(octets(p)).toBeLessThanOrEqual(75);
      // A broken surrogate pair or split char would not survive a round trip.
      expect(new TextDecoder().decode(new TextEncoder().encode(p))).toBe(p);
      expect(p).not.toMatch(/[\ud800-\udbff]$/);
    }
    expect(parts.join('\r\n').replace(/\r\n /g, '')).toBe(line);
  });
});

describe('time conversion', () => {
  it('formats instants as UTC basic format', () => {
    expect(formatIcsUtc('2026-03-08T07:05:09.123Z')).toBe('20260308T070509Z');
    expect(formatIcsUtc(new Date('2026-12-31T23:59:59+08:00'))).toBe('20261231T155959Z');
  });

  it('computes DTEND from durationMinutes, defaulting to 30', () => {
    const { start, end } = meetingTimes(base);
    expect(end.getTime() - start.getTime()).toBe(45 * 60_000);
    const fallback = meetingTimes({ scheduledFor: base.scheduledFor, durationMinutes: null });
    expect(fallback.end.getTime() - fallback.start.getTime()).toBe(30 * 60_000);
  });

  it('converts wall-clock time in a zone to UTC, across DST', () => {
    // New York: EDT (UTC-4) in October, EST (UTC-5) in November.
    expect(zonedDateTimeToUtcIso('2026-10-23', '09:00', 'America/New_York')).toBe(
      '2026-10-23T13:00:00.000Z',
    );
    expect(zonedDateTimeToUtcIso('2026-11-02', '09:00', 'America/New_York')).toBe(
      '2026-11-02T14:00:00.000Z',
    );
    expect(zonedDateTimeToUtcIso('2026-10-23', '20:00', 'Asia/Tokyo')).toBe(
      '2026-10-23T11:00:00.000Z',
    );
    expect(zonedDateTimeToUtcIso('2026-10-23', '20:00', 'UTC')).toBe('2026-10-23T20:00:00.000Z');
  });

  it('round-trips UTC instants back to wall-clock time in the zone', () => {
    expect(toDateAndTimeInTimezone(new Date('2026-11-02T14:00:00Z'), 'America/New_York')).toEqual({
      date: '2026-11-02',
      time: '09:00',
    });
    expect(toDateAndTimeInTimezone(new Date('2026-10-23T16:30:00Z'), 'Asia/Shanghai')).toEqual({
      date: '2026-10-24',
      time: '00:30',
    });
  });

  it('writes DTSTART/DTEND in UTC regardless of the meeting time zone', () => {
    const lines = unfold(buildMeetingIcs(base, { joinUrl: JOIN, now: NOW }));
    expect(lines).toContain('DTSTART:20261102T140000Z');
    expect(lines).toContain('DTEND:20261102T144500Z');
    expect(lines).toContain('DTSTAMP:20261023T080000Z');
  });
});

describe('buildMeetingIcs', () => {
  it('produces a valid single-event calendar', () => {
    const ics = buildMeetingIcs(base, { joinUrl: JOIN, now: NOW });
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    const lines = unfold(ics);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('METHOD:PUBLISH');
    expect(lines).toContain('UID:meeting-abc-123@kloudmeet');
    expect(lines).toContain('SUMMARY:Weekly sync');
    expect(lines).toContain(`LOCATION:${JOIN}`);
    expect(lines).toContain(`URL:${JOIN}`);
    expect(lines).toContain('STATUS:CONFIRMED');
    expect(lines).toContain('TRIGGER:-PT10M');
    expect(lines).toContain('SEQUENCE:0');
    const desc = lines.find((l) => l.startsWith('DESCRIPTION:Join'));
    expect(desc).toBe(
      `DESCRIPTION:Join Kloud Meet: ${JOIN}\\nMeeting ID: abc-123\\nHost: Ada Lovelace\\n\\nAgenda: roadmap\\; hiring\\, budget`,
    );
    for (const physical of ics.split('\r\n')) {
      expect(new TextEncoder().encode(physical).length).toBeLessThanOrEqual(75);
    }
  });

  it('omits ORGANIZER without an email, includes it with one', () => {
    expect(buildMeetingIcs(base, { joinUrl: JOIN, now: NOW })).not.toContain('ORGANIZER');
    const lines = unfold(
      buildMeetingIcs({ ...base, hostEmail: 'ada@example.com' }, { joinUrl: JOIN, now: NOW }),
    );
    expect(lines).toContain('ORGANIZER;CN="Ada Lovelace":mailto:ada@example.com');
  });

  it('falls back to a default title', () => {
    const lines = unfold(buildMeetingIcs({ ...base, title: '  ' }, { joinUrl: JOIN, now: NOW }));
    expect(lines).toContain('SUMMARY:Kloud Meet meeting');
  });

  it('cancels with METHOD:CANCEL, STATUS:CANCELLED and no alarm', () => {
    const lines = unfold(
      buildMeetingIcs({ ...base, status: 'CANCELED' }, { joinUrl: JOIN, now: NOW }),
    );
    expect(lines).toContain('METHOD:CANCEL');
    expect(lines).toContain('STATUS:CANCELLED');
    expect(lines).not.toContain('BEGIN:VALARM');
    expect(lines).toContain('UID:meeting-abc-123@kloudmeet');
  });

  it('bumps SEQUENCE when the meeting is modified', () => {
    expect(meetingSequence({ createdAt: base.createdAt, modifiedAt: null })).toBe(0);
    const s1 = meetingSequence({ createdAt: base.createdAt, modifiedAt: '2026-10-21T00:00:00Z' });
    const s2 = meetingSequence({ createdAt: base.createdAt, modifiedAt: '2026-10-22T00:00:00Z' });
    expect(s1).toBe(86_400);
    expect(s2).toBeGreaterThan(s1);
    expect(s2).toBeLessThan(2 ** 31);
    const lines = unfold(
      buildMeetingIcs(
        { ...base, modifiedAt: '2026-10-21T00:00:00Z' },
        { joinUrl: JOIN, now: NOW },
      ),
    );
    expect(lines).toContain('SEQUENCE:86400');
    expect(lines).toContain('LAST-MODIFIED:20261021T000000Z');
  });
});

describe('buildCalendarDocument', () => {
  it('adds feed metadata and multiple events', () => {
    const e1 = buildMeetingEventLines(base, { joinUrl: JOIN, now: NOW });
    const e2 = buildMeetingEventLines({ ...base, roomName: 'xyz-9' }, { joinUrl: JOIN, now: NOW });
    const lines = unfold(
      buildCalendarDocument([e1, e2], { calendarName: 'Kloud Meet, Ada', refreshMinutes: 60 }),
    );
    expect(lines).toContain('X-WR-CALNAME:Kloud Meet\\, Ada');
    expect(lines).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT60M');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(lines[lines.length - 2]).toBe('END:VCALENDAR');
  });
});

describe('icsContentDisposition', () => {
  it('sanitizes the filename and adds a UTF-8 variant', () => {
    expect(icsContentDisposition('Q4 plan: "go/no-go"')).toBe(
      `attachment; filename="Q4 plan go no-go.ics"; filename*=UTF-8''Q4%20plan%20go%20no-go.ics`,
    );
    const cjk = icsContentDisposition('週次ミーティング');
    expect(cjk).toContain('filename="________.ics"');
    expect(cjk).toContain(`filename*=UTF-8''${encodeURIComponent('週次ミーティング.ics')}`);
    expect(icsContentDisposition('  ')).toContain('filename="meeting.ics"');
  });
});
