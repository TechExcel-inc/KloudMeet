import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMINDER_OFFSETS,
  dueReminderOffsets,
  formatLeadTime,
  invitationEmail,
  normalizeEmails,
  parseReminderOffsets,
  reminderEmail,
} from './meetingInvites';

describe('normalizeEmails', () => {
  it('keeps valid, unique, lower-cased addresses', () => {
    expect(normalizeEmails([' Ann@Example.com', 'ann@example.com', 'bad', 'bob@x.io', 3, null])).toEqual([
      'ann@example.com',
      'bob@x.io',
    ]);
    expect(normalizeEmails('x')).toEqual([]);
  });
});

describe('parseReminderOffsets', () => {
  it('defaults, filters and sorts', () => {
    expect(parseReminderOffsets(undefined)).toEqual(DEFAULT_REMINDER_OFFSETS);
    expect(parseReminderOffsets([60, 1440, 60, -5, 99999999, 'x'])).toEqual([1440, 60]);
    expect(parseReminderOffsets([])).toEqual([]);
  });
});

describe('dueReminderOffsets', () => {
  const start = new Date('2026-11-02T10:00:00Z');
  const at = (minBefore: number) => new Date(start.getTime() - minBefore * 60000);
  const createdAt = at(3 * 1440);
  const offsets = [1440, 480];

  it('sends each reminder once when its time comes', () => {
    expect(dueReminderOffsets({ now: at(2000), scheduledFor: start, createdAt, offsets, sent: [] })).toEqual([]);
    expect(dueReminderOffsets({ now: at(1430), scheduledFor: start, createdAt, offsets, sent: [] })).toEqual([1440]);
    expect(dueReminderOffsets({ now: at(1430), scheduledFor: start, createdAt, offsets, sent: [1440] })).toEqual([]);
    expect(dueReminderOffsets({ now: at(470), scheduledFor: start, createdAt, offsets, sent: [1440] })).toEqual([480]);
  });

  it('sends only the closest reminder when several are due at once', () => {
    expect(dueReminderOffsets({ now: at(470), scheduledFor: start, createdAt, offsets, sent: [] })).toEqual([480]);
  });

  it('skips reminders whose time passed before the meeting was scheduled', () => {
    const late = at(600); // scheduled 10 hours before the start
    expect(dueReminderOffsets({ now: at(590), scheduledFor: start, createdAt: late, offsets, sent: [] })).toEqual([]);
    expect(dueReminderOffsets({ now: at(470), scheduledFor: start, createdAt: late, offsets, sent: [] })).toEqual([480]);
    const veryLate = at(180); // scheduled 3 hours before: the invitation is enough
    expect(dueReminderOffsets({ now: at(170), scheduledFor: start, createdAt: veryLate, offsets, sent: [] })).toEqual([]);
  });

  it('sends nothing once the meeting has started', () => {
    expect(dueReminderOffsets({ now: start, scheduledFor: start, createdAt, offsets, sent: [] })).toEqual([]);
  });
});

describe('emails', () => {
  const meeting = {
    roomName: 'abc-123',
    title: 'Q4 <review>',
    description: 'Agenda',
    scheduledFor: new Date('2026-11-02T10:00:00Z'),
    durationMinutes: 30,
    timezone: 'Asia/Tokyo',
    hostName: 'ying huang',
  };

  it('builds an invitation with the join link, time zone and calendar links, escaping HTML', () => {
    const mail = invitationEmail('a@b.co', meeting, 'https://meet.example.com', 'new');
    expect(mail.subject).toBe('Invitation: Q4 <review>');
    expect(mail.text).toContain('https://meet.example.com/rooms/abc-123');
    expect(mail.text).toContain('Asia/Tokyo');
    expect(mail.text).toContain('calendar.google.com');
    expect(mail.html).toContain('Q4 &lt;review&gt;');
    expect(mail.html).not.toContain('Q4 <review>');
    expect(invitationEmail('a@b.co', meeting, 'https://m.e', 'updated').subject).toBe('Updated: Q4 <review>');
  });

  it('builds a reminder with the lead time', () => {
    expect(reminderEmail('a@b.co', meeting, 'https://m.e', 480).subject).toBe('Reminder: Q4 <review> starts in 8 hours');
    expect(formatLeadTime(1440)).toBe('1 day');
    expect(formatLeadTime(2880)).toBe('2 days');
    expect(formatLeadTime(45)).toBe('45 minutes');
  });
});
