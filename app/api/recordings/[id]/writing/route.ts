import { after, type NextRequest } from 'next/server';
import { apiJson, runWithLocale } from '@/lib/apiMsg';
import { checkAiSummaryQuota } from '@/lib/billing/limits';
import { authorizeRecordingView, findRecordingByKey, isRecordingResponse, loadManagedRecording } from '@/lib/recordingShare';
import { isWritingLength } from '@/lib/replayWriting';
import { claimWriting, generateReplayWriting, loadWritings, loadWritingTranscript, recommendWriting } from '@/lib/replayWriting.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };
type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return runWithLocale(req, async () => {
    const recording = await findRecordingByKey((await params).id);
    if (!recording) return apiJson({ error: 'Recording not found' }, { status: 404, headers });
    const access = await authorizeRecordingView(req, recording);
    if (isRecordingResponse(access)) return access;
    if (recording.status !== 'READY') return apiJson({ error: 'Recording is not ready' }, { status: 409, headers });
    try {
      return apiJson({ writings: await loadWritings(recording.id) }, { headers });
    } catch {
      return apiJson({ error: 'Could not load AI writings' }, { status: 500, headers });
    }
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  return runWithLocale(req, async () => {
    const loaded = await loadManagedRecording(req, (await params).id);
    if (isRecordingResponse(loaded)) return loaded;
    const { recording, memberId } = loaded;
    const body = await req.json().catch(() => null);
    const minutes: unknown = body?.minutes;
    if (body?.recommend !== true && !isWritingLength(minutes)) {
      return apiJson({ error: 'Invalid recap length' }, { status: 400, headers });
    }
    if (recording.status !== 'READY') return apiJson({ error: 'Recording is not ready' }, { status: 409, headers });

    try {
      const current = await loadWritings(recording.id);
      if (isWritingLength(minutes) && current.some((item) => item.minutes === minutes && item.status !== 'FAILED')) {
        return apiJson({ writings: current }, { headers });
      }
      const quota = await checkAiSummaryQuota(memberId);
      if (quota) return quota;
      const lines = await loadWritingTranscript(recording);
      if (!lines.length) return apiJson({ error: 'A transcript is required to write a recap' }, { status: 409, headers });
      if (body?.recommend === true) {
        return apiJson({ recommended: await recommendWriting(lines, recording.durationSeconds) }, { headers });
      }
      if (!isWritingLength(minutes)) return apiJson({ error: 'Invalid recap length' }, { status: 400, headers });

      const startedAt = await claimWriting(recording.id, minutes);
      if (startedAt) {
        after(() => generateReplayWriting(recording, minutes, startedAt, memberId, lines));
        return apiJson({ writings: [
          ...current.filter((item) => item.minutes !== minutes),
          { minutes, status: 'GENERATING', presentation: null },
        ] }, { status: 202, headers });
      }
      return apiJson({ writings: await loadWritings(recording.id) }, { headers });
    } catch {
      return apiJson({ error: 'Could not start AI writing' }, { status: 500, headers });
    }
  });
}
