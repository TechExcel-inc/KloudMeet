import { describe, expect, it } from 'vitest';
import { buildReplayWriting, writingShot, writingSourceSeconds, writingSpeakers, writingSpeakerLanes, writingNarrationSpeakerLanes, writingTranscript } from '@/lib/replayWriting';
import { replaySpeakerResolver } from '@/lib/replaySpeakerIdentity';
import { presentationPlan } from '@/lib/meetingPresentation';

const transcript = [
  { speakerName: 'Avery', offsetSeconds: 10, content: 'We will move the launch to Friday.' },
  { speakerName: 'Casey', offsetSeconds: 18, content: 'I will update the launch checklist.' },
];

describe('AI Write presentations', () => {
  it('uses the written paragraph verbatim as narration and grounds its timestamp', () => {
    const text = 'Avery moved the launch to Friday, and Casey will update the launch checklist.';
    const writing = buildReplayWriting({
      title: 'Launch recap',
      sections: [{ title: 'Launch date', text, startSec: 10, endSec: 18 }],
    }, transcript, 'Meeting');
    expect(writing?.slides[0]).toMatchObject({ narration: text, startSec: 10, endSec: 18 });
    expect(presentationPlan(writing!).totalSeconds).toBeGreaterThan(4);
    expect(writingTranscript(transcript)).toContain('[18] Casey:');
  });

  it('shows distinct original speakers with transcript lines in the section range', () => {
    const lines = [...transcript, { ...transcript[0], offsetSeconds: 12 },
      { ...transcript[1], offsetSeconds: null, speakerName: 'Unknown time' }];
    expect(writingSpeakers({ startSec: 10, endSec: 18 }, lines)).toEqual(['Avery', 'Casey']);
    expect(writingSpeakers({ startSec: 10, endSec: null }, lines)).toEqual(['Avery']);
    expect(writingSpeakers({ startSec: null, endSec: null }, lines)).toEqual([]);
  });

  it('rebuilds the speaker chart for each write and counts overlapping source ranges once', () => {
    const lanes: { name: string; segments: [number, number][] }[] = [
      { name: 'Avery', segments: [[2, 7], [5, 10]] },
      { name: 'Casey', segments: [[12, 20]] },
    ];
    expect(writingSpeakerLanes([{ startSec: 4, endSec: 7 }, { startSec: 6, endSec: 8 }], lanes, 30))
      .toEqual([{ name: 'Avery', segments: [[4, 8]] }]);
    expect(writingSpeakerLanes([{ startSec: 14, endSec: 18 }], lanes, 30))
      .toEqual([{ name: 'Casey', segments: [[14, 18]] }]);
    expect(writingSpeakerLanes([{ startSec: null, endSec: null }], lanes, 30)).toEqual([]);
  });

  it('uses account identity and cited transcript lines instead of nearby speech', () => {
    const resolve = replaySpeakerResolver([
      { id: 1, displayName: 'guifu', teamMember: { id: 101, fullName: 'Gui Fu', username: 'guifu' } },
      { id: 2, displayName: 'David', teamMember: { id: 102, fullName: 'David Lin', username: 'david' } },
      { id: 3, displayName: 'David', teamMember: { id: 103, fullName: 'David Chen', username: 'dchen' } },
    ]);
    expect(resolve({ speakerMemberId: 101, speakerName: '贵妇' })).toEqual({ key: 'member:101', name: 'Gui Fu' });
    expect(resolve({ speakerName: ' GUIFU ' })).toEqual({ key: 'member:101', name: 'Gui Fu' });
    expect(resolve({ speakerName: 'David' })).toEqual({ key: 'transcript:david', name: 'David' });

    const lines = [
      { id: 1, speakerName: 'Gui Fu', speakerKey: 'member:101', offsetSeconds: 10, content: 'VM storage is fixed.' },
      { id: 2, speakerName: 'David Lin', speakerKey: 'member:102', offsetSeconds: 11, content: 'I worked on something else.' },
      { id: 3, speakerName: 'Gui Fu', speakerKey: 'member:101', offsetSeconds: 12, content: 'We moved the VM.' },
    ];
    const write = buildReplayWriting({ sections: [{
      title: 'VM work', text: 'Gui Fu fixed VM storage and moved the VM.',
      startSec: 10, endSec: 12, sourceLineIds: [1, 3, 999, 3], author: 'ead-pilot',
    }] }, lines, 'Meeting');
    expect(write?.slides[0].sourceLineIds).toEqual([1, 3]);
    expect(write?.slides[0].author).toBeUndefined();
    expect(writingSpeakers(write!.slides[0], lines)).toEqual(['Gui Fu']);
    expect(writingSpeakers(write!.slides[0], [lines[1]])).toEqual([]);
  });

  it('puts the original speakers on the AI timeline in the selected write’s section order', () => {
    const lines = transcript.map((line, index) => ({ ...line, id: index + 1 }));
    const avery = { startSec: 10, endSec: 10, sourceLineIds: [1] };
    const casey = { startSec: 18, endSec: 18, sourceLineIds: [2] };
    expect(writingNarrationSpeakerLanes([casey, avery], lines, [0, 5, 12])).toEqual([
      { key: 'Casey', name: 'Casey', segments: [[0, 5]] },
      { key: 'Avery', name: 'Avery', segments: [[5, 12]] },
    ]);
    expect(writingNarrationSpeakerLanes([avery], lines, [0, 7])).toEqual([
      { key: 'Avery', name: 'Avery', segments: [[0, 7]] },
    ]);
  });

  it('uses text only for ungrounded sections and advances through screenshots within grounded sections', () => {
    const shots = [
      { url: 'first', startMs: 10_000, endMs: 15_000 },
      { url: 'second', startMs: 16_000, endMs: 19_000 },
    ];
    expect(writingSourceSeconds({ startSec: 10, endSec: 18 }, 0.5)).toBe(14);
    expect(writingSourceSeconds({ startSec: 10, endSec: null }, 0.5)).toBe(10);
    expect(writingShot(shots, { startSec: 10, endSec: 18 }, 0)?.url).toBe('first');
    expect(writingShot(shots, { startSec: 10, endSec: 18 }, 0.7)).toBeNull();
    expect(writingShot(shots, { startSec: 10, endSec: 18 }, 0.9)?.url).toBe('second');
    expect(writingShot(shots, { startSec: null, endSec: null }, 0)).toBeNull();
    const ungrounded = buildReplayWriting({
      sections: [{ title: 'Launch date', text: 'Launch moved to Friday.', startSec: 9999, endSec: 10000 }],
    }, transcript, 'Meeting');
    expect(ungrounded?.slides[0]).toMatchObject({ startSec: null, endSec: null });
  });
});
