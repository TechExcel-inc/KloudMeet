import { describe, expect, it } from 'vitest';
import {
  buildCalendarFeedIcs,
  FEED_MAX_EVENTS,
  generateCalendarFeedToken,
  parseFeedTokenParam,
  selectFeedMeetings,
} from './feed';
import type { CalendarMeeting } from './ics';

const NOW = new Date('2026-10-23T08:00:00Z');
const day = 24 * 60 * 60 * 1000;

function meeting(roomName: string, offsetDays: number, extra: Partial<CalendarMeeting> = {}): CalendarMeeting {
  return {
    roomName,
    title: `Meeting ${roomName}`,
    scheduledFor: new Date(NOW.getTime() + offsetDays * day),
    durationMinutes: 30,
    status: 'ACTIVE',
    ...extra,
  };
}

describe('feed tokens', () => {
  it('generates unguessable, URL-safe, unique tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateCalendarFeedToken()));
    expect(tokens.size).toBe(200);
    for (const tok of tokens) expect(tok).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('parses "<token>.ics" route params and rejects anything else', () => {
    const tok = generateCalendarFeedToken();
    expect(parseFeedTokenParam(`${tok}.ics`)).toBe(tok);
    expect(parseFeedTokenParam(`${tok}.ICS`)).toBe(tok);
    expect(parseFeedTokenParam(tok)).toBe(tok);
    expect(parseFeedTokenParam('short.ics')).toBeNull();
    expect(parseFeedTokenParam(`${tok}x.ics`)).toBeNull();
    expect(parseFeedTokenParam(`${tok.slice(0, 42)}%.ics`)).toBeNull();
    expect(parseFeedTokenParam("' OR 1=1 --")).toBeNull();
    expect(parseFeedTokenParam('')).toBeNull();
    expect(parseFeedTokenParam(undefined)).toBeNull();
  });
});

describe('selectFeedMeetings', () => {
  it('keeps upcoming and recent meetings, drops canceled and out-of-window ones, sorted', () => {
    const selected = selectFeedMeetings(
      [
        meeting('later', 10),
        meeting('soon', 1),
        meeting('recent', -3),
        meeting('old', -60),
        meeting('far', 400),
        meeting('canceled', 2, { status: 'CANCELED' }),
      ],
      NOW,
    );
    expect(selected.map((m) => m.roomName)).toEqual(['recent', 'soon', 'later']);
  });

  it('caps the number of events', () => {
    const many = Array.from({ length: FEED_MAX_EVENTS + 20 }, (_, i) => meeting(`m${i}`, 1 + i / 100));
    expect(selectFeedMeetings(many, NOW)).toHaveLength(FEED_MAX_EVENTS);
  });
});

describe('buildCalendarFeedIcs', () => {
  it('renders a PUBLISH calendar with name, refresh hint and one VEVENT per meeting', () => {
    const ics = buildCalendarFeedIcs([meeting('aaaa-1111', 1), meeting('bbbb-2222', 2)], {
      origin: 'https://meet.example.com',
      calendarName: 'Kloud Meet',
      now: NOW,
    });
    const lines = ics.replace(/\r\n /g, '').split('\r\n');
    expect(lines).toContain('METHOD:PUBLISH');
    expect(lines).toContain('X-WR-CALNAME:Kloud Meet');
    expect(lines).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT60M');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(lines).toContain('UID:meeting-aaaa-1111@kloudmeet');
    expect(lines).toContain('URL:https://meet.example.com/rooms/bbbb-2222');
  });

  it('is still a valid calendar when empty', () => {
    const ics = buildCalendarFeedIcs([], { origin: 'https://x.test', calendarName: 'K', now: NOW });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});
