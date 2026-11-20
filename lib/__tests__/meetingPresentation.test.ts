import { describe, expect, it } from 'vitest';
import {
  buildPresentation,
  buildPresentationPrompt,
  meetingLanguage,
  presentationPlan,
  readPresentation,
  slideAt,
  slideSeconds,
  speakSeconds,
  type MeetingPresentation,
} from '@/lib/meetingPresentation';
import type { StructuredSummary, SummaryTranscriptLine } from '@/lib/meetingSummary';

const line = (offsetSeconds: number, speakerName: string, content: string): SummaryTranscriptLine => ({ offsetSeconds, speakerName, content });

const lines: SummaryTranscriptLine[] = [
  line(0, 'Ana', 'Can everyone hear me? Let us wait a minute for Ben.'),
  line(60, 'Ana', 'First, the launch. Marketing needs two more weeks for the campaign.'),
  line(95, 'Ben', 'Then we move the launch to March the third, I am fine with that.'),
  line(130, 'Ana', 'Agreed, March the third it is.'),
  line(300, 'Chen', 'On pricing, the survey says most teams would pay twelve dollars a seat.'),
  line(340, 'Ben', 'Twelve is fine but we need a free tier for small teams.'),
  line(600, 'Chen', 'For hiring, we have two offers out for backend engineers.'),
  line(640, 'Ana', 'Ben, can you send the onboarding plan by Friday?'),
  line(650, 'Ben', 'Yes, I will send it by Friday.'),
  line(900, 'Ana', 'Thanks everyone, see you next week.'),
];

const summary: StructuredSummary = {
  topic: 'Launch date, pricing and hiring',
  overview: 'The team reviewed the launch. The launch moves to March 3. Pricing stays at twelve dollars with a free tier.',
  speakers: ['Ana', 'Ben', 'Chen'],
  sections: [
    { title: 'Getting started', startSec: 0, endSec: 60, speaker: 'Ana', points: [{ text: 'Waited for Ben to join', sec: 0 }] },
    { title: 'Launch date', startSec: 60, endSec: 300, speaker: 'Ana', points: [
      { text: 'Marketing needs two more weeks', sec: 60 },
      { text: 'Launch moves to March 3', sec: 95 },
    ] },
    { title: 'Pricing', startSec: 300, endSec: 600, speaker: 'Chen', points: [
      { text: 'Survey supports twelve dollars a seat', sec: 300 },
      { text: 'A free tier is needed for small teams', sec: 340 },
    ] },
    { title: 'Hiring', startSec: 600, endSec: 900, speaker: 'Chen', points: [{ text: 'Two backend offers are out', sec: 600 }] },
  ],
  todos: [{ task: 'Send the onboarding plan', owner: 'Ben', due: 'by Friday', sec: 650 }],
};

const direction = {
  hook: 'The launch moves to March 3 and pricing is settled.',
  sections: [
    { index: 0, headline: 'Waiting to start', narration: 'People joined.', importance: 1, skip: true, quote: null },
    { index: 1, headline: 'Launch moves to March 3', narration: 'Ana said marketing needs two more weeks, and Ben agreed to move the launch to March the third.', importance: 5, skip: false,
      quote: { text: 'Then we move the launch to March the third, I am fine with that.', sec: 95 } },
    { index: 2, headline: 'Twelve dollars a seat, with a free tier', narration: 'Chen shared the survey and Ben asked for a free tier.', importance: 4, skip: false,
      quote: { text: 'Everyone loves our pricing more than anything.', sec: 300 } },
    { index: 3, headline: 'Two backend offers are out', narration: 'Chen reported on hiring.', importance: 2, skip: false, quote: null },
  ],
  decisions: [
    { text: 'Launch on March 3.', sec: 131 },
    { text: 'Launch on March 3.', sec: 131 },
    { text: 'Open an office on the moon', sec: 5000 },
  ],
  closing: 'Ben sends the onboarding plan by Friday.',
};

const build = (dir: unknown = direction) => buildPresentation('Weekly sync', summary, dir, lines) as MeetingPresentation;

