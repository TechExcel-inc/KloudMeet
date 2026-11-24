import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { apiJson } from '@/lib/apiMsg';
import { prisma } from '@/lib/db';
import { isRecordingResponse, loadManagedRecording } from '@/lib/recordingShare';
import { isWritingId } from '@/lib/replayWriting';
import { readWritingPdf, writingRevision, writingState } from '@/lib/replayWriting.server';
import { renderReplayWritingPdf } from '@/lib/renderReplayWritingPdf.server';
import { SHOT_KIND } from '@/lib/shareShot';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const access = await loadManagedRecording(req, (await params).id);
  if (isRecordingResponse(access)) return access;
  const id = req.nextUrl.searchParams.get('write');
  if (!isWritingId(id)) return apiJson({ error: 'Invalid AI Write' }, { status: 400, headers });
  const recording = access.recording;
  const row = await prisma.recordingWriting.findUnique({ where: { recordingId_id: { recordingId: recording.id, id } } });
  const write = row ? writingState(row) : null;
  if (!row || !write?.presentation || !row.content || typeof row.content !== 'object' || Array.isArray(row.content)) {
    return apiJson({ error: 'AI Write is not ready' }, { status: 409, headers });
  }
  const meeting = await prisma.meeting.findUnique({
    where: { id: recording.meetingId }, select: { kloudMeetingId: true },
  });
  if (!meeting?.kloudMeetingId) return apiJson({ error: 'This meeting has no LiveDoc session' }, { status: 409, headers });

  const existing = readWritingPdf(row.content);
  if (existing) return apiJson({ pdf: existing }, { headers });
  const title = write.name || write.presentation.title || 'AI Write';
  const name = (title.replace(/[\x00-\x1f\\/]/g, '').slice(0, 176).trim() || 'AI Write') + '.pdf';
  const revision = writingRevision(write);
  try {
    if (req.nextUrl.searchParams.get('link') === '1') {
      const body = await req.json().catch(() => null);
      if (!Number.isSafeInteger(body?.attachmentId) || body.attachmentId < 1 || body.revision !== revision) {
        return apiJson({ error: 'Invalid PDF attachment or AI Write changed' }, { status: 409, headers });
      }
      const pdf = { name, attachmentId: body.attachmentId as number };
      const updated = await prisma.recordingWriting.updateMany({
        where: { recordingId: row.recordingId, id, status: 'READY', content: { equals: row.content as Prisma.InputJsonObject } },
        data: { content: { ...row.content, pdf } },
      });
      if (!updated.count) return apiJson({ error: 'AI Write has changed. Try again.' }, { status: 409, headers });
      return apiJson({ pdf }, { headers });
    }
    const shots = await prisma.recordingSection.findMany({
      where: { recordingId: row.recordingId, kind: SHOT_KIND, status: 'READY' },
      select: { storageKey: true, startMs: true, endMs: true },
    });
    const bytes = await renderReplayWritingPdf(write.presentation, title, recording, shots);
    return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'application/pdf',
      'X-Writing-Revision': revision, 'X-LiveDoc-Meeting': String(meeting.kloudMeetingId),
      'X-Pdf-Name': encodeURIComponent(name) } });
  } catch {
    return apiJson({ error: 'Could not prepare the LiveDoc PDF' }, { status: 500, headers });
  }
}
