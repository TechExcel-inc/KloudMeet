import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { apiJson } from '@/lib/apiMsg';
import { prisma } from '@/lib/db';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { fetchKloudUserId } from '@/lib/kloudAuth';
import { resolveStageIdentity } from '@/lib/livedoc/stageIdentity.server';
import { loadLiveDocWritingPdf, saveLiveDocWritingPdf } from '@/lib/livedoc/writingAttachment.server';
import { authorizeRecordingView, findRecordingByKey, isRecordingResponse, loadManagedRecording } from '@/lib/recordingShare';
import { isWritingId } from '@/lib/replayWriting';
import { readWritingPdf, writingState } from '@/lib/replayWriting.server';

import { renderReplayWritingPdf } from '@/lib/renderReplayWritingPdf.server';
import { SHOT_KIND } from '@/lib/shareShot';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const id = req.nextUrl.searchParams.get('write');
  if (!isWritingId(id)) return apiJson({ error: 'Invalid AI Write' }, { status: 400, headers });
  const recording = await findRecordingByKey((await params).id);
  if (!recording) return apiJson({ error: 'Recording not found' }, { status: 404, headers });
  const access = await authorizeRecordingView(req, recording);
  if (isRecordingResponse(access)) return access;
  const row = await prisma.recordingWriting.findUnique({ where: { recordingId_id: { recordingId: recording.id, id } } });
  const pdf = row?.status === 'READY' ? readWritingPdf(row.content) : null;
  if (!pdf) return apiJson({ error: 'PDF attachment not found' }, { status: 404, headers });
  try {
    const bytes = await loadLiveDocWritingPdf(pdf);
    if (!bytes) throw new Error('Missing PDF body');
    return new Response(new Uint8Array(bytes), {
      headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return apiJson({ error: 'Could not download PDF' }, { status: 502, headers });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const access = await loadManagedRecording(req, (await params).id);
  if (isRecordingResponse(access)) return access;
  const id = req.nextUrl.searchParams.get('write');
  if (!isWritingId(id)) return apiJson({ error: 'Invalid AI Write' }, { status: 400, headers });
  const where = { recordingId_id: { recordingId: access.recording.id, id } };
  const row = await prisma.recordingWriting.findUnique({ where });
  const write = row ? writingState(row) : null;
  if (!row || !write?.presentation || !row.content || typeof row.content !== 'object' || Array.isArray(row.content)) {
    return apiJson({ error: 'AI Write is not ready' }, { status: 409, headers });
  }
  const existing = readWritingPdf(row.content);
  if (existing) return apiJson({ name: existing.name }, { headers });
  const title = write.name || write.presentation.title || 'AI Write';
  const name = (title.replace(/[\x00-\x1f\\/]/g, '').slice(0, 176).trim() || 'AI Write') + '.pdf';
  try {
    const member = await getSessionTeamMember(req);
    const rawToken = req.cookies.get('kloud_sso_token')?.value;
    let ssoToken = rawToken ?? null;
    if (rawToken) {
      try { ssoToken = decodeURIComponent(rawToken); } catch { /* use the cookie as supplied */ }
    }
    const identity = await resolveStageIdentity({ member, ssoToken });
    const userId = identity.token ? await fetchKloudUserId(identity.token) : null;
    if (!identity.token || !userId) {
      return apiJson({ error: 'A Kloud LiveDoc account is required to attach a PDF' }, { status: 403, headers });
    }
    const shots = await prisma.recordingSection.findMany({
      where: { recordingId: row.recordingId, kind: SHOT_KIND, status: 'READY' },
      select: { storageKey: true, startMs: true, endMs: true },
    });
    const bytes = await renderReplayWritingPdf(write.presentation, title, access.recording, shots);
    const pdf = await saveLiveDocWritingPdf({ token: identity.token, userId }, name, bytes);
    const updated = await prisma.recordingWriting.updateMany({
      where: { recordingId: row.recordingId, id, status: 'READY', content: { equals: row.content as Prisma.InputJsonObject } },
      data: { content: { ...row.content, pdf } },
    });
    if (!updated.count) return apiJson({ error: 'AI Write has changed. Try again.' }, { status: 409, headers });
    return apiJson({ name }, { headers });
  } catch {
    return apiJson({ error: 'Could not generate and save PDF to LiveDoc' }, { status: 500, headers });
  }
}
