/**
 * Structured AI meeting summary: topic, overview, sections of timed points, and to-dos.
 *
 * The model drafts it; normalizeSummary() then checks every time against the transcript and drops
 * what it can't place, so each point and to-do on the replay page jumps to something that was said.
 */

export interface SummaryPoint {
  text: string;
  /** Seconds into the meeting where this was said */
  sec: number;
}

export interface SummarySection {
  title: string;
  startSec: number;
  endSec: number;
  /** Main speaker of the section, or null when unclear */
  speaker: string | null;
  points: SummaryPoint[];
}

export interface SummaryTodo {
  task: string;
  /** Who agreed to do it; null when nobody was named */
  owner: string | null;
  /** Deadline as said ("by Friday"); null when none was given */
  due: string | null;
  sec: number;
}

export interface StructuredSummary {
  topic: string;
  overview: string;
  /** People who spoke, most talk first (from the transcript, not the model) */
  speakers: string[];
  sections: SummarySection[];
  todos: SummaryTodo[];
}

export interface SummaryTranscriptLine {
  offsetSeconds: number | null;
  speakerName: string;
  content: string;
}

/** How far (seconds) a model-given time may be from a transcript line and still count as that line. */
const SNAP_TOLERANCE_SEC = 60;

/** A section point this close (seconds) to a to-do is treated as the same assignment. */
const TODO_ECHO_SEC = 5;

/** Names that stand for "we don't know who" in transcripts. */
const ANONYMOUS_SPEAKERS = new Set(['', 'unknown', 'speaker 1']);

/**
 * A transcript longer than this (characters of prompt lines) is summarized in parts. Each part is
 * a smaller, faster call, so long meetings don't run into the provider timeout as one big request.
 */
export const SUMMARY_PART_CHARS = 24000;

/** Parts drafted at the same time. */
const SUMMARY_PART_CONCURRENCY = 3;

const WHOLE_SECTIONS_RULE = '- Split into 3-8 sections by topic, in time order. Each section has 1-5 points.';
const PART_SECTIONS_RULE =
  '- This transcript is one part of a longer meeting. Split this part into 1-4 sections by topic, in time order. Each section has 1-5 points. "topic" and "overview" describe this part only.';

function summarySystemPrompt(sectionsRule: string): string {
  return SUMMARY_SYSTEM_PROMPT_TEMPLATE.replace('{sectionsRule}', sectionsRule);
}

const SUMMARY_SYSTEM_PROMPT_TEMPLATE = `You are a professional meeting note-taker. Read the transcript and write the meeting summary.
Each transcript line starts with [seconds] and the speaker's name.

Return ONLY a JSON object:
{
  "topic": "one line: what the meeting was about",
  "overview": "2-4 sentences: the purpose, the key conclusions and decisions",
  "sections": [
    { "title": "short section title", "startSec": 0, "speaker": "main speaker of this section",
      "points": [ { "text": "one key point, one sentence", "sec": 0 } ] }
  ],
  "todos": [ { "task": "what will be done", "owner": "who agreed to do it or null", "due": "deadline as said or null", "sec": 0 } ]
}

Rules:
- Write in the same language as the transcript. No emoji anywhere.
{sectionsRule}
- Sections are about what was discussed and decided. Do not repeat to-dos or assignments as points, and do not add a section that only lists who does what; those go in "todos".
- Each point is one sentence of at most 60 characters (Chinese) or 25 words, stating a fact, decision or number that was said.
- "sec" and "startSec" must be the [seconds] of the transcript line the point comes from. Never invent a time.
- To-dos: only things someone clearly agreed or was asked to do. Owner is the speaker who took it on or the person named; if nobody was named use null. Due is the deadline in the speaker's words (e.g. "by Friday"); if none was said use null. Do not guess.
- One to-do per task: if the same task comes up more than once (offered, then confirmed, or asked again), merge it into one item with the earliest "sec" where it was taken on, the owner, and the clearest deadline that was said.
- If there are no to-dos, return an empty array.`;

export const SUMMARY_SYSTEM_PROMPT = summarySystemPrompt(WHOLE_SECTIONS_RULE);
export const SUMMARY_PART_SYSTEM_PROMPT = summarySystemPrompt(PART_SECTIONS_RULE);

