import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  isRecordingResponse,
  loadManagedRecording,
  readVisibility,
  recordingSharePayload,
} from '@/lib/recordingShare';
import { checkPublicReplayAllowed } from '@/lib/billing/limits';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const loaded = await loadManagedRecording(req, id);
    if (isRecordingResponse(loaded)) return loaded;

    const visibility = readVisibility(await req.json().catch(() => null));
    if (!visibility) {
      return NextResponse.json({ error: 'Invalid visibility' }, { status: 400 });
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

    return NextResponse.json(recordingSharePayload({
      shareKey: loaded.shareKey,
      visibility: updated.visibility,
    }));
  } catch (error: unknown) {
    console.error('[recordings PATCH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
