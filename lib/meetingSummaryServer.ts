/**
 * Writing a meeting's AI summary: the model calls and the database write.
 *
 * Used by POST /api/meeting-summary/[meetingId]/generate (someone pressed Generate) and by the
 * AI presentation, which is built on the summary as soon as an AI Notes session ends
 * (lib/meetingPresentationServer.ts).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  aiFailureReason,
  draftSummary,
  normalizeSummary,
  sectionContent,
  type StructuredSummary,
  type SummaryDraft,
  type SummaryTranscriptLine,
} from '@/lib/meetingSummary';

function secsToHMS(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** One chat call that must answer with a JSON object. */
async function chat(
  url: string,
  key: string,
  model: string,
  system: string,
  prompt: string,
  maxTokens: number,
): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`${model} error: ${await res.text()}`), { status: res.status });
  }
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{}');
}

/** One call: DeepSeek, or OpenAI when DeepSeek is missing or fails (for this call only). */
export async function callSummaryAI(system: string, prompt: string, maxTokens: number): Promise<SummaryDraft> {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  let fallbackReason = 'no-key';
  if (deepseekKey) {
    try {
      const raw = await chat(
        'https://api.deepseek.com/v1/chat/completions',
        deepseekKey,
        'deepseek-chat',
        system,
        prompt,
        maxTokens,
      );
      return { raw, model: 'deepseek-chat', fallbackReason: null };
    } catch (e) {
      fallbackReason = aiFailureReason(e);
      console.warn(`[summary] DeepSeek failed (${fallbackReason}), trying OpenAI:`, e);
    }
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error('No AI API key configured');
  const raw = await chat('https://api.openai.com/v1/chat/completions', openaiKey, 'gpt-4o-mini', system, prompt, maxTokens);
  return { raw, model: 'gpt-4o-mini', fallbackReason };
}

export type SummaryFailure = 'ai_failed' | 'unusable';

export interface WrittenSummary {
  summary: StructuredSummary;
  ai: SummaryDraft;
  items: Awaited<ReturnType<typeof prisma.meetingSummaryItem.findMany>>;
  head: {
    topic: string | null;
    overview: string | null;
    speakers: Prisma.JsonValue;
    todos: Prisma.JsonValue;
    updatedAt: Date;
  };
}

/**
 * writeMeetingSummary — drafts a meeting's summary from its transcript and stores it
 *
 * Long meetings are drafted in parts (lib/meetingSummary draftSummary). Every point and to-do must
 * land on a real transcript line; the rest is dropped. Replaces the meeting's earlier summary.
 *
 * @returns the stored summary, or why there is none: the AI call failed, or what it returned
 *          could not be used
 */
export async function writeMeetingSummary(
  meetingId: number,
  meetingName: string,
  transcripts: SummaryTranscriptLine[],
  call = callSummaryAI,
): Promise<WrittenSummary | { failed: SummaryFailure }> {
  let ai: SummaryDraft;
  try {
    ai = await draftSummary(meetingName, transcripts, call);
  } catch (e) {
    console.error('[summary] AI call failed:', e);
    return { failed: 'ai_failed' };
  }
  const summary = normalizeSummary(ai.raw, transcripts);
  if (!summary) return { failed: 'unusable' };

  const saved = await prisma.$transaction(async (tx) => {
    await tx.meetingSummaryItem.deleteMany({ where: { meetingId } });
    await tx.meetingSummaryItem.createMany({
      data: summary.sections.map((section, idx) => ({
        meetingId,
        title: section.title,
        content: sectionContent(section),
        timeOffset: secsToHMS(section.startSec),
        speaker: section.speaker,
        points: section.points as unknown as Prisma.InputJsonValue,
        sortOrder: idx,
      })),
    });
    const fields = {
      topic: summary.topic || null,
      overview: summary.overview || null,
      speakers: summary.speakers as unknown as Prisma.InputJsonValue,
      todos: summary.todos as unknown as Prisma.InputJsonValue,
      model: ai.model,
      fallbackReason: ai.fallbackReason,
    };
    const head = await tx.meetingSummary.upsert({
      where: { meetingId },
      create: { meetingId, ...fields },
      update: fields,
      select: { topic: true, overview: true, speakers: true, todos: true, updatedAt: true },
    });
    const items = await tx.meetingSummaryItem.findMany({
      where: { meetingId },
      orderBy: { sortOrder: 'asc' },
    });
    return { items, head };
  });
  return { summary, ai, ...saved };
}

const HMS = /^(\d+):(\d{2}):(\d{2})$/;

/** The structured summary already stored for a meeting, or null when there is none. */
export async function loadStoredSummary(
  meetingId: number,
  transcripts: SummaryTranscriptLine[],
): Promise<StructuredSummary | null> {
  const [head, items] = await Promise.all([
    prisma.meetingSummary.findUnique({ where: { meetingId } }),
    prisma.meetingSummaryItem.findMany({ where: { meetingId }, orderBy: { sortOrder: 'asc' } }),
  ]);
  if (!head || items.length === 0) return null;
  // The stored rows go back through the same checks as a fresh draft, so an older summary whose
  // times no longer match the transcript isn't presented.
  return normalizeSummary(
    {
      topic: head.topic,
      overview: head.overview,
      todos: head.todos,
      sections: items.map((item) => {
        const match = HMS.exec(item.timeOffset);
        const startSec = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
        return { title: item.title, startSec, speaker: item.speaker, points: item.points };
      }),
    },
    transcripts,
  );
}
