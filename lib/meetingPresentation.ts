/**
 * AI meeting presentation: the meeting retold as a short set of slides that plays by itself.
 *
 * It is made from the structured summary (lib/meetingSummary.ts) and one more model call that
 * "directs" it: which parts matter, a takeaway headline and a spoken line for each, a quote worth
 * showing, what was decided. Everything the model returns is checked against the transcript
 * before it is used, and a presentation can still be built when that call fails.
 *
 * A presentation is much shorter than the meeting: each slide plays for as long as it takes to
 * say and read it, not for as long as the topic took. The player can shorten it further.
 *
 * Pure: no I/O. Shared by the generator, the API and the replay page.
 */
import {
  snapToTranscript,
  stripEmoji,
  type StructuredSummary,
  type SummaryTranscriptLine,
} from '@/lib/meetingSummary';

export const PRESENTATION_VERSION = 1;

export type SlideKind = 'title' | 'agenda' | 'topic' | 'decisions' | 'actions' | 'closing';

export interface SlideBullet {
  text: string;
  /** Seconds into the meeting where this was said; null when it isn't one moment */
  sec: number | null;
  /** Shown before the text on an action: who took it on, and by when */
  owner?: string | null;
  due?: string | null;
}

export interface SlideQuote {
  text: string;
  speaker: string;
  sec: number;
}

export interface PresentationSlide {
  kind: SlideKind;
  title: string;
  /** What the presenter says while the slide shows (also read aloud when the voice is on) */
  narration: string;
  bullets: SlideBullet[];
  /** Main speaker of a topic */
  speaker: string | null;
  quote: SlideQuote | null;
  /** The stretch of the real meeting a topic covers */
  startSec: number | null;
  endSec: number | null;
  /** 1 (background) to 5 (a decision, a commitment, a number): what the short version keeps */
  importance: number;
  /** Seconds the slide plays at normal pace */
  seconds: number;
}

export interface MeetingPresentation {
  version: number;
  title: string;
  /** 'zh' | 'en' | 'ja' | 'ko': the language of the meeting, for the voice */
  language: string;
  /** People who spoke, most talk first */
  speakers: string[];
  /** Length of the meeting itself, in seconds */
  meetingSeconds: number;
  slides: PresentationSlide[];
}

/** What the replay page gets about a meeting's presentation. */
export interface PresentationState {
  status: 'NONE' | 'GENERATING' | 'READY' | 'FAILED';
  content: MeetingPresentation | null;
}

export const NO_PRESENTATION: PresentationState = { status: 'NONE', content: null };

// ── the model's direction ────────────────────────────────────────────────────

export const PRESENTATION_SYSTEM_PROMPT = `You turn a meeting into a short presentation for someone who missed it.
You get the meeting's sections (already summarized, each with its key points) and transcript lines.
Each transcript line starts with [seconds] and the speaker's name.

Return ONLY a JSON object:
{
  "hook": "one sentence that opens the presentation: what this meeting settled or was about",
  "sections": [
    { "index": 0,
      "headline": "the takeaway of this section, as a statement",
      "narration": "what a presenter would say about this section, 1-3 sentences",
      "importance": 3,
      "skip": false,
      "quote": { "text": "one sentence copied from a transcript line", "sec": 0 } }
  ],
  "decisions": [ { "text": "something that was decided", "sec": 0 } ],
  "closing": "one sentence: what happens next, or the one thing to remember"
}

Rules:
- Write in the same language as the transcript. No emoji anywhere.
- One entry per section, with the same "index" as given. Do not add or merge sections.
- "headline" states the result, not the subject: "Launch moves to March", not "Launch date". At most 12 words (or 24 Chinese characters).
- "narration" is spoken aloud: plain sentences, names of who said or decided what, at most 60 words (or 110 Chinese characters). Say what was concluded, not everything that was said.
- "importance": 5 for a decision, commitment, deadline or number that others need; 3 for a useful discussion; 1 for background. Use the whole range.
- "skip": true only for greetings, sound checks, waiting for people, and talk unrelated to the meeting.
- "quote": one sentence copied word for word from a transcript line in that section, that shows the point in the speaker's own words, with that line's [seconds]. Use null when no line stands out. Never rewrite or shorten a quote.
- "decisions": only what was clearly decided or agreed, each with the [seconds] of the line where it was settled. Empty array when nothing was decided.
- Use only what the transcript says. Never invent facts, names, numbers or times.`;

const EXCERPT_CHARS = 20000;

