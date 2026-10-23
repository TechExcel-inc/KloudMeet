import { describe, expect, it } from 'vitest';
import {
  buildCalendarLinks,
  calendarFeedUrls,
  googleCalendarUrl,
  meetingIcsUrl,
  meetingJoinUrl,
  office365CalendarUrl,
  outlookCalendarUrl,
} from './links';
import type { CalendarMeeting } from './ics';

const ORIGIN = 'https://meet.example.com/';
const meeting: CalendarMeeting = {
  roomName: 'abc-123',
  title: 'Design review & demo',
  description: 'Bring mocks',
  scheduledFor: '2026-11-02T14:00:00.000Z',
  durationMinutes: 60,
  timezone: 'Asia/Tokyo',
  hostName: 'Ada',
};
const JOIN = meetingJoinUrl(ORIGIN, meeting.roomName);

describe('meeting URLs', () => {
  it('builds join and .ics URLs without double slashes', () => {
    expect(JOIN).toBe('https://meet.example.com/rooms/abc-123');
    expect(meetingIcsUrl(ORIGIN, 'a b')).toBe(
      'https://meet.example.com/api/meetings/a%20b/calendar.ics',
    );
  });
});

describe('googleCalendarUrl', () => {
  it('uses the TEMPLATE action with UTC dates', () => {
    const url = new URL(googleCalendarUrl(meeting, JOIN));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Design review & demo');
    expect(url.searchParams.get('dates')).toBe('20261102T140000Z/20261102T150000Z');
    expect(url.searchParams.get('location')).toBe(JOIN);
    expect(url.searchParams.get('ctz')).toBe('Asia/Tokyo');
    expect(url.searchParams.get('details')).toContain(`Join Kloud Meet: ${JOIN}`);
    expect(url.searchParams.get('details')).toContain('Bring mocks');
  });

  it('encodes spaces as %20, not +', () => {
    expect(googleCalendarUrl(meeting, JOIN)).toContain('text=Design%20review%20%26%20demo');
  });

  it('truncates very long descriptions', () => {
    const url = googleCalendarUrl({ ...meeting, description: 'x'.repeat(5000) }, JOIN);
    expect(url.length).toBeLessThan(2000);
  });
});

describe('Outlook deeplinks', () => {
  it('builds Outlook.com compose links', () => {
    const url = new URL(outlookCalendarUrl(meeting, JOIN));
    expect(url.host).toBe('outlook.live.com');
    expect(url.pathname).toBe('/calendar/0/deeplink/compose');
    expect(url.searchParams.get('rru')).toBe('addevent');
    expect(url.searchParams.get('path')).toBe('/calendar/action/compose');
    expect(url.searchParams.get('subject')).toBe('Design review & demo');
    expect(url.searchParams.get('startdt')).toBe('2026-11-02T14:00:00Z');
    expect(url.searchParams.get('enddt')).toBe('2026-11-02T15:00:00Z');
    expect(url.searchParams.get('location')).toBe(JOIN);
  });

  it('builds Office 365 compose links on outlook.office.com', () => {
    const url = new URL(office365CalendarUrl(meeting, JOIN));
    expect(url.host).toBe('outlook.office.com');
    expect(url.searchParams.get('startdt')).toBe('2026-11-02T14:00:00Z');
  });
});

describe('buildCalendarLinks', () => {
  it('returns all providers', () => {
    const links = buildCalendarLinks(meeting, ORIGIN);
    expect(links.google).toMatch(/^https:\/\/calendar\.google\.com\//);
    expect(links.outlook).toMatch(/^https:\/\/outlook\.live\.com\//);
    expect(links.office365).toMatch(/^https:\/\/outlook\.office\.com\//);
    expect(links.ics).toBe('https://meet.example.com/api/meetings/abc-123/calendar.ics');
  });
});

describe('calendarFeedUrls', () => {
  it('builds https, webcal and Google subscribe URLs', () => {
    const urls = calendarFeedUrls('http://localhost:3201', 'tok_ABC-123');
    expect(urls.https).toBe('http://localhost:3201/api/calendar/feed/tok_ABC-123.ics');
    expect(urls.webcal).toBe('webcal://localhost:3201/api/calendar/feed/tok_ABC-123.ics');
    expect(new URL(urls.google).searchParams.get('cid')).toBe(urls.webcal);
  });
});
