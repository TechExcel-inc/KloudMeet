import { randomUUID } from 'node:crypto';
import { after, type NextRequest } from 'next/server';
import { apiJson, runWithLocale } from '@/lib/apiMsg';
import { checkAiSummaryQuota } from '@/lib/billing/limits';
import { authorizeRecordingView, findRecordingByKey, isRecordingResponse, loadManagedRecording } from '@/lib/recordingShare';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { prepareSmartPlayVoice } from '@/lib/smartPlayNarration.server';
import { readPresentation, type MeetingPresentation } from '@/lib/meetingPresentation';
import { isWritingId, isWritingLength, isWritingVoice, WRITING_DESCRIPTION_LIMIT, WRITING_NAME_LIMIT } from '@/lib/replayWriting';
import { claimWriting, generateReplayWriting, loadWritings, loadWritingTranscript, recommendWriting, writingRevision, writingState, WRITING_STALE_MS } from '@/lib/replayWriting.server';

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
    const { id, minutes, voice, sourceId } = body ?? {};
    const details = readDetails(body);
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    const writing = isWritingId(id) && isWritingVoice(voice) && (minutes === 'auto' || isWritingLength(minutes)) &&
      (prompt ? prompt.length <= WRITING_DESCRIPTION_LIMIT : Boolean(details?.description))
      ? { id, minutes: minutes === 'auto' ? 3 as const : minutes, voice,
          name: details?.name ?? '', description: prompt || details?.description || '' }
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
      const source = sourceId === undefined ? undefined :
        current.find(item => item.id === sourceId && item.id !== id);
      if (sourceId !== undefined && !source?.presentation) {
        return apiJson({ error: 'AI Write to improve not found' }, { status: 404, headers });
      }
      const startedAt = await claimWriting(recording.id, writing, isWritingId(sourceId) ? sourceId : undefined);
      if (startedAt) after(() => generateReplayWriting(recording, writing, startedAt, memberId, lines, { auto: minutes === 'auto', fromPrompt: Boolean(prompt), source: source?.presentation ? { id: source.id, revision: writingRevision(source), presentation: source.presentation } : undefined }));
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

function repairedContent(presentation: MeetingPresentation, title: string) {
  const content = { ...presentation, title } as MeetingPresentation & { sourceId?: string; sourceRevision?: string };
  delete content.sourceId;
  delete content.sourceRevision;
  return content;
}

async function applyRepair(recordingId: number, repairId: string) {
  return prisma.$transaction(async tx => {
    const key = (id: string) => ({ recordingId_id: { recordingId, id } });
    const repair = await tx.recordingWriting.findUnique({ where: key(repairId) });
    const draft = repair?.status === 'READY' ? readPresentation(repair.content) : null;
    const provenance = repair?.content && typeof repair.content === 'object' && !Array.isArray(repair.content)
      ? repair.content : null;
    if (!repair || !draft || !provenance || !isWritingId(provenance.sourceId) ||
      provenance.sourceId === repairId || typeof provenance.sourceRevision !== 'string') return null;
    const original = await tx.recordingWriting.findUnique({ where: key(provenance.sourceId) });
    const prior = original && writingState(original);
    if (!original || !prior?.presentation || writingRevision(prior) !== provenance.sourceRevision) return null;

    const backupName = `${prior.name.slice(0, WRITING_NAME_LIMIT - 20)} (before repair)`;
    await tx.recordingWriting.create({
      data: {
        recordingId, id: randomUUID(), name: backupName, description: original.description,
        minutes: original.minutes, voice: original.voice, status: 'READY',
        content: repairedContent(prior.presentation, backupName) as unknown as Prisma.InputJsonValue,
      },
    });

    const repaired = repairedContent(draft, prior.name);
    await tx.recordingWriting.update({
      where: key(original.id),
      data: { content: repaired as unknown as Prisma.InputJsonValue },
    });
    await tx.recordingWriting.update({
      where: key(repairId),
      data: { content: { ...repaired, title: draft.title } as unknown as Prisma.InputJsonValue },
    });
    return { id: original.id, presentation: repaired, voice: prior.voice };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  return runWithLocale(req, async () => {
    const loaded = await loadManagedRecording(req, (await params).id);
    if (isRecordingResponse(loaded)) return loaded;
    const { recording } = loaded;
    const body = await req.json().catch(() => null);
    if (body?.applyRepair === true && isWritingId(body.id)) {
      if (recording.status !== 'READY') return apiJson({ error: 'Recording is not ready' }, { status: 409, headers });
      try {
        const applied = await applyRepair(recording.id, body.id);
        if (!applied) return apiJson({ error: 'The original changed or this repair was already applied' }, { status: 409, headers });
        after(() => prepareSmartPlayVoice(recording.id, applied.presentation, applied.voice));
        return apiJson({ writings: await loadWritings(recording.id), selectedId: applied.id }, { headers });
      } catch {
        return apiJson({ error: 'Could not apply AI Write repair' }, { status: 500, headers });
      }
    }
    const details = readDetails(body);
    const { id, voice } = body ?? {};
    if (!details || !isWritingId(id) || !isWritingVoice(voice)) {
      return apiJson({ error: 'Invalid AI Write settings' }, { status: 400, headers });
    }
    if (recording.status !== 'READY') return apiJson({ error: 'Recording is not ready' }, { status: 409, headers });

    try {
      const key = { recordingId: recording.id, id };
      const row = await prisma.recordingWriting.findUnique({ where: { recordingId_id: key } });
      const presentation = row?.status === 'READY' ? readPresentation(row.content) : null;
      if (!row || !presentation) return apiJson({ error: 'AI Write not found' }, { status: 404, headers });
      await prisma.recordingWriting.update({
        where: { recordingId_id: key },
        data: { ...details, voice, content: { ...presentation, title: details.name } as unknown as Prisma.InputJsonValue },
      });
      if (row.voice !== voice) {
        after(() => prepareSmartPlayVoice(recording.id, presentation, voice));
      }
      return apiJson({ writings: await loadWritings(recording.id) }, { headers });
    } catch {
      return apiJson({ error: 'Could not save AI Write' }, { status: 500, headers });
    }
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return runWithLocale(req, async () => {
    const loaded = await loadManagedRecording(req, (await params).id);
    if (isRecordingResponse(loaded)) return loaded;
    const { recording } = loaded;
    const body = await req.json().catch(() => null);
    if (!isWritingId(body?.id)) return apiJson({ error: 'Invalid AI Write' }, { status: 400, headers });
    if (recording.status !== 'READY') return apiJson({ error: 'Recording is not ready' }, { status: 409, headers });

    try {
      const where = { recordingId: recording.id, id: body.id };
      const deleted = await prisma.recordingWriting.deleteMany({
        where: { ...where, OR: [
          { status: { not: 'GENERATING' } },
          { status: 'GENERATING', startedAt: { lte: new Date(Date.now() - WRITING_STALE_MS) } },
        ] },
      });
      if (!deleted.count && await prisma.recordingWriting.findUnique({ where: { recordingId_id: where } })) {
        return apiJson({ error: 'AI Write is still being generated' }, { status: 409, headers });
      }
      return apiJson({ writings: await loadWritings(recording.id) }, { headers });
    } catch {
      return apiJson({ error: 'Could not delete AI Write' }, { status: 500, headers });
    }
  });
}
