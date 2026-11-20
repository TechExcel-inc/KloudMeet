/**
 * Making and storing a meeting's AI presentation (lib/meetingPresentation.ts).
 *
 * It is made as soon as an AI Notes session ends (lib/liveNotesServer.ts finishLiveNotes), so it
 * is ready when someone opens the replay. Opening a replay that has none starts it too (the
 * server may have restarted in between), and the host can ask for it again.
 *
 * One generation per meeting at a time: a MeetingPresentation row in GENERATING is the claim.
 * The claim carries its start time, and every later write checks it, so an abandoned or
 * superseded run can't overwrite a newer one.
 */
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { checkAiSummaryQuota } from '@/lib/billing/limits';
import { meterAiSummary, meterSafely } from '@/lib/billing/usage';
import {
  buildPresentation,
  buildPresentationPrompt,
  NO_PRESENTATION,
  PRESENTATION_SYSTEM_PROMPT,
  readPresentation,
  type PresentationState,
} from '@/lib/meetingPresentation';
import { callSummaryAI, loadStoredSummary, writeMeetingSummary } from '@/lib/meetingSummaryServer';

/** A generation still running after this long was abandoned (the process stopped). */
export const PRESENTATION_STALE_MS = 10 * 60 * 1000;
/** After a session ends, wait for its last sentences and speaker names before reading it. */
export const PRESENTATION_SETTLE_MS = 8000;
/** Fewer lines than this is not a meeting to present. */
const MIN_LINES = 3;

export interface PresentationRequest {
  /** Make it again even when one is ready */
  force?: boolean;
  /** Whose AI summary allowance pays if the meeting has no summary yet */
  memberId?: number | null;
  delayMs?: number;
}

const timers = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * schedulePresentation — makes a meeting's presentation in the background
 *
 * Returns at once. Asking again for the same meeting before it starts replaces the earlier ask.
 */
export function schedulePresentation(meetingId: number, request: PresentationRequest = {}): void {
  const pending = timers.get(meetingId);
  if (pending) clearTimeout(pending);
  const timer = setTimeout(() => {
    timers.delete(meetingId);
    void ensureMeetingPresentation(meetingId, request).catch((err: unknown) =>
      console.error('[presentation] generation failed', meetingId, err),
    );
  }, request.delayMs ?? 0);
  // A pending presentation must not keep a finished script or test run alive.
  timer.unref?.();
  timers.set(meetingId, timer);
}

function stateOf(row: { status: string; content: Prisma.JsonValue | null; startedAt: Date } | null): PresentationState {
  if (!row) return NO_PRESENTATION;
  if (row.status === 'READY') {
    const content = readPresentation(row.content);
    return content ? { status: 'READY', content } : { status: 'FAILED', content: null };
  }
  if (row.status === 'GENERATING') {
    const stale = Date.now() - row.startedAt.getTime() > PRESENTATION_STALE_MS;
    return { status: stale ? 'FAILED' : 'GENERATING', content: null };
  }
  return { status: 'FAILED', content: null };
}

/**
 * loadPresentation — what the replay page shows for a meeting
 *
 * Never throws: until prisma/add_meeting_presentation.sql has been run there is simply none.
 */
export async function loadPresentation(meetingId: number): Promise<PresentationState> {
  try {
    return stateOf(await prisma.meetingPresentation.findUnique({ where: { meetingId } }));
  } catch (err) {
    console.warn('[presentation] could not be read', meetingId, err);
    return NO_PRESENTATION;
  }
}

