import { describe, expect, it } from 'vitest';
import { availableWritingSuggestions, buildReplayWriting, writingLanguageOf, writingShot, writingSourceSeconds, writingSpeakers, writingSpeakerLanes, writingNarrationSpeakerLanes, writingTranscript } from '@/lib/replayWriting';
import { replaySpeakerResolver } from '@/lib/replaySpeakerIdentity';
import { presentationPlan } from '@/lib/meetingPresentation';

const transcript = [
  { speakerName: 'Avery', offsetSeconds: 10, content: 'We will move the launch to Friday.' },
  { speakerName: 'Casey', offsetSeconds: 18, content: 'I will update the launch checklist.' },
];

describe('AI Write presentations', () => {
  it('keeps automatic language for legacy settings and uses the specified output language for narration', () => {
    expect(writingLanguageOf({ language: 'en' })).toBe('auto');
    expect(writingLanguageOf({ languagePreference: 'ko' })).toBe('ko');
    const writing = buildReplayWriting({
      sections: [{ title: '출시 일정', text: '출시일을 금요일로 변경합니다.', startSec: 10, endSec: 18 }],
    }, transcript, 'Meeting', false, 'ko');
    expect(writing).toMatchObject({ language: 'ko', slides: [{ narration: '출시일을 금요일로 변경합니다.', startSec: 10, endSec: 18 }] });
  });
  it('keeps remaining suggestions and hides generated suggestions even after they are renamed', () => {
    const suggestions = [
      { id: 'recap', name: 'Meeting recap', description: 'Summarize the meeting.', minutes: 5 as const },
      { id: 'legacy', name: 'Action items', description: 'List next steps.', minutes: 3 as const },
      { id: 'risks', name: 'Open risks', description: 'Identify unresolved risks.', minutes: 3 as const },
    ];
    const saved = { voice: 'marin' as const, status: 'READY' as const, presentation: null };
    expect(availableWritingSuggestions(suggestions, [
      { ...suggestions[0], ...saved, name: 'Renamed recap', description: 'A generated description.' },
      { ...suggestions[1], ...saved, id: 'earlier-write', name: 'Action  Items' },
    ])).toEqual([suggestions[2]]);
  });

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
    expect(resolve({ speakerMemberId: 101, speakerName: '贵妇' })).toEqual({ key: 'member:101', name: 'guifu', verifiedAttendee: true });
    expect(resolve({ speakerName: ' GUIFU ' })).toEqual({ key: 'member:101', name: 'guifu', verifiedAttendee: true });
    expect(resolve({ speakerName: 'David' })).toEqual({ key: 'transcript:david', name: 'David', verifiedAttendee: false });

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

  it('renders only verified attendee tokens and excludes unverified people from the speaker chart', () => {
    const lines = [
      { ...transcript[0], id: 1, speakerKey: 'member:1', speakerName: 'avery', verifiedAttendee: true },
      { ...transcript[1], id: 2, speakerKey: 'transcript:uncertain', verifiedAttendee: false },
    ];
    expect(writingTranscript(lines, 55000, true)).toContain('[[speaker:member:1]]');
    expect(writingTranscript(lines, 55000, true)).toContain('Unidentified speaker');
    const writing = buildReplayWriting({ title: 'Update from [[speaker:member:1]]', sections: [{
      title: 'Update from [[speaker:member:1]]',
      text: '[[speaker:member:1]] shared an update with [[speaker:member:99]].',
      sourceLineIds: [1, 2],
    }] }, lines, 'Meeting');
    expect(writing?.title).toBe('Update from avery');
    expect(writing?.slides[0].narration).toBe('avery shared an update with an attendee.');
    expect(writingSpeakers(writing!.slides[0], lines)).toEqual(['avery']);
    expect(writingNarrationSpeakerLanes(writing!.slides, lines, [0, 10]).map(lane => lane.name)).toEqual(['avery']);
  });

  it('places verified handoffs on the narration timeline and rejects unsupported speaker claims', () => {
    const lines = [
      { ...transcript[0], id: 1, speakerKey: 'member:1', speakerName: 'tierenz', verifiedAttendee: true },
      { ...transcript[1], id: 2, speakerKey: 'member:2', speakerName: 'guifu', verifiedAttendee: true },
    ];
    const writing = buildReplayWriting({ sections: [
      { title: 'Shutdown plan', text: '[[speaker:member:1]] said a shutdown might be needed.',
        speakerKey: 'member:1', sourceLineIds: [1] },
      { title: 'Reply', text: '[[speaker:member:2]] said the shutdown would be fine.',
        speakerKey: 'member:2', sourceLineIds: [2] },
      { title: 'Unverified', text: 'A colleague should be notified.', speakerKey: 'member:1', sourceLineIds: [2] },
      { title: 'Transition', text: 'The discussion then ended.', sourceLineIds: [1, 2] },
    ] }, lines, 'Meeting', true);
    const slides = writing!.slides;
    expect(slides[0].title).toBe('tierenz：Shutdown plan');
    expect(slides[1].narration).toBe('guifu said the shutdown would be fine.');
    expect(slides.map(slide => writingSpeakers(slide, lines))).toEqual([['tierenz'], ['guifu'], [], []]);
    expect(writingNarrationSpeakerLanes(slides, lines, [0, 8, 12, 15, 18])).toEqual([
      { key: 'member:1', name: 'tierenz', segments: [[0, 8]] },
      { key: 'member:2', name: 'guifu', segments: [[8, 12]] },
    ]);
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
