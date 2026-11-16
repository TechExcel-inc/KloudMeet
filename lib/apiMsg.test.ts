import { describe, expect, it } from 'vitest';
import { translateText } from './apiMsg';

describe('translateText', () => {
  it('keeps English and codes used by the client', () => {
    expect(translateText('en', 'Meeting not found')).toBe('Meeting not found');
    expect(translateText('zh', 'full')).toBe('full');
    expect(translateText('ja', 'unreadable')).toBe('unreadable');
  });

  it('translates a known prompt and leaves unknown text', () => {
    expect(translateText('zh', 'Meeting not found')).toBe('找不到这场会议');
    expect(translateText('ja', 'Unauthorized')).toBe('ログインが必要です');
    expect(translateText('ko', 'Not a real message')).toBe('Not a real message');
  });

  it('fills status into the recording prompt', () => {
    expect(translateText('zh', 'Recording is not ready yet (status: EGRESS_STARTING)')).toBe(
      '录制还没准备好（状态：EGRESS_STARTING）',
    );
  });
});