describe('buildPresentation', () => {
  it('opens with the hook, lists the topics, and ends with decisions, actions and a closing line', () => {
    const presentation = build();
    expect(presentation.slides.map((slide) => slide.kind)).toEqual(['title', 'agenda', 'topic', 'topic', 'topic', 'decisions', 'actions', 'closing']);
    expect(presentation).toMatchObject({ version: 1, title: 'Launch date, pricing and hiring', language: 'en', speakers: ['Ana', 'Ben', 'Chen'], meetingSeconds: 900 });
    expect(presentation.slides[0].narration).toBe('The launch moves to March 3 and pricing is settled.');
    expect(presentation.slides[1].bullets.map((bullet) => bullet.text)).toEqual([
      'Launch moves to March 3', 'Twelve dollars a seat, with a free tier', 'Two backend offers are out',
    ]);
    expect(presentation.slides[7].narration).toBe('Ben sends the onboarding plan by Friday.');
  });

  it('leaves out what the model marked as not part of the meeting', () => {
    expect(build().slides.some((slide) => slide.title === 'Waiting to start' || slide.title === 'Getting started')).toBe(false);
  });

  it('uses the takeaway as the headline and keeps the section\'s timed points', () => {
    const launch = build().slides[2];
    expect(launch).toMatchObject({
      title: 'Launch moves to March 3', speaker: 'Ana', startSec: 60, endSec: 300, importance: 5,
      bullets: [{ text: 'Marketing needs two more weeks', sec: 60 }, { text: 'Launch moves to March 3', sec: 95 }],
    });
  });

  it('shows a quote only when someone really said it, with who and when', () => {
    const [launch, pricing] = build().slides.slice(2, 4);
    expect(launch.quote).toEqual({ text: 'Then we move the launch to March the third, I am fine with that.', speaker: 'Ben', sec: 95 });
    expect(pricing.quote).toBeNull();
  });

  it('finds a real quote even when the model gave the wrong time for it', () => {
    const moved = { ...direction, sections: direction.sections.map((section) =>
      section.index === 1 ? { ...section, quote: { text: '“Agreed, March the third it is.”', sec: 60 } } : section) };
    expect(build(moved).slides[2].quote).toEqual({ text: 'Agreed, March the third it is.', speaker: 'Ana', sec: 130 });
  });

  it('keeps each decision once, placed on a real line, and drops what it cannot place', () => {
    const decisions = build().slides.find((slide) => slide.kind === 'decisions');
    expect(decisions?.bullets).toEqual([{ text: 'Launch on March 3', sec: 130 }]);
  });

  it('lists actions with who and by when', () => {
    const actions = build().slides.find((slide) => slide.kind === 'actions');
    expect(actions?.bullets).toEqual([{ text: 'Send the onboarding plan', sec: 650, owner: 'Ben', due: 'by Friday' }]);
  });

  it('still makes a presentation when the model gave no direction', () => {
    const presentation = build(null);
    expect(presentation.slides.map((slide) => slide.kind)).toEqual(['title', 'agenda', 'topic', 'topic', 'topic', 'topic', 'actions', 'closing']);
    const launch = presentation.slides[3];
    expect(launch.title).toBe('Launch date');
    expect(launch.narration).toBe('Marketing needs two more weeks. Launch moves to March 3');
    expect(launch.quote).toBeNull();
    expect(presentation.slides[0].narration).toBe(summary.overview);
    expect(presentation.slides[7].narration).toBe('Pricing stays at twelve dollars with a free tier.');
    // More key points means more important.
    expect(presentation.slides[3].importance).toBeGreaterThan(presentation.slides[5].importance);
  });

  it('ignores a direction that is not what was asked for', () => {
    for (const bad of ['text', 42, [], { sections: 'none', decisions: {} }, { sections: [{ index: 'one' }, null] }]) {
      expect(build(bad).slides.filter((slide) => slide.kind === 'topic')).toHaveLength(4);
    }
  });

  it('has nothing to present without sections', () => {
    expect(buildPresentation('Weekly sync', { ...summary, sections: [] }, direction, lines)).toBeNull();
  });

  it('is far shorter than the meeting', () => {
    const plan = presentationPlan(build());
    expect(plan.totalSeconds).toBeGreaterThan(40);
    expect(plan.totalSeconds).toBeLessThan(900 / 4);
  });
});

