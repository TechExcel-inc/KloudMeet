import { describe, expect, it } from 'vitest';
import { getResolvedLiveRoomName } from './personalRoomResolveClient';

describe('getResolvedLiveRoomName', () => {
  it("follows the owner into the meeting they're hosting when the personal ID is opened", () => {
    // 2026-10-26: guests who opened m5888 were left in a second room while tierenz hosted uzf-dfxb-smf
    expect(
      getResolvedLiveRoomName('m5888', {
        kind: 'join_live',
        personalRoomId: 'm5888',
        effectiveRoomName: 'uzf-dfxb-smf',
        isPersonalSession: false,
      }),
    ).toBe('uzf-dfxb-smf');
  });

  it('stays put when the live session is the personal room itself (any letter case)', () => {
    expect(
      getResolvedLiveRoomName('M5888', {
        kind: 'join_live',
        personalRoomId: 'm5888',
        effectiveRoomName: 'm5888',
        isPersonalSession: true,
      }),
    ).toBeNull();
  });

  it('ignores answers that are not a live session', () => {
    expect(getResolvedLiveRoomName('m5888', { kind: 'open_personal_idle', personalRoomId: 'm5888' })).toBeNull();
    expect(getResolvedLiveRoomName('abc-defg-hij', { kind: 'direct_join', roomName: 'abc-defg-hij' })).toBeNull();
    expect(getResolvedLiveRoomName('m5888', null)).toBeNull();
  });
});
