import { describe, expect, it } from 'vitest';
import {
  aiFailureReason,
  buildSummaryPrompt,
  normalizeSummary,
  sectionContent,
  snapToTranscript,
  speakersByTalk,
  stripEmoji,
  type SummaryTranscriptLine,
} from './meetingSummary';

const lines: SummaryTranscriptLine[] = [
  { offsetSeconds: 0, speakerName: 'ying huang', content: '德法伙伴贡献了本季度 62% 的新签，北欧仍以直销为主。' },
  { offsetSeconds: 134, speakerName: 'ying huang', content: '北欧是下季度主要的增长空间。' },
  { offsetSeconds: 1000, speakerName: 'Alex Chen', content: '每家伙伴至少交付两个联合客户案例。' },
  { offsetSeconds: 1166, speakerName: 'Alex Chen', content: '法兰克福合作方要先完成产品认证。' },
  { offsetSeconds: 1470, speakerName: 'Mina Sato', content: '认证放在 11 月第二周，让小王把回放发给缺席的伙伴。' },
  { offsetSeconds: 1870, speakerName: 'Alex Chen', content: '我周五前把伙伴目标表发出来。' },
  { offsetSeconds: 1900, speakerName: 'Unknown', content: '嗯。' },
];

describe('meeting summary helpers', () => {
  it('builds the prompt with second marks and speakers', () => {
    const prompt = buildSummaryPrompt('EMEA', lines);
    expect(prompt).toContain('[1000] Alex Chen: 每家伙伴至少交付两个联合客户案例。');
    expect(prompt).toContain('Duration: ~32 min');
  });

  it('strips emoji from titles', () => {
    expect(stripEmoji('📊 Q4 渠道目标')).toBe('Q4 渠道目标');
    expect(stripEmoji('✅  Done ✨')).toBe('Done');
  });

  it('orders speakers by how much they said and leaves out anonymous ones', () => {
    expect(speakersByTalk(lines)).toEqual(['Alex Chen', 'ying huang', 'Mina Sato']);
  });

  it('snaps a time to the nearest line within a minute, otherwise gives up', () => {
    const offsets = [0, 134, 1000];
    expect(snapToTranscript(1010, offsets)).toBe(1000);
    expect(snapToTranscript(500, offsets)).toBeNull();
    expect(snapToTranscript('12', offsets)).toBeNull();
  });
});

describe('normalizeSummary', () => {
  it('keeps placeable points, fixes section order and ends, and checks owners', () => {
    const summary = normalizeSummary(
      {
        topic: '🚀 EMEA 渠道 Q4',
        overview: '确认了 Q4 目标。',
        sections: [
          {
            title: 'Q4 渠道目标',
            startSec: 1000,
            speaker: 'alex chen',
            points: [
              { text: '法兰克福先认证', sec: 1170 },
              { text: '每家至少两个案例', sec: 1002 },
              { text: '编出来的一条', sec: 600 },
            ],
          },
          { title: '渠道现状', startSec: 0, speaker: 'Nobody', points: [{ text: '德法贡献 62%', sec: 0 }] },
          { title: '没有要点的节', startSec: 1470, points: [] },
          { title: '', startSec: 1470, points: [{ text: 'x', sec: 1470 }] },
        ],
        todos: [
          { task: '发出伙伴目标表', owner: 'Alex Chen', due: '周五前', sec: 1875 },
          { task: '把回放发给缺席的伙伴', owner: '小王', due: null, sec: 1470 },
          { task: '找个外部顾问', owner: 'Bob', due: 'null', sec: 1470 },
          { task: '没有时间的待办', owner: null, due: null },
        ],
      },
      lines,
    );
    expect(summary).not.toBeNull();
    const s = summary!;
    expect(s.topic).toBe('EMEA 渠道 Q4');
    expect(s.speakers[0]).toBe('Alex Chen');
    expect(s.sections.map((x) => x.title)).toEqual(['渠道现状', 'Q4 渠道目标']);
    expect(s.sections[0]).toMatchObject({ startSec: 0, endSec: 1000, speaker: 'ying huang' });
    expect(s.sections[1].speaker).toBe('Alex Chen');
    expect(s.sections[1].points).toEqual([
      { text: '每家至少两个案例', sec: 1000 },
      { text: '法兰克福先认证', sec: 1166 },
    ]);
    expect(s.sections[1].endSec).toBe(1900);
    expect(s.todos).toEqual([
      { task: '把回放发给缺席的伙伴', owner: '小王', due: null, sec: 1470 },
      { task: '找个外部顾问', owner: null, due: null, sec: 1470 },
      { task: '发出伙伴目标表', owner: 'Alex Chen', due: '周五前', sec: 1870 },
    ]);
    expect(sectionContent(s.sections[1])).toBe('每家至少两个案例\n法兰克福先认证');
  });

  it('drops the closing full stop of points and tasks', () => {
    const s = normalizeSummary(
      {
        sections: [{ title: 'A', startSec: 0, points: [{ text: '德法贡献 62%。', sec: 0 }, { text: 'Nordics grow.', sec: 134 }] }],
        todos: [{ task: '发出目标表。', owner: null, due: null, sec: 1870 }],
      },
      lines,
    )!;
    expect(s.sections[0].points.map((p) => p.text)).toEqual(['德法贡献 62%', 'Nordics grow']);
    expect(s.todos[0].task).toBe('发出目标表');
  });

  it('keeps assignments in to-dos only, dropping a section that just repeats them', () => {
    const s = normalizeSummary(
      {
        sections: [
          { title: '目标', startSec: 1000, points: [{ text: '每家两个案例', sec: 1000 }] },
          { title: '分工', startSec: 1800, points: [{ text: 'Alex 周五前发目标表', sec: 1870 }, { text: '回放谁来发待定', sec: 1474 }] },
        ],
        todos: [
          { task: '发出伙伴目标表', owner: 'Alex Chen', due: '周五前', sec: 1870 },
          { task: '把回放发给缺席的伙伴', owner: null, due: null, sec: 1470 },
        ],
      },
      lines,
    )!;
    expect(s.sections.map((x) => x.title)).toEqual(['目标']);
    expect(s.todos).toHaveLength(2);
  });

  it('returns null when no section survives', () => {
    expect(normalizeSummary({ sections: [{ title: 'x', points: [{ text: 'y', sec: 9999 }] }] }, lines)).toBeNull();
    expect(normalizeSummary('not json', lines)).toBeNull();
  });
});

describe('aiFailureReason', () => {
  it('names timeouts, HTTP errors and anything else', () => {
    const timeout = new Error('aborted');
    timeout.name = 'TimeoutError';
    expect(aiFailureReason(timeout)).toBe('timeout');
    expect(aiFailureReason(Object.assign(new Error('x'), { status: 503 }))).toBe('HTTP 503');
    expect(aiFailureReason(new Error('socket hang up'))).toBe('error');
    expect(aiFailureReason(null)).toBe('error');
  });
});