/** The sections and the transcript the model directs from. Long transcripts are thinned evenly. */
export function buildPresentationPrompt(
  meetingName: string,
  summary: StructuredSummary,
  lines: SummaryTranscriptLine[],
): string {
  const sections = summary.sections
    .map((section, index) =>
      `#${index} [${section.startSec}-${section.endSec}] ${section.title}${section.speaker ? ` (${section.speaker})` : ''}\n` +
      section.points.map((point) => `- [${point.sec}] ${point.text}`).join('\n'))
    .join('\n\n');
  const all = lines.map((line) => `[${Math.round(line.offsetSeconds ?? 0)}] ${line.speakerName || 'Unknown'}: ${line.content}`);
  const total = all.reduce((sum, line) => sum + line.length + 1, 0);
  // Keep every n-th line of a long meeting so each section still has lines to quote from.
  const step = Math.max(1, Math.ceil(total / EXCERPT_CHARS));
  const transcript = all.filter((_, index) => index % step === 0).join('\n');
  return `Meeting: ${meetingName}\nTopic: ${summary.topic}\nOverview: ${summary.overview}\n\nSections:\n\n${sections}\n\nTranscript${step > 1 ? ` (every ${step}th line)` : ''}:\n\n${transcript}\n\nDirect the presentation.`;
}

// ── building it ──────────────────────────────────────────────────────────────

const text = (value: unknown): string => (typeof value === 'string' ? stripEmoji(value) : '');
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/** 'zh' | 'ja' | 'ko' | 'en' from what the meeting was spoken in. */
export function meetingLanguage(lines: SummaryTranscriptLine[]): string {
  const sample = lines.slice(0, 400).map((line) => line.content).join('');
  const count = (pattern: RegExp) => (sample.match(pattern) ?? []).length;
  const kana = count(/[぀-ヿ]/g);
  const hangul = count(/[가-힯]/g);
  const han = count(/[一-鿿]/g);
  const latin = count(/[a-zA-Z]/g);
  if (kana > 0 && kana * 8 >= han) return 'ja';
  if (hangul > latin / 4 && hangul >= han) return 'ko';
  if (han > latin / 4) return 'zh';
  return 'en';
}

/** Seconds it takes to say a line at a calm presenting pace. */
export function speakSeconds(value: string): number {
  const cjk = (value.match(/[぀-ヿ一-鿿가-힯]/g) ?? []).length;
  const words = (value.replace(/[぀-ヿ一-鿿가-힯]/g, ' ').match(/[\p{L}\p{N}]+/gu) ?? []).length;
  return cjk / 4.2 + words / 2.5;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** How long a slide plays: time to hear the narration, plus time to read what is on it. */
export function slideSeconds(slide: Omit<PresentationSlide, 'seconds'>): number {
  const read = slide.bullets.reduce((sum, bullet) => sum + 0.8 + speakSeconds(bullet.text) * 0.35, 0);
  const quote = slide.quote ? 1.5 + speakSeconds(slide.quote.text) * 0.8 : 0;
  const base = speakSeconds(slide.narration) + read + quote + 1.5;
  const limits: Record<SlideKind, [number, number]> = {
    title: [5, 14], agenda: [4, 12], topic: [7, 45], decisions: [5, 30], actions: [5, 30], closing: [4, 14],
  };
  const [min, max] = limits[slide.kind];
  return Math.round(clamp(base, min, max));
}

function quoteFor(raw: unknown, lines: SummaryTranscriptLine[], offsets: number[], startSec: number, endSec: number): SlideQuote | null {
  const data = record(raw);
  const wanted = text(data.text);
  if (wanted.length < 6) return null;
  const squash = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const needle = squash(wanted.replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, ''));
  const sec = snapToTranscript(data.sec, offsets);
  // The line the model points at, else any line in the section that really contains the words.
  const inSection = lines.filter((line) => line.offsetSeconds !== null && line.offsetSeconds >= startSec - 60 && line.offsetSeconds <= endSec + 60);
  const said = (sec === null ? [] : lines.filter((line) => line.offsetSeconds === sec)).concat(inSection)
    .find((line) => squash(line.content).includes(needle));
  if (!said || said.offsetSeconds === null) return null;
  const speaker = (said.speakerName || '').trim();
  if (!speaker || /^(unknown|speaker 1)$/i.test(speaker)) return null;
  return { text: wanted.replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, ''), speaker, sec: said.offsetSeconds };
}

/**
 * What the presenter says over the list slides, in the meeting's language. These are fixed lines,
 * not the model's: they only count what is on the slide.
 */
