import { describe, expect, it } from 'vitest';
import { buildReplayWriting, writingShot, writingTranscript } from '@/lib/replayWriting';
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

  it('uses text only for ungrounded sections and advances through screenshots within grounded sections', () => {
    const shots = [
      { url: 'first', startMs: 10_000, endMs: 15_000 },
      { url: 'second', startMs: 16_000, endMs: 19_000 },
    ];
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
