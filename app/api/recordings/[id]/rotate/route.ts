import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  isRecordingResponse,
  loadManagedRecording,
  newShareKey,
  recordingSharePayload,
} from '@/lib/recordingShare';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const loaded = await loadManagedRecording(req, id);
    if (isRecordingResponse(loaded)) return loaded;

    const shareKey = newShareKey();
    const updated = await prisma.recording.update({
      where: { id: loaded.recording.id },
      data: { shareKey },
    });

    return NextResponse.json(recordingSharePayload({
      shareKey,
      visibility: updated.visibility,
    }));
  } catch (error: unknown) {
    console.error('[recordings rotate POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
