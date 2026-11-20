/**
 * Pure helpers of the AI Notes replay stage (lib/NotesReplayStage.tsx): which caption is "now" on
 * the full timeline, which section the clock is in, how a slide's content is revealed over its
 * time, and how a narration is cut into subtitle lines. No React, no DOM.
 */
import { speakSeconds } from '@/lib/meetingPresentation';

export interface CaptionLine {
  id: number;
  speakerName: string;
  content: string;
  offsetSeconds: number | null;
}

export interface CaptionSection {
  title: string;
  startSec: number;
  endSec: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const CJK = /[぀-ヿ㐀-鿿가-힯＀-￯　-〿]/;

// ── time ─────────────────────────────────────────────────────────────────────

/** 75 → "1:15", 3725 → "1:02:05". Never negative, never NaN. */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** A length for a sentence: seconds below one minute, else whole minutes (rounded, at least 1). */
export function roughDuration(seconds: number): { unit: 'sec' | 'min'; n: number } {
  const total = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (total < 60) return { unit: 'sec', n: Math.max(1, Math.round(total)) };
  return { unit: 'min', n: Math.max(1, Math.round(total / 60)) };
}

/** The minutes of the meeting a stretch covers, counted from 1 ("minute 1" is the first minute). */
export function minuteRange(startSec: number | null, endSec: number | null): { from: number; to: number } | null {
  if (startSec === null || !Number.isFinite(startSec)) return null;
  const from = Math.floor(Math.max(0, startSec) / 60) + 1;
  const end = endSec !== null && Number.isFinite(endSec) ? Math.max(startSec, endSec) : startSec;
  // A stretch that ends exactly on a minute boundary doesn't reach into the next minute.
  const to = Math.max(from, Math.ceil(Math.max(0, end) / 60));
  return { from, to };
}

// ── people ───────────────────────────────────────────────────────────────────

/** Avatar letters: "Ana Lima" → "AL", "张伟" → "张", "" → "?". */
export function initials(name: string): string {
  const clean = (name || '').trim();
  if (!clean) return '?';
  const first = Array.from(clean)[0];
  if (CJK.test(first)) return first;
  const words = clean.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 1) return Array.from(words[0]).slice(0, 1).join('').toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[words.length - 1])[0]).toUpperCase();
}

// ── the full timeline ────────────────────────────────────────────────────────

/** Lines that have a time, in time order (the stage ignores lines it cannot place). */
export function timedLines<T extends CaptionLine>(lines: T[]): (T & { offsetSeconds: number })[] {
  return lines
    .filter((line): line is T & { offsetSeconds: number } =>
      typeof line.offsetSeconds === 'number' && Number.isFinite(line.offsetSeconds) && line.content.trim() !== '')
    .sort((a, b) => a.offsetSeconds - b.offsetSeconds);
}

/** Seconds a line stays "being said" when nothing follows it: time to say it, plus a breath. */
export function lineHoldSeconds(content: string): number {
  return clamp(speakSeconds(content) * 1.25 + 3, 4, 40);
}

export interface CaptionMoment<T> {
  /** Index in the timed lines of the line last started, -1 before the first line */
  index: number;
  previous: T | null;
  /** The line being said; null before the first line */
  current: T | null;
  next: T | null;
  /** The current line was finished a while ago and nobody has spoken since */
  quiet: boolean;
  /** Seconds until the next line starts; null when there is none */
  nextIn: number | null;
}

/**
 * captionAt — what the caption stage shows at `time`
 *
 * A line is current from its time until the next line starts. When the next line is far away the
 * line goes `quiet` once it has had time to be said, so stale words don't sit on screen.
 *
 * @param lines  output of timedLines()
 */
export function captionAt<T extends CaptionLine & { offsetSeconds: number }>(lines: T[], time: number): CaptionMoment<T> {
  const t = Number.isFinite(time) ? time : 0;
  let lo = 0;
  let hi = lines.length - 1;
  let index = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].offsetSeconds <= t) {
      index = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const current = index >= 0 ? lines[index] : null;
  const next = index + 1 < lines.length ? lines[index + 1] : null;
  return {
    index,
    previous: index > 0 ? lines[index - 1] : null,
    current,
    next,
    quiet: current !== null && t - current.offsetSeconds > lineHoldSeconds(current.content),
    nextIn: next ? Math.max(0, next.offsetSeconds - t) : null,
  };
}

/**
 * sectionAt — the section the clock is in
 *
 * @returns index of the last section that has started (-1 before the first, or with none) and how
 *          far through it the clock is (0 to 1)
 */
