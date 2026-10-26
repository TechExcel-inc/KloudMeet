import { describe, expect, it } from 'vitest';
import {
  cleanPersonalRoomIdInput,
  isPersonalIdPromptVisible,
  isValidPersonalRoomId,
  parsePersonalIdPromptState,
  personalRoomIdCandidates,
  snoozePersonalIdPrompt,
  PERSONAL_ID_PROMPT_SNOOZE_MS,
} from './personalRoomId';

describe('personal meeting ID rules', () => {
  it('accepts 3–12 letters and digits with a letter', () => {
    expect(isValidPersonalRoomId('ying')).toBe(true);
    expect(isValidPersonalRoomId('A999')).toBe(true);
    expect(isValidPersonalRoomId('999')).toBe(false);
    expect(isValidPersonalRoomId('ab')).toBe(false);
    expect(isValidPersonalRoomId('abc-def')).toBe(false);
    expect(isValidPersonalRoomId('abcdefghijklm')).toBe(false);
  });

  it('cleans typing down to letters and digits, 12 at most', () => {
    expect(cleanPersonalRoomIdInput('ying huang-26!')).toBe('yinghuang26');
    expect(cleanPersonalRoomIdInput('abcdefghijklmnop')).toBe('abcdefghijkl');
  });
});

describe('personalRoomIdCandidates', () => {
  it('starts from the first name, then the username', () => {
    const c = personalRoomIdCandidates({ username: 'yhuang', fullName: 'Ying Huang' }, undefined, 2026);
    expect(c.slice(0, 4)).toEqual(['ying', 'yhuang', 'yinghuang', 'yhuang26']);
    expect(c).toContain('yingh');
    expect(c.every(isValidPersonalRoomId)).toBe(true);
  });

  it('builds on a taken typed ID first', () => {
    const c = personalRoomIdCandidates({ fullName: 'Amy Huang' }, 'amy', 2026);
    expect(c[0]).toBe('amy');
    expect(c).toContain('amyhuang');
    expect(c).toContain('amyh');
    expect(c).toContain('amy26');
  });

  it('skips stems that cannot make a valid ID and never repeats', () => {
    const c = personalRoomIdCandidates({ fullName: 'Wu', username: '12' }, undefined, 2026);
    expect(c).toContain('wu26');
    expect(c).not.toContain('wu');
    expect(new Set(c).size).toBe(c.length);
  });

  it('drops accents and caps at 12', () => {
    const c = personalRoomIdCandidates({ fullName: 'José Fernández-Castillo' }, undefined, 2026);
    expect(c[0]).toBe('jose');
    expect(c).toContain('josefernande');
  });
});

describe('home prompt snooze', () => {
  it('hides for 14 days after the first Not now, and for good after the second', () => {
    const now = 1_000_000;
    let s = parsePersonalIdPromptState(null);
    expect(isPersonalIdPromptVisible(s, now)).toBe(true);
    s = snoozePersonalIdPrompt(s, now);
    expect(isPersonalIdPromptVisible(s, now + 1)).toBe(false);
    expect(isPersonalIdPromptVisible(s, now + PERSONAL_ID_PROMPT_SNOOZE_MS)).toBe(true);
    s = snoozePersonalIdPrompt(s, now + PERSONAL_ID_PROMPT_SNOOZE_MS);
    expect(isPersonalIdPromptVisible(s, now + 10 * PERSONAL_ID_PROMPT_SNOOZE_MS)).toBe(false);
  });

  it('treats unreadable storage as a fresh start', () => {
    expect(parsePersonalIdPromptState('{oops')).toEqual({ dismissals: 0, hiddenUntil: 0 });
  });
});
