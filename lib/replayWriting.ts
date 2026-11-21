import { isAttendeeSpeakerKey } from '@/lib/replaySpeakerIdentity';
import { meetingLanguage, PRESENTATION_VERSION, speakSeconds, type MeetingPresentation, type PresentationSlide } from '@/lib/meetingPresentation';
import { snapToTranscript, stripEmoji, type SummaryTranscriptLine } from '@/lib/meetingSummary';
import { shotAt, type ShareShot } from '@/lib/shareShot';

export const WRITING_LENGTHS = [3, 5, 10, 20] as const;
export type WritingLength = (typeof WRITING_LENGTHS)[number];

export const WRITING_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'] as const;
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
  sourceId?: string;
  status: 'GENERATING' | 'READY' | 'FAILED';
  presentation: MeetingPresentation | null;
}

export function isWritingLength(value: unknown): value is WritingLength {
  return WRITING_LENGTHS.some((minutes) => minutes === value);
}

export type WritingTranscriptLine = SummaryTranscriptLine & { id?: number; speakerKey?: string; verifiedAttendee?: boolean };

export function writingTranscript(lines: WritingTranscriptLine[], budget = 55_000, useAttendeeTokens = false): string {
  const rows = lines.map((line) => `[${line.offsetSeconds ?? '?'}] ${line.id === undefined ? '' : `[line ${line.id}] `}${useAttendeeTokens ? (line.verifiedAttendee && isAttendeeSpeakerKey(line.speakerKey) ? `[[speaker:${line.speakerKey}]]` : 'Unidentified speaker') : line.speakerName}: ${line.content.trim().slice(0, 2000)}`);
  const stride = Math.max(1, Math.ceil(rows.reduce((size, row) => size + row.length + 1, 0) / budget));
  return rows.filter((_, index) => index % stride === 0).join('\n').slice(0, budget);
}

export function writingAttendeeRoster(lines: readonly WritingTranscriptLine[]) {
  return new Map(lines.flatMap(line => line.verifiedAttendee && isAttendeeSpeakerKey(line.speakerKey)
    ? [[line.speakerKey, line.speakerName] as const] : []));
}

export function resolveWritingNames(text: string, roster: ReadonlyMap<string, string>, language: string): string {
  const unnamed = { zh: '一位与会者', ja: '参加者の一人', ko: '한 참석자' }[language] ?? 'an attendee';
  return text.replace(/\[\[speaker:([^\]\n]*)\]\]/gi, (_, key: string) => roster.get(key.trim()) ?? unnamed);
}