export function sectionAt(sections: CaptionSection[], time: number): { index: number; progress: number } {
  let index = -1;
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].startSec <= time) index = i;
  }
  if (index < 0) return { index, progress: 0 };
  const section = sections[index];
  // A section lasts until the next one starts, whatever its own end says (they may leave gaps).
  const end = Math.max(section.endSec, index + 1 < sections.length ? sections[index + 1].startSec : section.endSec);
  const span = end - section.startSec;
  return { index, progress: span > 0 ? clamp((time - section.startSec) / span, 0, 1) : 1 };
}

// ── revealing a slide ────────────────────────────────────────────────────────

/**
 * revealCount — how many of `total` items are showing at `progress` through a slide
 *
 * Items appear one at a time, evenly, between `from` and `to` (fractions of the slide): the first
 * at `from`, the last by `to` at the latest.
 */
export function revealCount(progress: number, total: number, from = 0.1, to = 0.8): number {
  if (total <= 0) return 0;
  if (progress < from) return 0;
  if (progress >= to || to <= from) return total;
  return Math.min(total, Math.floor(((progress - from) / (to - from)) * total) + 1);
}

/** The agenda item in the spotlight at `progress`: each item gets an equal share of the slide. */
export function spotlightIndex(progress: number, total: number): number {
  if (total <= 0) return -1;
  return clamp(Math.floor(clamp(progress, 0, 1) * total), 0, total - 1);
}

// ── the narration as subtitles ───────────────────────────────────────────────

export interface NarrationChunk {
  /** The subtitle line */
  text: string;
  /** Its pieces in order (words with their spaces, or single CJK characters); join('') === text */
  tokens: string[];
  /** Position of this chunk's first character in the whole narration */
  start: number;
}

/** Words (each with its trailing space) and single CJK characters; punctuation stays attached. */
export function narrationTokens(value: string): string[] {
  const tokens: string[] = [];
  for (const word of value.match(/\S+\s*/g) ?? []) {
    if (!CJK.test(word)) {
      tokens.push(word);
      continue;
    }
    let run = '';
    for (const ch of Array.from(word)) {
      if (CJK.test(ch)) {
        // Closing punctuation belongs to the character before it.
        if (/[，。、！？；：」』）】,.!?;:)\]]/.test(ch) && tokens.length && !run) {
          tokens[tokens.length - 1] += ch;
          continue;
        }
        if (run) {
          tokens.push(run);
          run = '';
        }
        tokens.push(ch);
      } else if (/\s/.test(ch)) {
        if (run) {
          tokens.push(run + ch);
          run = '';
        } else if (tokens.length) {
          tokens[tokens.length - 1] += ch;
        }
      } else if (/[,.!?;:)\]]/.test(ch) && !run && tokens.length) {
        tokens[tokens.length - 1] += ch;
      } else {
        run += ch;
      }
    }
    if (run) tokens.push(run);
  }
  return tokens;
}

/** How wide a piece of text reads: a CJK character counts double a Latin one. */
function readWidth(value: string): number {
  let width = 0;
  for (const ch of Array.from(value)) width += CJK.test(ch) ? 2 : 1;
  return width;
}

/** Cuts tokens into `parts` runs of about the same reading width; `pull` is how much nearer a cut after a comma counts. */
function splitBalanced(tokens: string[], parts: number, pull: number): string[][] {
  const widths = tokens.map(readWidth);
  const total = widths.reduce((a, b) => a + b, 0);
  const cuts: number[] = [];
  for (let k = 1; k < parts; k++) {
    const target = (total * k) / parts;
    let best = -1;
    let bestCost = Infinity;
    let seen = 0;
    for (let i = 0; i < tokens.length - 1; i++) {
      seen += widths[i];
      if (i + 1 <= (cuts[cuts.length - 1] ?? 0)) continue;
      const cost = Math.abs(seen - target) - (/[,;:，；：、]\s*$/.test(tokens[i]) ? pull : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = i + 1;
      }
    }
    if (best > 0) cuts.push(best);
  }
  const out: string[][] = [];
  let from = 0;
  for (const cut of [...cuts, tokens.length]) {
    if (cut > from) out.push(tokens.slice(from, cut));
    from = cut;
  }
  return out;
}

/**
 * narrationChunks — a narration cut into subtitle lines
 *
 * Whole sentences share a line while they fit. A sentence too long for one line is cut into
 * parts of about the same length, at a comma when one is near, so that no line reads wider than
 * `maxWidth` (Latin characters; a CJK character counts as two).
 */
