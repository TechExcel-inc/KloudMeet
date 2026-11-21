import { after, type NextRequest } from 'next/server';
import { apiJson, runWithLocale } from '@/lib/apiMsg';
import { checkAiSummaryQuota } from '@/lib/billing/limits';
import { authorizeRecordingView, findRecordingByKey, isRecordingResponse, loadManagedRecording } from '@/lib/recordingShare';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { readPresentation, speakSeconds } from '@/lib/meetingPresentation';
import { isWritingId, isWritingLength, isWritingVoice, WRITING_DESCRIPTION_LIMIT, WRITING_NAME_LIMIT, WRITING_SECTION_LIMIT } from '@/lib/replayWriting';
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
    const { id, minutes, voice } = body ?? {};
    const details = readDetails(body);
    const writing = details?.description && isWritingId(id) && isWritingLength(minutes) && isWritingVoice(voice)
      ? { id, minutes, voice, ...details }
      : null;
    const recommending = body?.recommend === true;
    if (!recommending && !writing) {
      return apiJson({ error: 'Invalid AI Write settings' }, { status: 400, headers });
    }
    if (recording.status !== 'READY') return apiJson({ error: 'Recording is not ready' }, { status: 409, headers });

    try {
      const current = await loadWritings(recording.id);
      if (recommending && current.some(item => item.status !== 'FAILED')) {
        return apiJson({ suggestions: [] }, { headers });
      }
      if (writing && current.some(item => item.id === writing.id && item.status !== 'FAILED')) {
        return apiJson({ writings: current }, { headers });
      }
      const quota = await checkAiSummaryQuota(memberId);
      if (quota) return quota;
      const lines = await loadWritingTranscript(recording);
      if (!lines.length) return apiJson({ error: 'A transcript is required for AI Write' }, { status: 409, headers });
      if (recommending) {
        return apiJson({ suggestions: await recommendWriting(lines, recording.durationSeconds) }, { headers });
      }
      if (!writing) {
        return apiJson({ error: 'Invalid AI Write settings' }, { status: 400, headers });
      }
      const startedAt = await claimWriting(recording.id, writing);
      if (startedAt) after(() => generateReplayWriting(recording, writing, startedAt, memberId, lines));
      return apiJson({ writings: await loadWritings(recording.id) }, { status: startedAt ? 202 : 200, headers });
    } catch {
      return apiJson({ error: 'Could not start AI Write' }, { status: 500, headers });
    }
  });
}

function readDetails(body: { name?: unknown; description?: unknown } | null) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  if (!name || name.length > WRITING_NAME_LIMIT || description.length > WRITING_DESCRIPTION_LIMIT) return null;
  return { name, description };
}

export async function PATCH(req: NextRequest, { params }: Params) {
  return runWithLocale(req, async () => {
    const loaded = await loadManagedRecording(req, (await params).id);
    if (isRecordingResponse(loaded)) return loaded;
    const { recording } = loaded;
    const body = await req.json().catch(() => null);
    const details = readDetails(body);
    const { id, voice, sections } = body ?? {};
    if (!details || !isWritingId(id) || !isWritingVoice(voice) || !Array.isArray(sections)) {
      return apiJson({ error: 'Invalid AI Write settings' }, { status: 400, headers });
    }
    if (recording.status !== 'READY') return apiJson({ error: 'Recording is not ready' }, { status: 409, headers });

    try {
      const key = { recordingId: recording.id, id };
      const row = await prisma.recordingWriting.findUnique({ where: { recordingId_id: key } });
      const presentation = row?.status === 'READY' ? readPresentation(row.content) : null;
      if (!row || !presentation) return apiJson({ error: 'AI Write not found' }, { status: 404, headers });
      if (sections.length !== presentation.slides.length || sections.some(section =>
        typeof section?.title !== 'string' || !section.title.trim() || section.title.length > 140 ||
        typeof section?.narration !== 'string' || !section.narration.trim() || section.narration.length > WRITING_SECTION_LIMIT)) {
        return apiJson({ error: 'Invalid AI Write sections' }, { status: 400, headers });
      }
      const slides = presentation.slides.map((slide, index) => {
        const title = sections[index].title.trim();
        const narration = sections[index].narration.trim();
        const seconds = narration === slide.narration ? slide.seconds : Math.max(4, Math.ceil(speakSeconds(narration) + 2));
        return { ...slide, title, narration, seconds };
      });
      await prisma.recordingWriting.update({
        where: { recordingId_id: key },
        data: { ...details, voice, content: { ...presentation, title: details.name, slides } as unknown as Prisma.InputJsonValue },
      });
      return apiJson({ writings: await loadWritings(recording.id) }, { headers });
    } catch {
      return apiJson({ error: 'Could not save AI Write' }, { status: 500, headers });
    }
  });
}