describe('timing', () => {
  it('estimates how long a line takes to say, in either script', () => {
    expect(speakSeconds('one two three four five')).toBeCloseTo(2, 1);
    expect(speakSeconds('我们把发布日期改到三月三号')).toBeCloseTo(13 / 4.2, 1);
    expect(speakSeconds('')).toBe(0);
  });

  it('gives a slide the time to hear and read it, within limits for its kind', () => {
    const base = { title: 'T', speaker: null, quote: null, startSec: null, endSec: null, importance: 3, bullets: [] };
    expect(slideSeconds({ ...base, kind: 'title', narration: '' })).toBe(5);
    expect(slideSeconds({ ...base, kind: 'topic', narration: 'word '.repeat(400) })).toBe(45);
    const short = slideSeconds({ ...base, kind: 'topic', narration: 'A short line about the launch date.' });
    const long = slideSeconds({ ...base, kind: 'topic', narration: 'A short line about the launch date.', bullets: [{ text: 'One more point to read here', sec: 1 }],
      quote: { text: 'And a quote that also takes a while to read out', speaker: 'Ana', sec: 2 } });
    expect(long).toBeGreaterThan(short);
  });

  it('detects the language the meeting was held in', () => {
    expect(meetingLanguage(lines)).toBe('en');
    expect(meetingLanguage([line(0, 'A', '我们把发布日期改到三月三号，定价 twelve dollars')])).toBe('zh');
    expect(meetingLanguage([line(0, 'A', '発売日を三月三日に変更します')])).toBe('ja');
    expect(meetingLanguage([line(0, 'A', '출시일을 3월 3일로 변경합니다')])).toBe('ko');
    expect(meetingLanguage([])).toBe('en');
  });
});

describe('presentationPlan', () => {
  it('plays every slide in order, each starting where the last ended', () => {
    const presentation = build();
    const plan = presentationPlan(presentation);
    expect(plan.slides.map((slide) => slide.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    let at = 0;
    for (const slide of plan.slides) {
      expect(slide.startAt).toBeCloseTo(at, 5);
      at += slide.seconds;
    }
    expect(plan.totalSeconds).toBeCloseTo(at, 5);
  });

  it('the short version keeps the most important topics, in meeting order, and trims them', () => {
    const presentation = build();
    const short = presentationPlan(presentation, 'short');
    expect(short.slides.map((slide) => slide.kind)).toEqual(['title', 'topic', 'topic', 'decisions', 'actions', 'closing']);
    expect(short.slides.filter((slide) => slide.kind === 'topic').map((slide) => slide.title)).toEqual([
      'Launch moves to March 3', 'Twelve dollars a seat, with a free tier',
    ]);
    expect(short.slides[1].quote).toBeNull();
    expect(short.totalSeconds).toBeLessThan(presentationPlan(presentation).totalSeconds);
  });

  it('a faster pace shortens every slide, never below two seconds', () => {
    const presentation = build();
    const normal = presentationPlan(presentation, 'full', 1);
    const fast = presentationPlan(presentation, 'full', 2);
    expect(fast.totalSeconds).toBeLessThan(normal.totalSeconds * 0.6);
    expect(presentationPlan(presentation, 'full', 99).slides.every((slide) => slide.seconds >= 2)).toBe(true);
  });

  it('finds the slide for a moment in the plan', () => {
    const plan = presentationPlan(build());
    expect(slideAt(plan, 0)).toEqual({ position: 0, progress: 0 });
    const third = plan.slides[2];
    expect(slideAt(plan, third.startAt + third.seconds / 2)).toEqual({ position: 2, progress: 0.5 });
    expect(slideAt(plan, plan.totalSeconds + 100).position).toBe(plan.slides.length - 1);
    expect(slideAt(plan, plan.totalSeconds + 100).progress).toBe(1);
    expect(slideAt(plan, -5)).toEqual({ position: 0, progress: 0 });
    expect(slideAt({ slides: [], totalSeconds: 0 }, 3)).toEqual({ position: 0, progress: 0 });
  });
});

describe('stored presentations', () => {
  it('reads back what was built, and refuses anything else', () => {
    const presentation = build();
    expect(readPresentation(JSON.parse(JSON.stringify(presentation)))).toEqual(presentation);
    expect(readPresentation(null)).toBeNull();
    expect(readPresentation({ ...presentation, version: 99 })).toBeNull();
    expect(readPresentation({ ...presentation, slides: [] })).toBeNull();
    expect(readPresentation({ ...presentation, slides: [{ kind: 'topic' }] })).toBeNull();
  });
});

describe('buildPresentationPrompt', () => {
  it('gives the model the numbered sections and the transcript', () => {
    const prompt = buildPresentationPrompt('Weekly sync', summary, lines);
    expect(prompt).toContain('#1 [60-300] Launch date (Ana)');
    expect(prompt).toContain('- [95] Launch moves to March 3');
    expect(prompt).toContain('[95] Ben: Then we move the launch to March the third');
  });

  it('thins a very long transcript evenly instead of cutting its end off', () => {
    const long = Array.from({ length: 2000 }, (_, i) => line(i * 3, i % 2 ? 'Ana' : 'Ben', `This is line number ${i} of a long meeting`));
    const prompt = buildPresentationPrompt('Long', summary, long);
    expect(prompt.length).toBeLessThan(26000);
    expect(prompt).toContain('line number 0 of');
    expect(prompt).toMatch(/line number 19\d\d of/);
  });
});
