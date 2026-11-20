import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import {
  isRecordingResponse,
  loadManagedRecording,
  readVisibility,
  recordingSharePayload,
} from '@/lib/recordingShare';
import { checkPublicReplayAllowed } from '@/lib/billing/limits';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithLocale(req, async () => {
  try {
    const { id } = await params;
    const loaded = await loadManagedRecording(req, id);
    if (isRecordingResponse(loaded)) return loaded;

    const body = await req.json().catch(() => null);
    if (body?.action === 'edit-meeting') {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : null;
      if (!title || title.length > 191 || description === null || description.length > 191) {
        return apiJson({ error: 'Invalid meeting name or description' }, { status: 400 });
      }
      const meeting = await prisma.meeting.update({
        where: { id: loaded.recording.meetingId },
        data: { title, description: description || null, modifiedAt: new Date() },
        select: { title: true, description: true },
      });
      return apiJson(meeting);
    }

    const visibility = readVisibility(body);
    if (!visibility) {
      return apiJson({ error: 'Invalid visibility' }, { status: 400 });
    }

    // Billing (no-op when disabled): public replay links are a paid feature.
    if (visibility === 'PUBLIC' && loaded.recording.visibility !== 'PUBLIC') {
      const planError = await checkPublicReplayAllowed(loaded.memberId);
      if (planError) return planError;
    }

    const updated = await prisma.recording.update({
      where: { id: loaded.recording.id },
      data: { visibility },
    });

    return apiJson(recordingSharePayload({
      shareKey: loaded.shareKey,
      visibility: updated.visibility,
    }));
  } catch (error: unknown) {
    console.error('[recordings PATCH]', error);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
