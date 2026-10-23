import { describe, expect, it } from 'vitest';
import { hasHostedMeeting, pickRecentReplays, pickUpNext, replayMinutes, type DashMeeting } from './dashboardData';

const NOW = Date.parse('2026-10-24T10:00:00Z');
const at = (min: number) => new Date(NOW + min * 60000).toISOString();

describe('pickUpNext', () => {
  const meetings: DashMeeting[] = [
    { roomName: 'later', status: 'SCHEDULED', scheduledFor: at(240) },
    { roomName: 'soon', status: 'SCHEDULED', scheduledFor: at(25) },
    { roomName: 'live', status: 'ACTIVE', isActive: true, actualStartedAt: at(-32) },
    { roomName: 'missed', status: 'SCHEDULED', scheduledFor: at(-90) },
    { roomName: 'late', status: 'SCHEDULED', scheduledFor: at(-10) },
    { roomName: 'ended', status: 'ENDED', scheduledFor: at(60) },
    { roomName: 'canceled', status: 'CANCELED', scheduledFor: at(60) },
    { roomName: 'instant', status: 'ENDED', createdAt: at(-300) },
  ];

  it('puts live meetings first, then the soonest scheduled ones', () => {
    expect(pickUpNext(meetings, NOW, 5).map((i) => i.meeting.roomName)).toEqual(['live', 'late', 'soon', 'later']);
  });

  it('drops ended, canceled and long-missed meetings', () => {
    const rooms = pickUpNext(meetings, NOW, 10).map((i) => i.meeting.roomName);
    expect(rooms).not.toContain('missed');
    expect(rooms).not.toContain('ended');
    expect(rooms).not.toContain('canceled');
  });

  it('keeps to the limit', () => {
    expect(pickUpNext(meetings, NOW)).toHaveLength(3);
  });
});

describe('pickRecentReplays', () => {
  it('lists meetings with a ready recording, newest first', () => {
    const items = pickRecentReplays([
      { roomName: 'a', createdAt: at(-3000), recordings: [{ id: 1, status: 'READY' }] },
      { roomName: 'b', createdAt: at(-100), recordings: [{ id: 2, status: 'PROCESSING' }] },
      { roomName: 'c', createdAt: at(-200), recordings: [{ id: 3, status: 'READY' }] },
    ]);
    expect(items.map((i) => i.meeting.roomName)).toEqual(['c', 'a']);
  });
});

describe('hasHostedMeeting', () => {
  it('only counts meetings the user hosted and actually ran', () => {
    expect(hasHostedMeeting([{ roomName: 'x', createdByMemberId: 7, status: 'SCHEDULED' }], '7')).toBe(false);
    expect(hasHostedMeeting([{ roomName: 'x', createdByMemberId: 8, status: 'ENDED' }], '7')).toBe(false);
    expect(hasHostedMeeting([{ roomName: 'x', createdByMemberId: 7, status: 'ENDED' }], '7')).toBe(true);
  });
});

describe('replayMinutes', () => {
  it('prefers the recording length', () => {
    expect(replayMinutes({ meeting: { roomName: 'x', durationMinutes: 60 }, recording: { id: 1, status: 'READY', durationSeconds: 2520 } })).toBe(42);
    expect(replayMinutes({ meeting: { roomName: 'x', durationMinutes: 60 }, recording: { id: 1, status: 'READY' } })).toBe(60);
  });
});
