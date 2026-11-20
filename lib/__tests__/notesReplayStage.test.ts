import { describe, expect, it } from 'vitest';
import {
  captionAt,
  formatClock,
  initials,
  lineHoldSeconds,
  minuteRange,
  narrationAt,
  narrationChunks,
  narrationFractionAtChar,
  narrationTokens,
  pickVoice,
  revealCount,
  roughDuration,
  sectionAt,
  spotlightIndex,
  timedLines,
  voiceLang,
} from '@/lib/notesReplay/captions';

const line = (id: number, offsetSeconds: number | null, content = 'Hello there', speakerName = 'Ana') =>
  ({ id, offsetSeconds, content, speakerName });

describe('formatClock', () => {
  it('formats minutes and hours', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(75.9)).toBe('1:15');
    expect(formatClock(3725)).toBe('1:02:05');
  });
  it('never shows a negative or broken time', () => {
    expect(formatClock(-4)).toBe('0:00');
    expect(formatClock(NaN)).toBe('0:00');
  });
});

describe('roughDuration', () => {
  it('uses seconds below a minute and whole minutes above', () => {
    expect(roughDuration(42.4)).toEqual({ unit: 'sec', n: 42 });
    expect(roughDuration(60)).toEqual({ unit: 'min', n: 1 });
    expect(roughDuration(105)).toEqual({ unit: 'min', n: 2 });
    expect(roughDuration(47 * 60 + 10)).toEqual({ unit: 'min', n: 47 });
    expect(roughDuration(0)).toEqual({ unit: 'sec', n: 1 });
  });
});

describe('minuteRange', () => {
  it('counts minutes from 1', () => {
    expect(minuteRange(0, 50)).toEqual({ from: 1, to: 1 });
    expect(minuteRange(130, 545)).toEqual({ from: 3, to: 10 });
  });
  it('does not reach into the next minute at an exact boundary', () => {
    expect(minuteRange(60, 120)).toEqual({ from: 2, to: 2 });
  });
  it('handles a missing start or end', () => {
    expect(minuteRange(null, 90)).toBeNull();
    expect(minuteRange(200, null)).toEqual({ from: 4, to: 4 });
  });
});

describe('initials', () => {
  it('takes two letters of a Latin name and one CJK character', () => {
    expect(initials('Ana Lima')).toBe('AL');
    expect(initials('priya')).toBe('P');
    expect(initials('张伟')).toBe('张');
    expect(initials('  ')).toBe('?');
    expect(initials('Jean-Luc Picard')).toBe('JP');
  });
});

describe('timedLines', () => {
  it('drops lines without a time or without words, and sorts by time', () => {
    const out = timedLines([line(1, 30), line(2, null), line(3, 5), line(4, 12, '   ')]);
    expect(out.map((l) => l.id)).toEqual([3, 1]);
  });
});

describe('captionAt', () => {
  const lines = timedLines([line(1, 10, 'First line here'), line(2, 14, 'Second'), line(3, 120, 'Third after a long gap')]);

  it('shows nothing before the first line, with the first line next', () => {
    const m = captionAt(lines, 3);
    expect(m.current).toBeNull();
    expect(m.index).toBe(-1);
    expect(m.next?.id).toBe(1);
    expect(m.nextIn).toBe(7);
    expect(m.quiet).toBe(false);
  });
  it('a line is current from its time until the next one starts', () => {
    expect(captionAt(lines, 10).current?.id).toBe(1);
    expect(captionAt(lines, 13.9).current?.id).toBe(1);
    const m = captionAt(lines, 14);
    expect(m.current?.id).toBe(2);
    expect(m.previous?.id).toBe(1);
    expect(m.next?.id).toBe(3);
  });
  it('goes quiet when the next line is far away and the line has had time to be said', () => {
    const hold = lineHoldSeconds('Second');
    expect(captionAt(lines, 14 + hold - 0.5).quiet).toBe(false);
    const m = captionAt(lines, 14 + hold + 0.5);
    expect(m.quiet).toBe(true);
    expect(m.current?.id).toBe(2);
    expect(m.nextIn).toBeCloseTo(120 - (14 + hold + 0.5));
  });
  it('after the last line: quiet with nothing next', () => {
    const m = captionAt(lines, 500);
    expect(m.current?.id).toBe(3);
    expect(m.next).toBeNull();
    expect(m.nextIn).toBeNull();
    expect(m.quiet).toBe(true);
  });
  it('copes with no lines', () => {
    expect(captionAt([], 20)).toEqual({ index: -1, previous: null, current: null, next: null, quiet: false, nextIn: null });
  });
});

