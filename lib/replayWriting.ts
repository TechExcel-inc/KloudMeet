import { meetingLanguage, PRESENTATION_VERSION, speakSeconds, type MeetingPresentation, type PresentationSlide } from '@/lib/meetingPresentation';
import { snapToTranscript, stripEmoji, type SummaryTranscriptLine } from '@/lib/meetingSummary';
import { shotAt, type ShareShot } from '@/lib/shareShot';

export const WRITING_LENGTHS = [3, 5, 10, 20] as const;
export type WritingLength = (typeof WRITING_LENGTHS)[number];

export const WRITING_VOICES = ['marin', 'cedar'] as const;
export type WritingVoice = (typeof WRITING_VOICES)[number];
export const DEFAULT_WRITING_VOICE: WritingVoice = 'marin';
export const WRITING_NAME_LIMIT = 200;
export const WRITING_DESCRIPTION_LIMIT = 1500;
export const WRITING_SECTION_LIMIT = 2400;

export function isWritingVoice(value: unknown): value is WritingVoice {
  return WRITING_VOICES.some(voice => voice === value);
}

export function isWritingId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:legacy-(?:3|5|10|20)|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i.test(value);
}

export interface WritingBrief {
  name: string;
  description: string;
  minutes: WritingLength;
}

export interface ReplayWriting extends WritingBrief {
  id: string;
  voice: WritingVoice;
  status: 'GENERATING' | 'READY' | 'FAILED';
  presentation: MeetingPresentation | null;
}

export function isWritingLength(value: unknown): value is WritingLength {
  return WRITING_LENGTHS.some((minutes) => minutes === value);
}

export function writingTranscript(lines: SummaryTranscriptLine[], budget = 55_000): string {
  const rows = lines.map((line) => `[${line.offsetSeconds ?? '?'}] ${line.speakerName}: ${line.content.trim().slice(0, 2000)}`);
  const stride = Math.max(1, Math.ceil(rows.reduce((size, row) => size + row.length + 1, 0) / budget));
  return rows.filter((_, index) => index % stride === 0).join('\n').slice(0, budget);
}

export function buildReplayWriting(raw: unknown, lines: SummaryTranscriptLine[], meetingTitle: string): MeetingPresentation | null {
  if (!raw || typeof raw !== 'object' || !('sections' in raw) || !Array.isArray(raw.sections)) return null;
  const clean = (value: unknown, limit: number) => typeof value === 'string' ? stripEmoji(value).trim().slice(0, limit) : '';
  const offsets = lines.flatMap((line) => line.offsetSeconds === null ? [] : [line.offsetSeconds]).sort((a, b) => a - b);
  const slides = raw.sections.slice(0, 42).flatMap((section: Record<string, unknown> | null): PresentationSlide[] => {
    if (!section || typeof section !== 'object') return [];
    const title = clean(section.title, 140);
    const narration = clean(section.text, WRITING_SECTION_LIMIT);
    if (!title || !narration) return [];
    const startSec = snapToTranscript(section.startSec, offsets);
    const endSec = snapToTranscript(section.endSec, offsets);
    return [{
      kind: 'topic', title, narration, bullets: [], speaker: null, quote: null,
      startSec, endSec: startSec !== null && endSec !== null && endSec >= startSec ? endSec : startSec,
      importance: 3,
      // Keep slides long enough for the narration at normal speed, including a short transition.
      seconds: Math.max(4, Math.ceil(speakSeconds(narration) + 2)),
    }];
  });
  if (!slides.length) return null;

  return {
    version: PRESENTATION_VERSION,
    title: 'title' in raw ? clean(raw.title, 140) || meetingTitle : meetingTitle,
    language: meetingLanguage(lines),
    speakers: [],
    meetingSeconds: offsets[offsets.length - 1] ?? 0,
    slides,
  };
}

export function writingSourceSeconds(
  slide: Pick<PresentationSlide, 'startSec' | 'endSec'>,
  progress: number,
): number | null {
  if (slide.startSec === null) return null;
  const span = Math.max(0, (slide.endSec ?? slide.startSec) - slide.startSec);
  return slide.startSec + span * Math.min(1, Math.max(0, progress));
}

export function writingShot(
  shots: readonly ShareShot[],
  slide: Pick<PresentationSlide, 'startSec' | 'endSec'>,
  progress: number,
): ShareShot | null {
  const seconds = writingSourceSeconds(slide, progress);
  return seconds === null ? null : shotAt(shots, seconds * 1000);
}
