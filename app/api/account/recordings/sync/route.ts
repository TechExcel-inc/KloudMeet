import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { EgressClient } from 'livekit-server-sdk';
import { egressOutputFile } from '@/lib/egressFile';
import { egressTimeToDate } from '@/lib/recordingSpeakActivity';
import { onRecordingReady } from '@/lib/billing/limits';
import { finishScreenSections } from '@/lib/livedoc/screenSections';

const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const API_KEY = process.env.LIVEKIT_API_KEY || '';
const API_SECRET = process.env.LIVEKIT_API_SECRET || '';

export async function GET(request: NextRequest) {
  try {
    const member = await getSessionTeamMember(request);
    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
      return NextResponse.json({ error: 'LiveKit configuration missing' }, { status: 500 });
    }

    const egressClient = new EgressClient(LIVEKIT_URL, API_KEY, API_SECRET);

    // Find processing recordings for this user
    const processingRecordings = await prisma.recording.findMany({
      where: {
        teamMemberId: member.id,
        status: { in: ['PROCESSING', 'UPLOADING'] }
      }
    });

    let updatedCount = 0;

    for (const rec of processingRecordings) {
      const egressId = rec.storageKey;
      if (!egressId) continue;

      try {
        const egresses = await egressClient.listEgress({ egressId });
        if (!egresses || egresses.length === 0) continue;
        
        const egressInfo = egresses[0];
        
        // Use type-safe enum comparing if possible, but fallback to string representation
        const statusStr = egressInfo.status.toString();
        
        let newStatus = null;
        const fileInfo = egressOutputFile(egressInfo);

        // 3 = EGRESS_COMPLETE, 4 = EGRESS_FAILED, 5 = EGRESS_ABORTED, 6 = EGRESS_LIMIT_REACHED
        if (statusStr === 'EGRESS_COMPLETE' || statusStr === '3') {
          newStatus = 'READY';
        } else if (['EGRESS_FAILED', 'EGRESS_ABORTED', 'EGRESS_LIMIT_REACHED', '4', '5', '6'].includes(statusStr)) {
          newStatus = 'FAILED';
        }

        if (newStatus === 'READY' && fileInfo) {
          const ready = await prisma.recording.update({
            where: { id: rec.id },
            data: {
              status: 'READY',
              mediaStartedAt:
                egressTimeToDate(fileInfo.startedAt) ??
                rec.mediaStartedAt ??
                egressTimeToDate(egressInfo.startedAt),
              storageKey: fileInfo.filename || egressId,
              storageUrl: fileInfo.location,
              fileSizeBytes: fileInfo.size ? Number(fileInfo.size) : null,
              durationSeconds: fileInfo.duration ? Math.floor(Number(fileInfo.duration) / 1000000000) : null,
            }
          });
          // Billing (no-op when disabled): same metering as egress_ended; rec:<id> is idempotent.
          await onRecordingReady(ready);
          updatedCount++;
        } else if (newStatus === 'FAILED') {
          await prisma.recording.update({
            where: { id: rec.id },
            data: { status: 'FAILED' }
          });
          updatedCount++;
        }
      } catch (e) {
        console.error(`Failed to sync egress ${egressId}:`, e);
      }
    }

    // LiveDoc Full: screen sections whose egress has ended
    const open = await prisma.recordingSection.findMany({
      where: { status: 'PROCESSING', recording: { teamMemberId: member.id } },
      select: { recordingId: true },
      distinct: ['recordingId'],
    });
    await finishScreenSections(open.map((section) => section.recordingId)).catch((e) =>
      console.error('[account recordings sync] screen sections failed to finish', e),
    );

    return NextResponse.json({ success: true, updatedCount });
  } catch (error: any) {
    console.error('[account recordings sync GET]', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
