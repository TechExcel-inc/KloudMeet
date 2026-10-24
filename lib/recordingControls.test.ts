import { describe, expect, it } from 'vitest';
import {
  canControlRecording,
  closePause,
  memberMayRecord,
  memberMayReportRoles,
  parseMeetingRoles,
  parsePauseSpans,
  pauseRangesInMedia,
  pausedSeconds,
  skipPaused,
} from './recordingControls';

describe('canControlRecording', () => {
  it('lets host and co-host record; presenters only when not host-only', () => {
    expect(canControlRecording({ isHost: true, isCohost: false, isPresenter: false, hostOnly: true })).toBe(true);
    expect(canControlRecording({ isHost: false, isCohost: true, isPresenter: false, hostOnly: true })).toBe(true);
    expect(canControlRecording({ isHost: false, isCohost: false, isPresenter: true, hostOnly: true })).toBe(false);
    expect(canControlRecording({ isHost: false, isCohost: false, isPresenter: true, hostOnly: false })).toBe(true);
    expect(canControlRecording({ isHost: false, isCohost: false, isPresenter: false, hostOnly: false })).toBe(false);
  });
});

describe('pauses', () => {
  const t0 = new Date('2026-10-24T10:00:00Z');
  const at = (s: number) => new Date(t0.getTime() + s * 1000);

  it('closes an open pause into a span and totals it', () => {
    const spans = closePause([], at(60), at(90));
    expect(spans).toEqual([{ from: at(60).toISOString(), to: at(90).toISOString() }]);
    expect(pausedSeconds(closePause(spans, at(120), at(135)))).toBe(45);
    expect(closePause(spans, null, at(200))).toBe(spans);
  });

  it('maps spans onto the media timeline and skips them', () => {
    const spans = [
      { from: at(60).toISOString(), to: at(90).toISOString() },
      { from: at(5).toISOString(), to: at(8).toISOString() },
    ];
    const ranges = pauseRangesInMedia(spans, at(2));
    expect(ranges).toEqual([[3, 6], [58, 88]]);
    expect(skipPaused(4, ranges)).toBe(6);
    expect(skipPaused(10, ranges)).toBe(10);
    expect(skipPaused(58, ranges)).toBe(88);
  });

  it('ignores malformed spans', () => {
    expect(parsePauseSpans([{ from: 'a', to: 'b' }, { from: 1 }, null, 'x'])).toEqual([{ from: 'a', to: 'b' }]);
    expect(parsePauseSpans(null)).toEqual([]);
  });
});

describe('server-side permission', () => {
  const roles = { host: 'km_5_abc', cohosts: ['km_6_d'], presenters: ['km_7_e', 'guest__x'] };
  it('allows creator, host and co-hosts; presenters only when not host-only', () => {
    const may = (memberId: number, hostOnly: boolean) => memberMayRecord({ memberId, creatorId: 1, roles, hostOnly });
    expect(may(1, true)).toBe(true);
    expect(may(5, true)).toBe(true);
    expect(may(6, true)).toBe(true);
    expect(may(7, true)).toBe(false);
    expect(may(7, false)).toBe(true);
    expect(may(9, false)).toBe(false);
  });
  it('lets the creator or the reported host update roles', () => {
    expect(memberMayReportRoles({ memberId: 1, creatorId: 1, roles })).toBe(true);
    expect(memberMayReportRoles({ memberId: 5, creatorId: 1, roles })).toBe(true);
    expect(memberMayReportRoles({ memberId: 6, creatorId: 1, roles })).toBe(false);
    expect(parseMeetingRoles(null)).toEqual({ host: null, cohosts: [], presenters: [] });
  });
});
