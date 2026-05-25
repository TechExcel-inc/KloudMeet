import { NextRequest, NextResponse } from 'next/server';
import {
  resolveRoomEntry,
  serializeRoomEntryResolution,
} from '@/lib/resolvePersonalRoomJoin';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ personalRoomId: string }> },
) {
  try {
    const { personalRoomId } = await params;
    if (!personalRoomId?.trim()) {
      return NextResponse.json({ error: 'Room id not provided' }, { status: 400 });
    }

    const resolution = await resolveRoomEntry(personalRoomId);
    if (resolution.kind === 'not_found') {
      return NextResponse.json({ kind: 'not_found' }, { status: 404 });
    }

    return NextResponse.json(serializeRoomEntryResolution(resolution));
  } catch (error) {
    console.error('[rooms resolve GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
