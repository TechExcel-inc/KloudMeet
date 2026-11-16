import { NextRequest } from 'next/server';
import {
  resolveRoomEntry,
  serializeRoomEntryResolution,
} from '@/lib/resolvePersonalRoomJoin';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ personalRoomId: string }> },
) {
  return runWithLocale(_request, async () => {
  try {
    const { personalRoomId } = await params;
    if (!personalRoomId?.trim()) {
      return apiJson({ error: 'Room id not provided' }, { status: 400 });
    }

    const resolution = await resolveRoomEntry(personalRoomId);
    if (resolution.kind === 'not_found') {
      return apiJson({ kind: 'not_found' }, { status: 404 });
    }

    return apiJson(serializeRoomEntryResolution(resolution));
  } catch (error) {
    console.error('[rooms resolve GET]', error);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
