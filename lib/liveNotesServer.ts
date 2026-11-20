/**
 * Server side of AI Taking Notes without a recording file (see lib/liveNotes.ts).
 *
 * - saveLiveSentences: the recorder page posts each finished sentence; it becomes a
 *   MeetingTranscript row.
 * - realignLiveNotes: who said a sentence is known only once the recorder has reported the
 *   speak intervals around it (a few seconds later), so names are worked out again whenever
 *   sentences or intervals arrive, and once more at the end.
 * - finishLiveNotes: closes the session when the recorder stops. There is no file to wait for,
 *   so this is what makes the recording READY, with its length taken from the clock.
 */
import type { Recording } from '@prisma/client';
import { DataPacket_Kind } from 'livekit-server-sdk';
import { prisma } from '@/lib/db';
import {
  alignSpeakTranscript,
  SPEAK_LAG_MS,
  UNKNOWN_SPEAKER,
  type SpeakWindow,
} from '@/lib/alignSpeakTranscript';
import { onRecordingReady } from '@/lib/billing/limits';
import { getRoomServiceClient } from '@/lib/livekitRooms';
import { PRESENTATION_SETTLE_MS, schedulePresentation } from '@/lib/meetingPresentationServer';
import {
  hasNoMedia,
  liveSourceDurationMs,
  liveSourceId,
  liveSourcePrefix,
  NOTES_FINISH_TOPIC,
  NOTES_FINISH_WAIT_MS,
  notesDurationSeconds,
  type LiveSentence,
} from '@/lib/liveNotes';
import { parsePauseSpans, pausedSeconds, type PauseSpan } from '@/lib/recordingControls';

/** Intervals this far before a sentence can still decide who said it. */
const ALIGN_MARGIN_MS = 5000;
/** Name used when the recorder reported no speak intervals at all (as the batch path does). */
const SOLE_SPEAKER = 'Speaker 1';

type SessionRow = Pick<
  Recording,
  'id' | 'meetingId' | 'teamMemberId' | 'storageProvider' | 'status' | 'mediaStartedAt' | 'createdAt' | 'pausedAt' | 'pauseSpans'
>;

/** The session's time zero: the recorder's clock when it started, else when the row was made. */
export function notesOrigin(recording: Pick<Recording, 'mediaStartedAt' | 'createdAt'>): Date {
  return recording.mediaStartedAt ?? recording.createdAt;
}

/** True when the sentence began while notes were paused. */
export function startedWhilePaused(startMs: number, pausedAt: Date | null, spans: PauseSpan[]): boolean {
  if (pausedAt && startMs >= pausedAt.getTime()) return true;
  return spans.some((span) => startMs >= Date.parse(span.from) && startMs < Date.parse(span.to));
}

/** Speak intervals as windows on the recorder's clock, moved earlier by the detection lag. */
async function speakWindows(recordingId: number, fromMs?: number): Promise<SpeakWindow[]> {
  const rows = await prisma.recordingSpeakInterval.findMany({
    where: {
      recordingId,
      ...(fromMs === undefined ? {} : { endedAt: { gte: new Date(fromMs - ALIGN_MARGIN_MS) } }),
    },
    orderBy: { startedAt: 'asc' },
  });
  return rows.map((row) => ({
    identity: row.participantIdentity,
    name: row.displayName,
    startMs: row.startedAt.getTime() - SPEAK_LAG_MS,
    endMs: row.endedAt.getTime() - SPEAK_LAG_MS,
    avgLevel: row.avgLevel,
  }));
}

/**
 * realignLiveNotes — works out again who said each live sentence
 *
 * @param fromMs  only sentences from this moment on (recorder's clock); omit for the whole session
 * @param final   the session has ended: also fix each row's offset to the final time zero, and
 *                name a lone unnamed speaker
 */
export async function realignLiveNotes(
  recording: Pick<Recording, 'id' | 'meetingId' | 'mediaStartedAt' | 'createdAt'>,
  opts: { fromMs?: number; final?: boolean } = {},
): Promise<number> {
  const rows = await prisma.meetingTranscript.findMany({
    where: {
      meetingId: recording.meetingId,
      sourceId: { startsWith: liveSourcePrefix(recording.id) },
      ...(opts.fromMs === undefined ? {} : { captionTime: { gte: new Date(opts.fromMs - ALIGN_MARGIN_MS) } }),
    },
    select: { id: true, speakerName: true, captionTime: true, offsetSeconds: true, sourceId: true },
    orderBy: { captionTime: 'asc' },
  });
  if (rows.length === 0) return 0;

  const windows = await speakWindows(recording.id, opts.fromMs);
  const sentences = rows.map((row) => {
    const startMs = row.captionTime.getTime();
    return { startMs, endMs: startMs + (liveSourceDurationMs(row.sourceId) ?? 0), text: '' };
  });
  const aligned = alignSpeakTranscript(sentences, windows);
  const lone = opts.final && windows.length === 0;
  const origin = notesOrigin(recording).getTime();

  const updates = rows.flatMap((row, index) => {
    const speakerName = lone ? SOLE_SPEAKER : aligned[index].speakerName;
    const offsetSeconds = Math.max(0, Math.floor((row.captionTime.getTime() - origin) / 1000));
    const data: { speakerName?: string; offsetSeconds?: number } = {};
    // Don't replace a name already found with "Unknown" from a partial set of intervals.
    if (speakerName !== row.speakerName && (speakerName !== UNKNOWN_SPEAKER || opts.final)) data.speakerName = speakerName;
    if (opts.final && offsetSeconds !== row.offsetSeconds) data.offsetSeconds = offsetSeconds;
    return Object.keys(data).length ? [prisma.meetingTranscript.update({ where: { id: row.id }, data })] : [];
  });
  if (updates.length) await prisma.$transaction(updates);
  return updates.length;
}