const LIST_LINES: Record<string, { agenda: string; decisions: (n: number) => string; actions: (n: number) => string }> = {
  en: {
    agenda: 'Here is what the meeting covered.',
    decisions: (n) => (n === 1 ? 'One thing was decided.' : `${n} things were decided.`),
    actions: (n) => (n === 1 ? 'One action item came out of it.' : `${n} action items came out of it.`),
  },
  zh: {
    agenda: '这次会议讨论了下面几件事。',
    decisions: (n) => `会议做出了 ${n} 项决定。`,
    actions: (n) => `会后有 ${n} 项待办。`,
  },
  ja: {
    agenda: 'この会議で話し合った内容です。',
    decisions: (n) => `${n} 件のことが決まりました。`,
    actions: (n) => `${n} 件のアクションがあります。`,
  },
  ko: {
    agenda: '이번 회의에서 다룬 내용입니다.',
    decisions: (n) => `${n}가지가 결정되었습니다.`,
    actions: (n) => `할 일 ${n}개가 정해졌습니다.`,
  },
};

const lastSentence = (value: string) => {
  const parts = value.split(/(?<=[。.!?！？])\s*/u).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : value.trim();
};

/**
 * buildPresentation — the slides of a meeting
 *
 * @param summary    the meeting's structured summary (sections with timed points, to-dos)
 * @param direction  the model's direction (PRESENTATION_SYSTEM_PROMPT), or null when that call
 *                   failed: then headlines are the section titles and the narration is the points
 * @param lines      the transcript, to check quotes and times against
 * @returns null when there is nothing to present
 */
export function buildPresentation(
  meetingName: string,
  summary: StructuredSummary,
  direction: unknown,
  lines: SummaryTranscriptLine[],
): MeetingPresentation | null {
  if (summary.sections.length === 0) return null;
  const data = record(direction);
  const directed = new Map<number, Record<string, unknown>>();
  for (const item of Array.isArray(data.sections) ? data.sections : []) {
    const entry = record(item);
    if (typeof entry.index === 'number' && Number.isInteger(entry.index)) directed.set(entry.index, entry);
  }
  const offsets = lines
    .map((line) => line.offsetSeconds)
    .filter((sec): sec is number => typeof sec === 'number' && Number.isFinite(sec))
    .sort((a, b) => a - b);
  const meetingSeconds = offsets.length ? offsets[offsets.length - 1] : 0;
  const make = (slide: Omit<PresentationSlide, 'seconds'>): PresentationSlide => ({ ...slide, seconds: slideSeconds(slide) });
  const language = meetingLanguage(lines);
  const say = LIST_LINES[language] ?? LIST_LINES.en;
  const plain = { speaker: null, quote: null, startSec: null, endSec: null };

  const topics: PresentationSlide[] = [];
  const mostPoints = Math.max(...summary.sections.map((section) => section.points.length));
  summary.sections.forEach((section, index) => {
    const entry = directed.get(index) ?? {};
    if (entry.skip === true && summary.sections.length > 1) return;
    const importance = typeof entry.importance === 'number' && Number.isFinite(entry.importance)
      ? clamp(Math.round(entry.importance), 1, 5)
      // No direction: a section with more key points mattered more.
      : clamp(Math.round(1 + (4 * section.points.length) / mostPoints), 1, 5);
    topics.push(make({
      kind: 'topic',
      title: text(entry.headline) || section.title,
      narration: text(entry.narration) || section.points.map((point) => point.text).join('. '),
      bullets: section.points.slice(0, 4).map((point) => ({ text: point.text, sec: point.sec })),
      speaker: section.speaker,
      quote: quoteFor(entry.quote, lines, offsets, section.startSec, section.endSec),
      startSec: section.startSec,
      endSec: section.endSec,
      importance,
    }));
  });
  if (topics.length === 0) return null;

  const slides: PresentationSlide[] = [];
  slides.push(make({
    ...plain,
    kind: 'title',
    title: summary.topic || meetingName,
    narration: text(data.hook) || summary.overview || summary.topic || meetingName,
    bullets: [],
    importance: 5,
  }));
  if (topics.length >= 3) {
    slides.push(make({
      ...plain,
      kind: 'agenda',
      title: '',
      narration: say.agenda,
      bullets: topics.map((topic) => ({ text: topic.title, sec: topic.startSec })),
      importance: 2,
    }));
  }
  slides.push(...topics);

  const decisions: SlideBullet[] = [];
  for (const item of Array.isArray(data.decisions) ? data.decisions : []) {
    const entry = record(item);
    const decided = text(entry.text).replace(/[。.]+$/u, '');
    const sec = snapToTranscript(entry.sec, offsets);
    if (decided && sec !== null && !decisions.some((d) => d.text === decided)) decisions.push({ text: decided, sec });
  }
  if (decisions.length) {
    const shown = decisions.slice(0, 5);
    slides.push(make({ ...plain, kind: 'decisions', title: '', narration: say.decisions(shown.length), bullets: shown, importance: 5 }));
  }
  if (summary.todos.length) {
    const todos = summary.todos.slice(0, 6);
    slides.push(make({
      ...plain,
      kind: 'actions',
      title: '',
      narration: say.actions(todos.length),
      bullets: todos.map((todo) => ({ text: todo.task, sec: todo.sec, owner: todo.owner, due: todo.due })),
      importance: 5,
    }));
  }
  const closing = text(data.closing) || (summary.overview ? lastSentence(summary.overview) : '');
  if (closing) {
    slides.push(make({ ...plain, kind: 'closing', title: '', narration: closing, bullets: [], importance: 4 }));
  }

  return {
    version: PRESENTATION_VERSION,
    title: summary.topic || meetingName,
    language,
    speakers: summary.speakers,
    meetingSeconds,
    slides,
  };
}

