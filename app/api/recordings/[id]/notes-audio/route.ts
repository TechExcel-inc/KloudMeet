import { after, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { apiJson, runWithLocale } from '@/lib/apiMsg';
import { checkAiSummaryQuota } from '@/lib/billing/limits';
import { prisma } from '@/lib/db';
import { hasNoMedia } from '@/lib/liveNotes';
import { readPresentation, type MeetingPresentation } from '@/lib/meetingPresentation';
import { recordingModeOf } from '@/lib/recordingControls';
import { authorizeRecordingView, findRecordingByKey, isRecordingResponse, loadManagedRecording } from '@/lib/recordingShare';
import { isWritingLanguage, isWritingVoice, NOTES_AUDIO_ID, writingLanguageOf } from '@/lib/replayWriting';
import { generateReplayWriting, loadNotesAudio, loadWritingTranscript, NOTES_AUDIO_STALE_MS } from '@/lib/replayWriting.server';
import { prepareSmartPlayVoice } from '@/lib/smartPlayNarration.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };
type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return runWithLocale(req, async () => {
    const recording = await findRecordingByKey((await params).id);
    if (!recording || recording.status !== 'READY') return apiJson({ error: 'Recording not found' }, { status: 404, headers });
    const access = await authorizeRecordingView(req, recording);
    if (isRecordingResponse(access)) return access;
    return apiJson({ notesAudio: await loadNotesAudio(recording.id) }, { headers });
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  return runWithLocale(req, async () => {
    const loaded = await loadManagedRecording(req, (await params).id);
    if (isRecordingResponse(loaded)) return loaded;
    const { recording, memberId } = loaded;
    if (recording.status !== 'READY' || (!hasNoMedia(recording) && recordingModeOf(recording.mode) !== 'ai_notes')) {
      return apiJson({ error: 'AI audio requires a ready AI Notes replay' }, { status: 409, headers });
    }
    const { voice, language: requestedLanguage } = await req.json().catch(() => null) ?? {};
    if (!isWritingVoice(voice)) return apiJson({ error: 'Invalid voice' }, { status: 400, headers });
    if (requestedLanguage !== undefined && !isWritingLanguage(requestedLanguage)) {
      return apiJson({ error: 'Invalid language' }, { status: 400, headers });
    }

    try {
      const key = { recordingId: recording.id, id: NOTES_AUDIO_ID };
      const where = { recordingId_id: key };
      const current = await prisma.recordingWriting.findUnique({ where });
      const reply = async (status = 200) => apiJson({ notesAudio: await loadNotesAudio(recording.id) }, { status, headers });
      if (current?.status === 'GENERATING' && Date.now() - current.startedAt.getTime() < NOTES_AUDIO_STALE_MS) {
        return reply();
      }

      const previousLanguage = writingLanguageOf(current?.content);
      const language = isWritingLanguage(requestedLanguage) ? requestedLanguage : previousLanguage;
      const savedScript = readPresentation(current?.content);
      const script = language === previousLanguage ? savedScript : null;
      let lines: Awaited<ReturnType<typeof loadWritingTranscript>> = [];
      if (!script) {
        const quota = await checkAiSummaryQuota(memberId);
        if (quota) return quota;
        lines = await loadWritingTranscript(recording);
        if (!lines.length) return apiJson({ error: 'A transcript is required to generate AI audio' }, { status: 409, headers });
      }

      const startedAt = new Date();
      const pending = { status: 'GENERATING', voice, startedAt };
      const writing = { id: NOTES_AUDIO_ID, name: '', description: 'Retell the meeting as a concise spoken briefing. Cover decisions, context, and follow-ups in the order they were discussed.', minutes: 5 as const, voice };
      if (current) {
        const claimed = await prisma.recordingWriting.updateMany({
          where: { ...key, startedAt: current.startedAt, status: current.status }, data: pending,
        });
        if (!claimed.count) return reply();
      } else {
        try {
          await prisma.recordingWriting.create({ data: { ...writing, recordingId: recording.id, ...pending, content: { languagePreference: language } } });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply();
          throw error;
        }
      }

      const prepare = async (presentation: MeetingPresentation) => {
        if (!await prepareSmartPlayVoice(recording.id, presentation, voice)) throw new Error('Narration is incomplete');
      };
      if (script) {
        after(async () => {
          let status = 'READY';
          try {
            await prepare(script);
          } catch {
            status = 'FAILED';
          }
          await prisma.recordingWriting.updateMany({ where: { ...key, ...pending }, data: { status } });
        });
      } else {
        after(() => generateReplayWriting(recording, writing, startedAt, memberId, lines, {
          auto: false, fromPrompt: false, language, prepare,
          edit: savedScript ? { presentation: savedScript, description: writing.description } : undefined,
        }));
      }
      return reply(202);
    } catch (error) {
      console.warn('[notes audio] Could not start narration', error instanceof Error ? error.name : 'UnknownError');
      return apiJson({ error: 'Could not start AI audio' }, { status: 500, headers });
    }
  });
}