export function narrationChunks(value: string, maxWidth = 110): NarrationChunk[] {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const width = (list: string[]) => list.reduce((sum, token) => sum + readWidth(token), 0);

  const sentences: string[][] = [];
  let run: string[] = [];
  for (const token of narrationTokens(clean)) {
    run.push(token);
    if (/[.!?。！？]["'”’」』)]?\s*$/.test(token)) {
      sentences.push(run);
      run = [];
    }
  }
  if (run.length) sentences.push(run);

  const pieces: string[][] = [];
  for (const sentence of sentences) {
    const w = width(sentence);
    if (w <= maxWidth) {
      pieces.push(sentence);
      continue;
    }
    let parts = Math.ceil(w / maxWidth);
    let cut = splitBalanced(sentence, parts, maxWidth * 0.3);
    // The pull towards a comma made a part too long: cut evenly, into more parts if it must be.
    while (cut.some((part) => width(part) > maxWidth) && parts < sentence.length) {
      cut = splitBalanced(sentence, parts, 0);
      if (cut.some((part) => width(part) > maxWidth)) parts += 1;
    }
    pieces.push(...cut);
  }

  const lines: string[][] = [];
  for (const piece of pieces) {
    const last = lines[lines.length - 1];
    if (last && width(last) + width(piece) <= maxWidth) lines[lines.length - 1] = last.concat(piece);
    else lines.push(piece);
  }

  let start = 0;
  return lines.map((tokens) => {
    const text = tokens.join('');
    const chunk = { text, tokens, start };
    start += text.length;
    return chunk;
  });
}

export interface NarrationMoment {
  /** The subtitle line showing; -1 when there is no narration */
  chunk: number;
  /** How many of that line's tokens have been said */
  spoken: number;
}

/**
 * narrationAt — the subtitle line and the words said so far
 *
 * @param fraction  how far through saying the whole narration (0 to 1)
 */
export function narrationAt(chunks: NarrationChunk[], fraction: number): NarrationMoment {
  if (chunks.length === 0) return { chunk: -1, spoken: 0 };
  const widths = chunks.map((chunk) => chunk.tokens.map(readWidth));
  const total = widths.reduce((sum, list) => sum + list.reduce((a, b) => a + b, 0), 0);
  const target = clamp(fraction, 0, 1) * total;
  // A token counts as said once the voice is halfway through it.
  let said = 0;
  let seen = 0;
  for (const w of widths.flat()) {
    if (seen + w / 2 > target) break;
    seen += w;
    said += 1;
  }
  // The line holding the last said token: a finished line stays until the next one's first word.
  let before = 0;
  for (let c = 0; c < chunks.length; c++) {
    const size = chunks[c].tokens.length;
    if (said <= before + size || c === chunks.length - 1) return { chunk: c, spoken: Math.min(size, said - before) };
    before += size;
  }
  return { chunk: 0, spoken: 0 };
}

/** The fraction of the narration said once the voice reached character `charIndex` of it. */
export function narrationFractionAtChar(chunks: NarrationChunk[], charIndex: number): number {
  if (chunks.length === 0) return 0;
  const lastChunk = chunks[chunks.length - 1];
  const length = lastChunk.start + lastChunk.text.length;
  return length > 0 ? clamp(charIndex / length, 0, 1) : 0;
}

// ── the voice ────────────────────────────────────────────────────────────────

/** BCP 47 tag of the voice for a presentation's language ('zh' | 'en' | 'ja' | 'ko'). */
export function voiceLang(language: string): string {
  const key = (language || '').toLowerCase().slice(0, 2);
  return ({ zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR' } as Record<string, string>)[key] ?? 'en-US';
}

/**
 * pickVoice — the installed voice to narrate in `lang`
 *
 * Exact tag first (zh-CN), then the same language (zh-TW), preferring a local voice; null when
 * the device has none for the language (the browser then uses its default).
 */
export function pickVoice<V extends { lang: string; localService?: boolean; default?: boolean }>(voices: V[], lang: string): V | null {
  const norm = (value: string) => value.replace('_', '-').toLowerCase();
  const wanted = norm(lang);
  const base = wanted.split('-')[0];
  const score = (voice: V) => {
    const tag = norm(voice.lang || '');
    let points = 0;
    if (tag === wanted) points = 4;
    else if (tag.split('-')[0] === base) points = 2;
    else return 0;
    return points + (voice.localService ? 1 : 0) + (voice.default ? 0.5 : 0);
  };
  let best: V | null = null;
  let bestScore = 0;
  for (const voice of voices) {
    const s = score(voice);
    if (s > bestScore) {
      best = voice;
      bestScore = s;
    }
  }
  return best;
}