export function buildReplayWriting(raw: unknown, lines: WritingTranscriptLine[], meetingTitle: string, requireAttribution = false): MeetingPresentation | null {
  if (!raw || typeof raw !== 'object' || !('sections' in raw) || !Array.isArray(raw.sections)) return null;
  const language = meetingLanguage(lines);
  const roster = writingAttendeeRoster(lines);
  const clean = (value: unknown, limit: number) => typeof value === 'string'
    ? stripEmoji(resolveWritingNames(value, roster, language)).trim().slice(0, limit) : '';
  const offsets = lines.flatMap((line) => line.offsetSeconds === null ? [] : [line.offsetSeconds]).sort((a, b) => a - b);
  const byId = new Map(lines.flatMap(line => line.id === undefined ? [] : [[line.id, line] as const]));
  const slides = raw.sections.slice(0, 42).flatMap((section: Record<string, unknown> | null): PresentationSlide[] => {
    if (!section || typeof section !== 'object') return [];
    const topic = clean(section.title, 140);
    const narration = clean(section.text, WRITING_SECTION_LIMIT);
    if (!topic || !narration) return [];
    const sourceLineIds = Array.isArray(section.sourceLineIds)
      ? [...new Set(section.sourceLineIds.filter((id): id is number => Number.isSafeInteger(id) && byId.has(id)))].slice(0, 120)
      : [];
    const key = typeof section.speakerKey === 'string' ? section.speakerKey : '';
    const name = roster.get(key);
    const attribution = name && sourceLineIds.some(id => byId.get(id)?.speakerKey === key)
      ? { key, name } : null;
    const title = attribution && ![`${attribution.name}：`, `${attribution.name}:`].some(prefix => topic.startsWith(prefix))
      ? `${attribution.name}：${topic}`.slice(0, 140) : topic;
    const sourceTimes = sourceLineIds.flatMap(id => {
      const time = byId.get(id)?.offsetSeconds;
      return time == null ? [] : [time];
    });
    const startSec = sourceTimes.length ? Math.min(...sourceTimes) : snapToTranscript(section.startSec, offsets);
    const endSec = sourceTimes.length ? Math.max(...sourceTimes) : snapToTranscript(section.endSec, offsets);
    return [{
      kind: 'topic', title, narration, bullets: [], speaker: attribution?.name ?? null, quote: null,
      ...(byId.size ? { sourceLineIds } : {}),
      ...(requireAttribution || 'speakerKey' in section ? { attribution } : {}),
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
    language,
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


type WritingSource = Pick<PresentationSlide, 'startSec' | 'endSec' | 'sourceLineIds' | 'attribution'>;

export function writingSourceLines<T extends WritingTranscriptLine>(slide: WritingSource, transcript: readonly T[]): T[] {
  if (Array.isArray(slide.sourceLineIds)) {
    const ids = new Set(slide.sourceLineIds);
    return transcript.filter(line => line.id !== undefined && ids.has(line.id));
  }
  const { startSec, endSec } = slide;
  if (startSec === null) return [];
  return transcript.filter(line => line.offsetSeconds !== null && line.offsetSeconds >= startSec &&
    line.offsetSeconds <= (endSec ?? startSec));
}

export function writingSpeakers(slide: WritingSource, transcript: readonly WritingTranscriptLine[]): string[] {
  if (slide.attribution !== undefined) return slide.attribution ? [slide.attribution.name] : [];
  const speakers = new Map<string, string>();
  for (const line of writingSourceLines(slide, transcript)) {
    if (line.verifiedAttendee === false) continue;
    const name = line.speakerName.trim();
    if (name && line.content.trim()) speakers.set(line.speakerKey ?? name, name);
  }
  return [...speakers.values()];
}

/** Intersect meeting speaker lanes with the source moments covered by a write. */
export function writingSpeakerLanes<T extends { segments: [number, number][] }>(
  slides: readonly Pick<PresentationSlide, 'startSec' | 'endSec'>[],
  lanes: readonly T[],
  meetingSeconds: number,
): T[] {
  const ranges = slides.flatMap(({ startSec, endSec }): [number, number][] => {
    if (startSec === null || startSec < 0 || startSec >= meetingSeconds) return [];
    const end = Math.min(meetingSeconds, Math.max(startSec + 1, endSec ?? startSec));
    return [[startSec, end]];
  }).sort(([a], [b]) => a - b);

  function merge(segments: [number, number][]): [number, number][] {
    const merged: [number, number][] = [];
    for (const [start, end] of segments) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    return merged;
  }

  const covered = merge(ranges);
  return lanes.flatMap(lane => {
    const overlaps = lane.segments.flatMap(([a, b]) => covered.flatMap(([start, end]): [number, number][] => {
      const from = Math.max(a, start);
      const to = Math.min(b, end);
      return from < to ? [[from, to]] : [];
    })).sort(([a], [b]) => a - b);
    return overlaps.length ? [{ ...lane, segments: merge(overlaps) }] : [];
  });
}

/** Project the source speakers onto the narrated sections, in playback order. */
export function writingNarrationSpeakerLanes(
  slides: readonly WritingSource[],
  transcript: readonly WritingTranscriptLine[],
  timestamps: readonly number[],
): { key: string; name: string; segments: [number, number][] }[] {
  const lanes = new Map<string, { key: string; name: string; segments: [number, number][] }>();
  slides.forEach((slide, index) => {
    const start = timestamps[index];
    const end = timestamps[index + 1];
    if (!(end > start)) return;
    if (slide.attribution !== undefined) {
      const speaker = slide.attribution;
      if (speaker) {
        const lane = lanes.get(speaker.key) ?? { ...speaker, segments: [] };
        lane.segments.push([start, end]);
        lanes.set(speaker.key, lane);
      }
      return;
    }
    const source = writingSourceLines(slide, transcript).filter(line => line.content.trim());
    const offsets = [...new Set(source.flatMap(line => line.offsetSeconds == null ? [] : [line.offsetSeconds]))]
      .sort((a, b) => a - b);
    const sourceStart = Math.min(slide.startSec ?? Infinity, offsets[0] ?? Infinity);
    const lastOffset = offsets[offsets.length - 1] ?? sourceStart;
    const sourceEnd = Math.max(slide.endSec ?? -Infinity, lastOffset + 1);
    const project = (time: number) => start + (end - start) * (time - sourceStart) / (sourceEnd - sourceStart);
    for (const line of source) {
      const name = line.speakerName.trim();
      if (!name || line.verifiedAttendee === false) continue;
      const key = line.speakerKey ?? name;
      const lane = lanes.get(key) ?? { key, name, segments: [] };
      const time = line.offsetSeconds;
      if (time == null && offsets.length) continue;
      const next = time == null ? undefined : offsets.find(offset => offset > time);
      const from = time == null || time === offsets[0] ? start : project(time);
      const to = next === undefined ? end : project(next);
      if (to > from) {
        lane.segments.push([from, to]);
        lanes.set(key, lane);
      }
    }
  });
  const total = timestamps[timestamps.length - 1] ?? 0;
  return writingSpeakerLanes([{ startSec: 0, endSec: total }], [...lanes.values()], total);
}
