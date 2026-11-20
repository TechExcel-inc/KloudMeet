/**
 * /api/recordings/[id]/presentation
 *
 * The meeting's AI presentation (lib/meetingPresentation.ts).
 * GET : its state, for anyone who may watch the recording. The replay page polls this while one
 *       is being made.
 * POST: make it again. Only who may manage the recording (its recorder or the meeting's host).
 *       Answers at once; the work runs in the background.
 */
import { NextRequest } from 'next/server';
import { canManageRecording } from '@/lib/apiAuth';
import { loadPresentation, schedulePresentation } from '@/lib/meetingPresentationServer';
import { authorizeRecordingView, findRecordingByKey, isRecordingResponse } from '@/lib/recordingShare';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

async function locate(req: NextRequest, key: string) {
  const recording = await findRecordingByKey(key);
  if (!recording) return apiJson({ error: 'Recording not found' }, { status: 404 });
  const access = await authorizeRecordingView(req, recording);
  if (isRecordingResponse(access)) return access;
  return { recording, memberId: access.memberId };
}

export async function GET(req: NextRequest, { params }: Params) {
  return runWithLocale(req, async () => {
  try {
    const found = await locate(req, (await params).id);
    if (isRecordingResponse(found)) return found;
    return apiJson(
      { presentation: await loadPresentation(found.recording.meetingId) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[GET /api/recordings/[id]/presentation]', err);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}

export async function POST(req: NextRequest, { params }: Params) {
  return runWithLocale(req, async () => {
  try {
    const found = await locate(req, (await params).id);
    if (isRecordingResponse(found)) return found;
    const { recording, memberId } = found;
    if (memberId === null || !(await canManageRecording(memberId, recording))) {
      return apiJson({ error: 'Only the host can generate the presentation' }, { status: 403 });
    }
    schedulePresentation(recording.meetingId, { force: true, memberId });
    return apiJson({ presentation: { status: 'GENERATING', content: null } });
  } catch (err) {
    console.error('[POST /api/recordings/[id]/presentation]', err);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
