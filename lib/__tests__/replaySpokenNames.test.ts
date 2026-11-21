import { describe, expect, it } from 'vitest';
import { buildReplayWriting } from '@/lib/replayWriting';
import { createReplaySpokenNames } from '@/lib/replaySpokenNames';

describe('Smart Play spoken attendee names', () => {
  const speak = createReplaySpokenNames([
    { id: 1, displayName: 'Xiao yu', teamMember: { id: 11, fullName: null, username: 'xiaoyu' } },
    { id: 2, displayName: 'Jiawei', teamMember: { id: 12, fullName: '王家伟', username: 'jiawei' } },
  ], 'zh-CN');

  it('speaks linked names from the roster while preserving caption usernames', () => {
    const lines = [
      { id: 1, speakerKey: 'member:11', speakerName: 'xiaoyu', verifiedAttendee: true, offsetSeconds: 0, content: '请给个回复。' },
      { id: 2, speakerKey: 'member:12', speakerName: 'jiawei', verifiedAttendee: true, offsetSeconds: 8, content: '好。' },
    ];
    const write = buildReplayWriting({ sections: [{
      title: '回复', text: '[[speaker:member:11]]请[[speaker:member:12]]回复。xiaoyu2 是示例账号。',
      speakerKey: 'member:11', sourceLineIds: [1],
    }] }, lines, 'Meeting', true)!;
    const [slide] = write.slides;
    expect(slide.narration).toBe('xiaoyu请jiawei回复。xiaoyu2 是示例账号。');
    expect(speak(slide)).toBe('Xiao yu请王家伟回复。xiaoyu2 是示例账号。');
    expect(slide.attribution).toEqual({ key: 'member:11', name: 'xiaoyu' });
  });

  it('limits a legacy replacement to the verified leading attribution', () => {
    const attribution = { key: 'member:11', name: 'xiaoyu' };
    expect(speak({ narration: 'xiaoyu 介绍后提到 xiaoyu2。', attribution })).toBe('Xiao yu 介绍后提到 xiaoyu2。');
    expect(speak({ narration: 'xiaoyu2 介绍情况。', attribution })).toBe('xiaoyu2 介绍情况。');
    expect(speak({ narration: 'xiaoyu 介绍情况。', attribution: { key: 'guest:9', name: 'xiaoyu' } })).toBe('xiaoyu 介绍情况。');
  });
});
