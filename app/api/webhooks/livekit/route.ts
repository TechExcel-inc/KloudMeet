import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { WebhookReceiver } from 'livekit-server-sdk';
import { generateTranscriptFromRecording } from '@/lib/postRecordingTranscription';
import {
  markMeetingIdleFromEmptyRoom,
  MEETING_STATUS,
} from '@/lib/meetingRejoin';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

const receiver = new WebhookReceiver(API_KEY || '', API_SECRET || '');

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const authHeader = request.headers.get('Authorization');

    if (!authHeader) {
      return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 });
    }

    let event;
    try {
      // livekit-server-sdk receiver verifies the signature and parses the event payload
      event = await receiver.receive(body, authHeader, true);
    } catch (err: any) {
      console.error('[webhooks livekit] signature validation failed', err);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    console.log(`[webhooks livekit] Received event: ${event.event}`);

    if (event.event === 'egress_ended' && event.egressInfo) {
      const egressId = event.egressInfo.egressId;
      const fileInfo = event.egressInfo.fileResults?.[0] || (event.egressInfo.result?.case === 'file' ? event.egressInfo.result.value : null);
      const error = event.egressInfo.error;

      // Find the recording by egressId which we stored in storageKey temporarily
      const recording = await prisma.recording.findFirst({
        where: { storageKey: egressId }
      });

      if (recording) {
        if (error) {
          await prisma.recording.update({
            where: { id: recording.id },
            data: { status: 'FAILED' }
          });
        } else if (fileInfo) {
          await prisma.recording.update({
            where: { id: recording.id },
            data: {
              status: 'READY',
              storageKey: fileInfo.filename || egressId, // Real Object Key
              storageUrl: fileInfo.location, // Public URL if the bucket is configured as such
              fileSizeBytes: fileInfo.size ? Number(fileInfo.size) : null,
              durationSeconds: fileInfo.duration ? Math.floor(Number(fileInfo.duration) / 1000000000) : null,
            }
          });

          // If live STT was not enabled, backfill transcripts from the recorded media.
          void generateTranscriptFromRecording(recording.id).catch((transcribeErr) => {
            console.error('[webhooks livekit] post-recording transcription failed', transcribeErr);
          });
        }
      }
    }

    // Capture Exact Start Time when the first user joins an Instant or Scheduled Meeting
    if (event.event === 'room_started' && event.room) {
      const roomName = event.room.name;
      const actualStartedAt = new Date(Number(event.room.creationTime) * 1000);
      
      const meeting = await prisma.meeting.findUnique({ where: { roomName } });
      if (meeting && meeting.status !== MEETING_STATUS.ENDED) {
        const data: {
          actualStartedAt?: Date;
          status: string;
          roomEmptyAt?: null;
          endedReason?: null;
          rejoinableUntil?: null;
        } = { status: MEETING_STATUS.ACTIVE };
        if (!meeting.actualStartedAt) {
          data.actualStartedAt = actualStartedAt;
        }
        if (meeting.status === MEETING_STATUS.IDLE) {
          data.roomEmptyAt = null;
          data.endedReason = null;
          data.rejoinableUntil = null;
        }
        await prisma.meeting.update({
          where: { roomName },
          data,
        });
      }
    }

    // Room empty → IDLE (not ENDED); lazy transition to ENDED after grace on next read
    if (event.event === 'room_finished' && event.room) {
      const roomName = event.room.name;

      const meeting = await prisma.meeting.findUnique({ where: { roomName } });
      if (
        meeting &&
        meeting.status !== MEETING_STATUS.ENDED &&
        meeting.status !== MEETING_STATUS.IDLE
      ) {
        await markMeetingIdleFromEmptyRoom(meeting.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[webhooks livekit POST]', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