/** A stored value that is a presentation this code can play, else null. */
export function readPresentation(value: unknown): MeetingPresentation | null {
  const data = record(value);
  if (data.version !== PRESENTATION_VERSION || !Array.isArray(data.slides) || data.slides.length === 0) return null;
  const ok = data.slides.every((slide) => {
    const s = record(slide);
    return typeof s.kind === 'string' && typeof s.title === 'string' && typeof s.narration === 'string'
      && Array.isArray(s.bullets) && typeof s.seconds === 'number';
  });
  return ok ? (value as MeetingPresentation) : null;
}

// ── playing it ───────────────────────────────────────────────────────────────

/** 'short': the highlights. 'full': every slide. */
export type PresentationLength = 'short' | 'full';

export interface PlannedSlide extends PresentationSlide {
  /** Position in the presentation's own slides */
  index: number;
  /** Seconds from the start of this plan to this slide */
  startAt: number;
}

export interface PresentationPlan {
  slides: PlannedSlide[];
  totalSeconds: number;
}

/**
 * presentationPlan — the slides to play and when each starts
 *
 * The short version keeps the opening, the most important half of the topics (at least two, in
 * meeting order) with two points each and no quote, the decisions, the first actions, and the
 * closing. `pace` above 1 plays faster.
 */
export function presentationPlan(
  presentation: MeetingPresentation,
  length: PresentationLength = 'full',
  pace = 1,
): PresentationPlan {
  let chosen = presentation.slides.map((slide, index) => ({ ...slide, index }));
  if (length === 'short') {
    const topics = chosen.filter((slide) => slide.kind === 'topic');
    const keep = Math.max(Math.min(2, topics.length), Math.ceil(topics.length / 2));
    const kept = new Set(
      [...topics].sort((a, b) => b.importance - a.importance || a.index - b.index).slice(0, keep).map((slide) => slide.index),
    );
    chosen = chosen
      .filter((slide) => slide.kind !== 'agenda' && (slide.kind !== 'topic' || kept.has(slide.index)))
      .map((slide) => {
        if (slide.kind === 'topic') {
          const trimmed = { ...slide, bullets: slide.bullets.slice(0, 2), quote: null };
          return { ...trimmed, seconds: slideSeconds(trimmed) };
        }
        if (slide.kind === 'actions' || slide.kind === 'decisions') {
          const trimmed = { ...slide, bullets: slide.bullets.slice(0, 3) };
          return { ...trimmed, seconds: slideSeconds(trimmed) };
        }
        return slide;
      });
  }
  const speed = clamp(pace, 0.5, 3);
  let at = 0;
  const slides = chosen.map((slide) => {
    const seconds = Math.max(2, Math.round((slide.seconds / speed) * 10) / 10);
    const planned = { ...slide, seconds, startAt: at };
    at = Math.round((at + seconds) * 10) / 10;
    return planned;
  });
  return { slides, totalSeconds: at };
}

/** The slide playing at `elapsed` seconds into a plan, and how far through it (0 to 1). */
export function slideAt(plan: PresentationPlan, elapsed: number): { position: number; progress: number } {
  if (plan.slides.length === 0) return { position: 0, progress: 0 };
  const t = clamp(elapsed, 0, plan.totalSeconds);
  let position = plan.slides.length - 1;
  for (let i = 0; i < plan.slides.length; i++) {
    if (t < plan.slides[i].startAt + plan.slides[i].seconds) {
      position = i;
      break;
    }
  }
  const slide = plan.slides[position];
  return { position, progress: clamp((t - slide.startAt) / slide.seconds, 0, 1) };
}