/** The last step for a meeting summarized in parts: one topic and overview, one to-do list. */
export const SUMMARY_COMBINE_SYSTEM_PROMPT = `You are a professional meeting note-taker. A long meeting was summarized in parts.
You get the sections and to-dos of every part. Write the topic and overview of the whole meeting, and clean up the to-do list.

Return ONLY a JSON object:
{
  "topic": "one line: what the meeting was about",
  "overview": "2-4 sentences: the purpose, the key conclusions and decisions",
  "todos": [ { "task": "what will be done", "owner": "who agreed to do it or null", "due": "deadline as said or null", "sec": 0 } ]
}

Rules:
- Write in the same language as the notes. No emoji anywhere.
- Use only what the notes say. Never add facts, to-dos or times.
- To-dos: keep every task once. If the same task appears more than once, keep one item with the earliest "sec", its owner and the clearest deadline. Copy "sec" exactly from the notes.
- If there are no to-dos, return an empty array.`;

/** "[1000] Alex Chen: text", one transcript line of the prompt. */
function promptLine(line: SummaryTranscriptLine): string {
  return `[${Math.round(line.offsetSeconds ?? 0)}] ${line.speakerName || 'Unknown'}: ${line.content}`;
}

/** "[1000] Alex Chen: text" lines for the prompt. */
export function buildSummaryPrompt(meetingName: string, lines: SummaryTranscriptLine[]): string {
  const totalSec = lines.reduce((max, line) => Math.max(max, line.offsetSeconds ?? 0), 0);
  const body = lines.map(promptLine).join('\n');
  return `Meeting: ${meetingName}\nDuration: ~${Math.round(totalSec / 60)} min\nTranscript:\n\n${body}\n\nWrite the summary.`;
}

/**
 * Consecutive runs of lines of about the same size: as few runs as keep each near `maxChars` of
 * prompt text (give or take one line). One run when the whole transcript fits.
 */
export function splitTranscript<T extends SummaryTranscriptLine>(lines: T[], maxChars = SUMMARY_PART_CHARS): T[][] {
  const sizes = lines.map((line) => promptLine(line).length + 1);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= maxChars) return lines.length ? [lines] : [];
  const count = Math.ceil(total / maxChars);
  const parts: T[][] = Array.from({ length: count }, () => []);
  let before = 0;
  lines.forEach((line, idx) => {
    // A line belongs to the part its middle falls in
    const part = Math.min(count - 1, Math.floor(((before + sizes[idx] / 2) * count) / total));
    parts[part].push(line);
    before += sizes[idx];
  });
  return parts.filter((part) => part.length > 0);
}

/** The prompt for one part of a long meeting. */
export function buildPartPrompt(
  meetingName: string,
  part: SummaryTranscriptLine[],
  index: number,
  count: number,
): string {
  const minute = (line: SummaryTranscriptLine | undefined) => Math.round((line?.offsetSeconds ?? 0) / 60);
  const body = part.map(promptLine).join('\n');
  return `Meeting: ${meetingName}\nPart ${index + 1} of ${count} (minutes ${minute(part[0])}-${minute(part[part.length - 1])})\nTranscript:\n\n${body}\n\nWrite the summary of this part.`;
}

/** Sections and to-dos of every part's draft, in order. */
export function mergeSummaryParts(drafts: unknown[]): { sections: unknown[]; todos: unknown[] } {
  const sections: unknown[] = [];
  const todos: unknown[] = [];
  for (const draft of drafts) {
    if (!draft || typeof draft !== 'object') continue;
    const data = draft as Record<string, unknown>;
    if (Array.isArray(data.sections)) sections.push(...data.sections);
    if (Array.isArray(data.todos)) todos.push(...data.todos);
  }
  return { sections, todos };
}

/** The notes the combine step reads: each section with its points, then the to-dos. */
export function buildCombinePrompt(
  meetingName: string,
  lines: SummaryTranscriptLine[],
  merged: { sections: unknown[]; todos: unknown[] },
): string {
  const totalSec = lines.reduce((max, line) => Math.max(max, line.offsetSeconds ?? 0), 0);
  const sectionText = merged.sections
    .map((item) => {
      const section = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const points = (Array.isArray(section.points) ? section.points : [])
        .map((p) => (p && typeof p === 'object' ? text((p as Record<string, unknown>).text) : ''))
        .filter(Boolean);
      return `[${Number(section.startSec) || 0}] ${text(section.title)}\n${points.map((p) => `- ${p}`).join('\n')}`;
    })
    .join('\n\n');
  return `Meeting: ${meetingName}\nDuration: ~${Math.round(totalSec / 60)} min\n\nSections:\n\n${sectionText}\n\nTo-dos:\n${JSON.stringify(merged.todos)}\n\nWrite the topic, the overview and the cleaned to-do list.`;
}