describe('lineHoldSeconds', () => {
  it('holds a short line a few seconds and a long one longer, within bounds', () => {
    expect(lineHoldSeconds('Yes.')).toBeGreaterThanOrEqual(4);
    expect(lineHoldSeconds('Yes.')).toBeLessThan(6);
    expect(lineHoldSeconds('word '.repeat(40))).toBeGreaterThan(15);
    expect(lineHoldSeconds('word '.repeat(400))).toBe(40);
  });
});

describe('sectionAt', () => {
  const sections = [
    { title: 'A', startSec: 0, endSec: 90 },
    { title: 'B', startSec: 100, endSec: 200 },
    { title: 'C', startSec: 200, endSec: 300 },
  ];
  it('finds the section and how far through it the clock is', () => {
    expect(sectionAt(sections, 150)).toEqual({ index: 1, progress: 0.5 });
    expect(sectionAt(sections, 200).index).toBe(2);
  });
  it('a section lasts until the next one starts', () => {
    const at = sectionAt(sections, 95);
    expect(at.index).toBe(0);
    expect(at.progress).toBeCloseTo(0.95);
  });
  it('is -1 before the first section and with none', () => {
    expect(sectionAt([{ title: 'A', startSec: 30, endSec: 60 }], 10)).toEqual({ index: -1, progress: 0 });
    expect(sectionAt([], 10)).toEqual({ index: -1, progress: 0 });
  });
  it('stays full after the last section ends', () => {
    expect(sectionAt(sections, 900)).toEqual({ index: 2, progress: 1 });
  });
});

describe('revealCount', () => {
  it('shows items one at a time between from and to', () => {
    expect(revealCount(0, 4, 0.1, 0.8)).toBe(0);
    expect(revealCount(0.1, 4, 0.1, 0.8)).toBe(1);
    expect(revealCount(0.3, 4, 0.1, 0.8)).toBe(2);
    expect(revealCount(0.62, 4, 0.1, 0.8)).toBe(3);
    expect(revealCount(0.8, 4, 0.1, 0.8)).toBe(4);
    expect(revealCount(1, 4, 0.1, 0.8)).toBe(4);
  });
  it('never exceeds the total and copes with none', () => {
    expect(revealCount(0.79, 1, 0.1, 0.8)).toBe(1);
    expect(revealCount(0.5, 0)).toBe(0);
  });
});

describe('spotlightIndex', () => {
  it('gives each item an equal share of the slide', () => {
    expect(spotlightIndex(0, 4)).toBe(0);
    expect(spotlightIndex(0.26, 4)).toBe(1);
    expect(spotlightIndex(0.99, 4)).toBe(3);
    expect(spotlightIndex(1, 4)).toBe(3);
    expect(spotlightIndex(0.5, 0)).toBe(-1);
  });
});

describe('narrationTokens', () => {
  it('keeps words with their spaces so the text can be rebuilt', () => {
    const text = 'Launch moves to March, Priya said.';
    const tokens = narrationTokens(text);
    expect(tokens.join('')).toBe(text);
    expect(tokens).toEqual(['Launch ', 'moves ', 'to ', 'March, ', 'Priya ', 'said.']);
  });
  it('splits CJK per character with closing punctuation attached', () => {
    const text = '发布推迟到三月，由张伟负责。';
    const tokens = narrationTokens(text);
    expect(tokens.join('')).toBe(text);
    expect(tokens).toContain('月，');
    expect(tokens[tokens.length - 1]).toBe('责。');
  });
  it('keeps Latin words whole inside CJK text', () => {
    const text = '我们用React重写，API不变。';
    const tokens = narrationTokens(text);
    expect(tokens.join('')).toBe(text);
    expect(tokens).toContain('React');
    expect(tokens).toContain('API');
  });
});

