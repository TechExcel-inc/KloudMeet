import { after, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { apiJson, runWithLocale } from '@/lib/apiMsg';
import { authorizeRecordingView, findRecordingByKey, isRecordingResponse } from '@/lib/recordingShare';
import { DEFAULT_WRITING_VOICE, isWritingId, isWritingLength, isWritingVoice } from '@/lib/replayWriting';
import { loadReplaySpokenNames } from '@/lib/replaySpokenNames.server';
import { readPresentation } from '@/lib/meetingPresentation';
import { smartPlayNarration } from '@/lib/smartPlayNarration.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return runWithLocale(request, async () => {
    try {
      const recording = await findRecordingByKey((await params).id);
      if (!recording || recording.status !== 'READY') return apiJson({ error: 'Recording not found' }, { status: 404, headers });
      const access = await authorizeRecordingView(request, recording);
      if (isRecordingResponse(access)) return access;
      const input = await request.json().catch(() => null);
      const writingId = input?.writingId ?? (isWritingLength(input?.minutes) ? `legacy-${input.minutes}` : null);
      if (!isWritingId(writingId) || !Number.isInteger(input?.section) || input.section < 0) {
        return apiJson({ error: 'Invalid narration section' }, { status: 400, headers });
      }
      const writing = await prisma.recordingWriting.findUnique({
        where: { recordingId_id: { recordingId: recording.id, id: writingId } },
      });
      const presentation = writing?.status === 'READY' ? readPresentation(writing.content) : null;
      const slide = presentation?.slides[input.section];
      if (!presentation || !slide?.narration.trim()) return apiJson({ error: 'Narration section not found' }, { status: 404, headers });
      const speak = await loadReplaySpokenNames(recording.meetingId, presentation.language);
      const narration = speak(slide);
      const canGenerate = access.memberId !== null;
      const voice = isWritingVoice(writing?.voice) ? writing.voice : DEFAULT_WRITING_VOICE;
      let clip = await smartPlayNarration(recording.id, narration, presentation.language, canGenerate, {
        voice,
        poll: input.poll === true,
        background: (wait) => after(wait),
      });
      if (clip === 'sign-in' && narration !== slide.narration) {
        clip = await smartPlayNarration(recording.id, slide.narration, presentation.language, false, { voice });
      }
      if (clip === 'preparing') return apiJson({ status: 'preparing' }, { status: 202, headers });
      if (clip === 'failed') return apiJson({ error: 'Could not prepare OpenAI narration', code: 'NARRATION_NOT_READY' }, { status: 502, headers });
      if (clip === 'sign-in') return apiJson({ error: 'Sign in to prepare the narration' }, { status: 401, headers });
      if (clip === 'busy') return apiJson({ error: 'Narration is busy' }, { status: 503, headers });
      return apiJson(clip, { headers });
    } catch (error) {
      console.warn('[smart-play] narration failed', error instanceof Error ? error.name : 'UnknownError');
      return apiJson({ error: 'Could not access narration audio' }, { status: 502, headers });
    }
  });
}