/** Claims the meeting's generation; null when one is ready or already running. */
async function claim(meetingId: number, force: boolean): Promise<Date | null> {
  const claimedAt = new Date();
  const existing = await prisma.meetingPresentation.findUnique({ where: { meetingId } });
  if (!existing) {
    try {
      await prisma.meetingPresentation.create({ data: { meetingId, status: 'GENERATING', startedAt: claimedAt } });
      return claimedAt;
    } catch (err) {
      // Someone else created it in the same moment.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }
  const running = existing.status === 'GENERATING'
    && claimedAt.getTime() - existing.startedAt.getTime() <= PRESENTATION_STALE_MS;
  if (running) return null;
  if (existing.status === 'READY' && !force && readPresentation(existing.content)) return null;
  const taken = await prisma.meetingPresentation.updateMany({
    where: { meetingId, startedAt: existing.startedAt, status: existing.status },
    // The presentation showing now stays until the new one replaces it.
    data: { status: 'GENERATING', startedAt: claimedAt, error: null },
  });
  return taken.count > 0 ? claimedAt : null;
}

/**
 * ensureMeetingPresentation — makes the meeting's presentation unless one is ready or running
 *
 * Uses the meeting's stored AI summary, writing one first when there is none (that counts
 * against `memberId`'s AI summary allowance, like pressing Generate). Then one model call
 * directs the presentation; if that call fails the presentation is still built from the summary.
 */
export async function ensureMeetingPresentation(
  meetingId: number,
  request: PresentationRequest = {},
  call = callSummaryAI,
): Promise<PresentationState> {
  const claimedAt = await claim(meetingId, request.force === true);
  if (!claimedAt) return loadPresentation(meetingId);
  const held = { meetingId, status: 'GENERATING', startedAt: claimedAt };
  const fail = async (reason: string) => {
    await prisma.meetingPresentation.updateMany({
      where: held,
      data: { status: 'FAILED', error: reason.slice(0, 500) },
    });
    return loadPresentation(meetingId);
  };

  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { title: true, roomName: true },
    });
    if (!meeting) return await fail('meeting not found');
    const transcripts = (await prisma.meetingTranscript.findMany({
      where: { meetingId },
      orderBy: { captionTime: 'asc' },
      select: { offsetSeconds: true, speakerName: true, content: true },
    })).filter((line) => (line.content || '').trim().length > 0);
    if (transcripts.length < MIN_LINES) return await fail('not enough transcript');

    const meetingName = meeting.title || meeting.roomName || `Meeting #${meetingId}`;
    let summary = await loadStoredSummary(meetingId, transcripts);
    let model = '';
    if (!summary) {
      const memberId = request.memberId ?? null;
      if (memberId !== null) {
        const over: NextResponse | null = await checkAiSummaryQuota(memberId);
        if (over) return await fail('AI summary allowance used up');
      }
      const written = await writeMeetingSummary(meetingId, meetingName, transcripts, call);
      if ('failed' in written) return await fail(`summary ${written.failed}`);
      summary = written.summary;
      model = written.ai.model;
      if (memberId !== null) {
        await meterSafely(`ai:${meetingId}`, () => meterAiSummary(memberId, meetingId));
      }
    }

    let direction: unknown = null;
    try {
      const directed = await call(PRESENTATION_SYSTEM_PROMPT, buildPresentationPrompt(meetingName, summary, transcripts), 3000);
      direction = directed.raw;
      model = model ? `${model}+${directed.model}` : directed.model;
    } catch (err) {
      // The summary alone still makes a presentation: plainer headlines, no quotes.
      console.warn('[presentation] direction call failed; building from the summary', meetingId, err);
      model = model ? `${model}+none` : 'none';
    }

    const presentation = buildPresentation(meetingName, summary, direction, transcripts);
    if (!presentation) return await fail('nothing to present');
    await prisma.meetingPresentation.updateMany({
      where: held,
      data: {
        status: 'READY',
        content: presentation as unknown as Prisma.InputJsonValue,
        model: [...new Set(model.split('+'))].join('+').slice(0, 100),
        error: null,
      },
    });
    return loadPresentation(meetingId);
  } catch (err) {
    console.error('[presentation] generation failed', meetingId, err);
    return fail(err instanceof Error ? err.message : 'error');
  }
}