describe('narrationChunks', () => {
  it('returns nothing for an empty narration', () => {
    expect(narrationChunks('   ')).toEqual([]);
  });
  it('keeps a short narration in one line', () => {
    const chunks = narrationChunks('The launch moves to March.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].start).toBe(0);
  });
  it('cuts a long narration at sentence ends and loses nothing', () => {
    const text = 'Priya confirmed the launch moves to the second week of March. Marcus will rework the onboarding flow before then, and the team agreed to freeze new features. Support gets a preview build one week early.';
    const chunks = narrationChunks(text, 110);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
    expect(chunks[0].text.trim().endsWith('.')).toBe(true);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(112);
      expect(text.slice(chunk.start, chunk.start + chunk.text.length)).toBe(chunk.text);
    }
  });
  it('counts a CJK character as two when measuring a line', () => {
    const text = '张伟确认发布时间推迟到三月第二周。李娜会在此之前重做新手引导流程，团队同意冻结新功能。客服团队提前一周拿到预览版本，用来准备帮助文档和常见问题的回答。';
    const chunks = narrationChunks(text, 110);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
    for (const chunk of chunks) expect(Array.from(chunk.text).length).toBeLessThanOrEqual(56);
  });
});

describe('narrationAt', () => {
  const chunks = narrationChunks('One two three four. Five six seven eight nine ten eleven twelve.', 24);

  it('starts on the first line with nothing said', () => {
    expect(chunks.length).toBeGreaterThan(1);
    expect(narrationAt(chunks, 0)).toEqual({ chunk: 0, spoken: 0 });
  });
  it('ends on the last line with everything said', () => {
    const last = chunks.length - 1;
    expect(narrationAt(chunks, 1)).toEqual({ chunk: last, spoken: chunks[last].tokens.length });
    expect(narrationAt(chunks, 7)).toEqual({ chunk: last, spoken: chunks[last].tokens.length });
  });
  it('only moves forward as the fraction grows', () => {
    let before = -1;
    for (let f = 0; f <= 1.0001; f += 0.02) {
      const at = narrationAt(chunks, f);
      const said = chunks.slice(0, at.chunk).reduce((sum, c) => sum + c.tokens.length, 0) + at.spoken;
      expect(said).toBeGreaterThanOrEqual(before);
      expect(at.spoken).toBeLessThanOrEqual(chunks[at.chunk].tokens.length);
      before = said;
    }
  });
  it('has no line for an empty narration', () => {
    expect(narrationAt([], 0.5)).toEqual({ chunk: -1, spoken: 0 });
  });
});

describe('narrationFractionAtChar', () => {
  it('maps a character position to a fraction of the narration', () => {
    const chunks = narrationChunks('One two three four. Five six seven eight.', 24);
    expect(narrationFractionAtChar(chunks, 0)).toBe(0);
    expect(narrationFractionAtChar(chunks, 20)).toBeCloseTo(20 / 41);
    expect(narrationFractionAtChar(chunks, 999)).toBe(1);
    expect(narrationFractionAtChar([], 5)).toBe(0);
  });
});

describe('voice', () => {
  it('maps the presentation language to a voice tag', () => {
    expect(voiceLang('zh')).toBe('zh-CN');
    expect(voiceLang('en')).toBe('en-US');
    expect(voiceLang('ja')).toBe('ja-JP');
    expect(voiceLang('ko')).toBe('ko-KR');
    expect(voiceLang('')).toBe('en-US');
    expect(voiceLang('fr')).toBe('en-US');
  });
  it('picks the exact voice, then the same language, else none', () => {
    const voices = [
      { name: 'a', lang: 'en-GB', localService: true },
      { name: 'b', lang: 'zh-TW', localService: true },
      { name: 'c', lang: 'en-US', localService: false },
      { name: 'd', lang: 'zh_CN', localService: false },
    ];
    expect(pickVoice(voices, 'en-US')?.name).toBe('c');
    expect(pickVoice(voices, 'zh-CN')?.name).toBe('d');
    expect(pickVoice(voices.slice(0, 2), 'en-US')?.name).toBe('a');
    expect(pickVoice(voices, 'ja-JP')).toBeNull();
    expect(pickVoice([], 'en-US')).toBeNull();
  });
});
