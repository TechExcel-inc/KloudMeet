import { after, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { apiJson, runWithLocale } from '@/lib/apiMsg';
import { authorizeRecordingView, findRecordingByKey, isRecordingResponse } from '@/lib/recordingShare';
import { isWritingLength } from '@/lib/replayWriting';
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
      if (!isWritingLength(input?.minutes) || !Number.isInteger(input?.section) || input.section < 0) {
        return apiJson({ error: 'Invalid narration section' }, { status: 400, headers });
      }
      const writing = await prisma.recordingWriting.findUnique({
        where: { recordingId_minutes: { recordingId: recording.id, minutes: input.minutes } },
      });
      const presentation = writing?.status === 'READY' ? readPresentation(writing.content) : null;
      const slide = presentation?.slides[input.section];
      if (!presentation || !slide?.narration.trim()) return apiJson({ error: 'Narration section not found' }, { status: 404, headers });
      const clip = await smartPlayNarration(recording.id, slide.narration, presentation.language, access.memberId !== null, {
        poll: input.poll === true,
        background: (wait) => after(wait),
      });
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
