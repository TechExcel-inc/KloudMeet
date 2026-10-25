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

/** Names that stand for "we don't know who" in transcripts. */
const ANONYMOUS_SPEAKERS = new Set(['', 'unknown', 'speaker 1']);

export const SUMMARY_SYSTEM_PROMPT = `You are a professional meeting note-taker. Read the transcript and write the meeting summary.
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
- Split into 3-8 sections by topic, in time order. Each section has 1-5 points.
- Each point is one sentence of at most 60 characters (Chinese) or 25 words, stating a fact, decision or number that was said.
- "sec" and "startSec" must be the [seconds] of the transcript line the point comes from. Never invent a time.
- To-dos: only things someone clearly agreed or was asked to do. Owner is the speaker who took it on or the person named; if nobody was named use null. Due is the deadline in the speaker's words (e.g. "by Friday"); if none was said use null. Do not guess.
- If there are no to-dos, return an empty array.`;

/** "[1000] Alex Chen: text" lines for the prompt. */
export function buildSummaryPrompt(meetingName: string, lines: SummaryTranscriptLine[]): string {
  const totalSec = lines.reduce((max, line) => Math.max(max, line.offsetSeconds ?? 0), 0);
  const body = lines
    .map((line) => `[${Math.round(line.offsetSeconds ?? 0)}] ${line.speakerName || 'Unknown'}: ${line.content}`)
    .join('\n');
  return `Meeting: ${meetingName}\nDuration: ~${Math.round(totalSec / 60)} min\nTranscript:\n\n${body}\n\nWrite the summary.`;
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
 * unplaceable points and to-dos dropped, owners kept only if that name appears in the meeting.
 * Returns null when nothing usable is left.
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
      const pointText = text(point.text);
      const sec = snapToTranscript(point.sec, offsets);
      if (pointText && sec !== null) points.push({ text: pointText, sec });
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

  const todos: SummaryTodo[] = [];
  for (const t of Array.isArray(data.todos) ? data.todos : []) {
    if (!t || typeof t !== 'object') continue;
    const todo = t as Record<string, unknown>;
    const task = text(todo.task);
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

  return {
    topic: text(data.topic),
    overview: text(data.overview),
    speakers,
    sections,
    todos,
  };
}

/** Plain text of a section for older readers of MeetingSummaryItem.content. */
export function sectionContent(section: SummarySection): string {
  return section.points.map((point) => point.text).join('\n');
}