/**
 * saveLiveSentences — stores sentences the recorder page finished
 *
 * Sentences already stored (a retried request) and sentences that began during a pause are
 * skipped. Returns how many were written.
 */
export async function saveLiveSentences(recording: SessionRow, sentences: LiveSentence[]): Promise<number> {
  const spans = parsePauseSpans(recording.pauseSpans);
  const kept = sentences.filter((sentence) => !startedWhilePaused(sentence.startMs, recording.pausedAt, spans));
  if (kept.length === 0) return 0;

  const ids = kept.map((sentence) => liveSourceId(recording.id, sentence));
  const existing = await prisma.meetingTranscript.findMany({
    where: { meetingId: recording.meetingId, sourceId: { in: ids } },
    select: { sourceId: true },
  });
  const seen = new Set(existing.map((row) => row.sourceId));
  const fresh = kept.filter((sentence, index) => {
    if (seen.has(ids[index])) return false;
    seen.add(ids[index]);
    return true;
  });
  if (fresh.length === 0) return 0;

  const origin = notesOrigin(recording).getTime();
  await prisma.meetingTranscript.createMany({
    data: fresh.map((sentence) => ({
      meetingId: recording.meetingId,
      speakerName: UNKNOWN_SPEAKER,
      content: sentence.text,
      captionTime: new Date(sentence.startMs),
      offsetSeconds: Math.max(0, Math.floor((sentence.startMs - origin) / 1000)),
      sourceId: liveSourceId(recording.id, sentence),
    })),
  });
  await realignLiveNotes(recording, { fromMs: Math.min(...fresh.map((sentence) => sentence.startMs)) });
  return fresh.length;
}

/**
 * askRecorderToFlush — tells the recorder page the session is ending, and waits briefly
 *
 * The recorder then closes its recognition stream properly, which makes the recognizer hand
 * back the sentence in progress, and posts it before the recorder is shut down.
 */
export async function askRecorderToFlush(roomName: string): Promise<void> {
  const client = getRoomServiceClient();
  if (!client) return;
  try {
    await client.sendData(roomName, new TextEncoder().encode('finish'), DataPacket_Kind.RELIABLE, {
      topic: NOTES_FINISH_TOPIC,
    });
    await new Promise((resolve) => setTimeout(resolve, NOTES_FINISH_WAIT_MS));
  } catch (err) {
    console.warn('[liveNotes] flush request failed (non-fatal)', roomName, err);
  }
}

/**
 * finishLiveNotes — closes a notes session that has no media file
 *
 * Called when the recorder stops (stop request, LiveKit's egress_ended, and the dashboard's
 * sync). Only the first call changes the status and meters the session; every call fixes the
 * speaker names again, so sentences and intervals that arrive late are still matched.
 *
 * @param failed  the recorder ended with an error; the session still counts when it has notes
 */
export async function finishLiveNotes(
  recording: SessionRow,
  opts: { endedAt?: Date; failed?: boolean } = {},
): Promise<void> {
  if (!hasNoMedia(recording)) return;
  const endedAt = opts.endedAt ?? new Date();
  const origin = notesOrigin(recording);

  if (recording.status === 'PROCESSING') {
    const lines = opts.failed
      ? await prisma.meetingTranscript.count({
          where: { meetingId: recording.meetingId, sourceId: { startsWith: liveSourcePrefix(recording.id) } },
        })
      : 1;
    const status = lines > 0 ? 'READY' : 'FAILED';
    const durationSeconds = notesDurationSeconds(origin, endedAt);
    const claimed = await prisma.recording.updateMany({
      where: { id: recording.id, status: 'PROCESSING' },
      data: { status, durationSeconds, mediaStartedAt: origin },
    });
    if (claimed.count > 0 && status === 'READY') {
      // The AI presentation is made now, so it is ready when someone opens the replay. It waits
      // a moment for the last sentences and speaker names to arrive.
      schedulePresentation(recording.meetingId, {
        memberId: recording.teamMemberId,
        delayMs: PRESENTATION_SETTLE_MS,
      });
      // Paused time isn't part of the notes, so it isn't billed (same as a file recording).
      const fresh = await prisma.recording.findUnique({ where: { id: recording.id } });
      const paused = pausedSeconds(parsePauseSpans(fresh?.pauseSpans ?? recording.pauseSpans));
      await onRecordingReady({
        id: recording.id,
        teamMemberId: recording.teamMemberId,
        meetingId: recording.meetingId,
        durationSeconds: Math.max(0, durationSeconds - paused),
      });
    }
  }
  await realignLiveNotes({ ...recording, mediaStartedAt: origin }, { final: true });
}