/** One model call: the parsed JSON, which model wrote it, and why the first choice was skipped. */
export interface SummaryDraft {
  raw: unknown;
  model: string;
  fallbackReason: string | null;
}

export type SummaryCall = (system: string, prompt: string, maxTokens: number) => Promise<SummaryDraft>;

/**
 * The model's draft for a whole meeting. A short transcript is one call. A long one is drafted in
 * parts (a few at a time), then one small call writes the topic and overview and merges to-dos
 * that came up in more than one part. A provider failure only repeats that one call elsewhere.
 */
export async function draftSummary(
  meetingName: string,
  lines: SummaryTranscriptLine[],
  call: SummaryCall,
): Promise<SummaryDraft> {
  const parts = splitTranscript(lines);
  if (parts.length <= 1) return call(SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt(meetingName, lines), 6000);

  const drafts: SummaryDraft[] = new Array(parts.length);
  let next = 0;
  const worker = async () => {
    while (next < parts.length) {
      const idx = next++;
      drafts[idx] = await call(
        SUMMARY_PART_SYSTEM_PROMPT,
        buildPartPrompt(meetingName, parts[idx], idx, parts.length),
        3000,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(SUMMARY_PART_CONCURRENCY, parts.length) }, worker));

  const merged = mergeSummaryParts(drafts.map((draft) => draft.raw));
  const used = [...drafts];
  let head: Record<string, unknown> = {};
  try {
    const combined = await call(SUMMARY_COMBINE_SYSTEM_PROMPT, buildCombinePrompt(meetingName, lines, merged), 2000);
    used.push(combined);
    if (combined.raw && typeof combined.raw === 'object') head = combined.raw as Record<string, unknown>;
  } catch (e) {
    // The sections still stand; the page shows them without a topic and overview
    console.warn('[summary] combine step failed; keeping the parts as they are:', e);
  }
  return {
    raw: {
      topic: head.topic,
      overview: head.overview,
      sections: merged.sections,
      todos: Array.isArray(head.todos) ? head.todos : merged.todos,
    },
    model: [...new Set(used.map((draft) => draft.model))].join('+'),
    fallbackReason: used.find((draft) => draft.fallbackReason)?.fallbackReason ?? null,
  };
}

/** Strips emoji and pictographs a model may still prefix titles with. */
export function stripEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Speakers ordered by how much they said (characters), anonymous labels left out. */
export function speakersByTalk(lines: SummaryTranscriptLine[]): string[] {
  const talk = new Map<string, number>();
  for (const line of lines) {
    const name = (line.speakerName || '').trim();
    if (ANONYMOUS_SPEAKERS.has(name.toLowerCase())) continue;
    talk.set(name, (talk.get(name) ?? 0) + (line.content || '').length);
  }
  return [...talk.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

/** The transcript time nearest to `sec`, or null when none is within the tolerance. */
export function snapToTranscript(sec: unknown, offsets: number[]): number | null {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || offsets.length === 0) return null;
  let best = offsets[0];
  for (const offset of offsets) {
    if (Math.abs(offset - sec) < Math.abs(best - sec)) best = offset;
  }
  return Math.abs(best - sec) <= SNAP_TOLERANCE_SEC ? best : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? stripEmoji(value) : '';
}

/** A point or task without its closing full stop: the time link follows it on the page. */
function line(value: unknown): string {
  return text(value).replace(/[。.]+$/u, '');
}

/** The speaker with the most lines between two times, or null. */
function dominantSpeaker(lines: SummaryTranscriptLine[], startSec: number, endSec: number): string | null {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const at = line.offsetSeconds;
    if (at === null || at < startSec || at >= endSec) continue;
    const name = (line.speakerName || '').trim();
    if (ANONYMOUS_SPEAKERS.has(name.toLowerCase())) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Turns the model's JSON into a summary we can trust: times snapped to real transcript lines,
 * unplaceable points and to-dos dropped, owners kept only if that name appears in the meeting,
 * and points that only repeat a to-do left out of the sections. Returns null when nothing usable
 * is left.
 */
export function normalizeSummary(raw: unknown, lines: SummaryTranscriptLine[]): StructuredSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;

  const offsets = lines
    .map((line) => line.offsetSeconds)
    .filter((sec): sec is number => typeof sec === 'number' && Number.isFinite(sec))
    .sort((a, b) => a - b);
  const totalSec = offsets.length ? offsets[offsets.length - 1] : 0;
  const speakers = speakersByTalk(lines);
  const speakerByLower = new Map(speakers.map((name) => [name.toLowerCase(), name]));
  const allText = lines.map((line) => `${line.speakerName} ${line.content}`).join('\n').toLowerCase();

  const todos: SummaryTodo[] = [];
  for (const t of Array.isArray(data.todos) ? data.todos : []) {
    if (!t || typeof t !== 'object') continue;
    const todo = t as Record<string, unknown>;
    const task = line(todo.task);
    const sec = snapToTranscript(todo.sec, offsets);
    if (!task || sec === null) continue;
    const ownerRaw = text(todo.owner);
    const owner =
      ownerRaw && !/^(null|none|无|未知)$/i.test(ownerRaw) && allText.includes(ownerRaw.toLowerCase())
        ? (speakerByLower.get(ownerRaw.toLowerCase()) ?? ownerRaw)
        : null;
    const dueRaw = text(todo.due);
    const due = dueRaw && !/^(null|none|无)$/i.test(dueRaw) ? dueRaw : null;
    todos.push({ task, owner, due, sec });
  }
  todos.sort((a, b) => a.sec - b.sec);

  // A point said at the same moment as a to-do is that assignment again: it belongs in the to-dos
  const isTodoMoment = (sec: number) => todos.some((todo) => Math.abs(todo.sec - sec) <= TODO_ECHO_SEC);

  const sections: SummarySection[] = [];
  for (const item of Array.isArray(data.sections) ? data.sections : []) {
    if (!item || typeof item !== 'object') continue;
    const section = item as Record<string, unknown>;
    const title = text(section.title);
    if (!title) continue;

    const points: SummaryPoint[] = [];
    for (const p of Array.isArray(section.points) ? section.points : []) {
      if (!p || typeof p !== 'object') continue;
      const point = p as Record<string, unknown>;
      const pointText = line(point.text);
      const sec = snapToTranscript(point.sec, offsets);
      if (pointText && sec !== null && !isTodoMoment(sec)) points.push({ text: pointText, sec });
    }
    if (points.length === 0) continue;
    points.sort((a, b) => a.sec - b.sec);

    const startSec = snapToTranscript(section.startSec, offsets) ?? points[0].sec;
    const named = speakerByLower.get(text(section.speaker).toLowerCase()) ?? null;
    sections.push({ title, startSec: Math.min(startSec, points[0].sec), endSec: totalSec, speaker: named, points });
  }
  if (sections.length === 0) return null;

  sections.sort((a, b) => a.startSec - b.startSec);
  sections.forEach((section, idx) => {
    const next = sections[idx + 1];
    section.endSec = next ? Math.max(next.startSec, section.startSec) : Math.max(totalSec, section.startSec);
    if (!section.speaker) section.speaker = dominantSpeaker(lines, section.startSec, section.endSec || section.startSec + 1);
  });


  return {
    topic: text(data.topic),
    overview: text(data.overview),
    speakers,
    sections,
    todos,
  };
}

/**
 * Short reason an AI call failed, kept with the summary as an internal note:
 * "timeout", "HTTP 503" (the provider answered with an error), or "error".
 */
export function aiFailureReason(error: unknown): string {
  if (!error || typeof error !== 'object') return 'error';
  const e = error as { name?: unknown; status?: unknown };
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'timeout';
  if (typeof e.status === 'number') return `HTTP ${e.status}`;
  return 'error';
}

/** Plain text of a section for older readers of MeetingSummaryItem.content. */
export function sectionContent(section: SummarySection): string {
  return section.points.map((point) => point.text).join('\n');
}
