import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { WebhookReceiver } from 'livekit-server-sdk';
import { egressTimeToDate } from '@/lib/recordingSpeakActivity';
import {
  expireStaleIdleMeetings,
  markMeetingIdleFromEmptyRoom,
  MEETING_STATUS,
  resumeIdleMeeting,
} from '@/lib/meetingRejoin';
import { onRecordingReady } from '@/lib/billing/limits';
import { meterCaptions, meterSafely } from '@/lib/billing/usage';
import { parsePauseSpans, pausedSeconds } from '@/lib/recordingControls';
import { startRecordingTranscription } from '@/lib/aliyunRecordingTranscription';
import { finishLivedocRecording } from '@/lib/livedoc/kloudRecording';
import { onSectionEgressEnded, onTrackPublished } from '@/lib/livedoc/screenSections';

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
    } catch (err: unknown) {
      console.error('[webhooks livekit] signature validation failed', err);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    console.log(`[webhooks livekit] Received event: ${event.event}`);

    // 顺带扫过期空会，避免无人访问时长期停在 IDLE
    void expireStaleIdleMeetings().catch((err: unknown) => {
      console.error('[webhooks livekit] expire stale idle failed', err);
    });

    // 录像时间零点：尽早写入，结束时用文件实际起点覆盖
    if ((event.event === 'egress_started' || event.event === 'egress_updated') && event.egressInfo) {
      const mediaStartedAt = egressTimeToDate(event.egressInfo.startedAt);
      if (mediaStartedAt) {
        await prisma.recording.updateMany({
          where: { storageKey: event.egressInfo.egressId, mediaStartedAt: null },
          data: { mediaStartedAt },
        });
      }
    }

    if (event.event === 'egress_ended' && event.egressInfo) {
      const egressId = event.egressInfo.egressId;
      const fileInfo = event.egressInfo.fileResults?.[0] || (event.egressInfo.result?.case === 'file' ? event.egressInfo.result.value : null);
      const error = event.egressInfo.error;

      // Find the recording by egressId which we stored in storageKey temporarily
      const recording = await prisma.recording.findFirst({
        where: { storageKey: egressId }
      });

      // LiveDoc Full Recording: a screen-share section's file
      if (!recording) {
        await onSectionEgressEnded(event.egressInfo);
      }

      if (recording) {
        // LiveDoc Full Recording: the media has ended, so Kloud stops saving actions too.
        if (recording.kind === 'livedoc_full') {
          const meeting = await prisma.meeting.findUnique({
            where: { id: recording.meetingId },
            select: { kloudMeetingId: true },
          });
          await finishLivedocRecording(recording, meeting?.kloudMeetingId ?? null);
        }
        if (error) {
          await prisma.recording.update({
            where: { id: recording.id },
            data: { status: 'FAILED' }
          });
        } else if (fileInfo) {
          const mediaStartedAt =
            egressTimeToDate(fileInfo.startedAt) ??
            recording.mediaStartedAt ??
            egressTimeToDate(event.egressInfo.startedAt);
          const ready = await prisma.recording.update({
            where: { id: recording.id },
            data: {
              status: 'READY',
              mediaStartedAt,
              storageKey: fileInfo.filename || egressId, // Real Object Key
              storageUrl: fileInfo.location, // Public URL if the bucket is configured as such
              fileSizeBytes: fileInfo.size ? Number(fileInfo.size) : null,
              durationSeconds: fileInfo.duration ? Math.floor(Number(fileInfo.duration) / 1000000000) : null,
            }
          });
          // Billing (no-op when disabled): meter rec:<id> seconds, then Free replay retention.
          // Paused stretches are in the file but skipped on replay, so they aren't billed.
          const paused = pausedSeconds(parsePauseSpans(ready.pauseSpans));
          await onRecordingReady({
            ...ready,
            durationSeconds: ready.durationSeconds === null ? null : Math.max(0, ready.durationSeconds - paused),
          });
          // Sync transcript: transcribe now unless the meeting already has a live-caption transcript.
          if (ready.syncTranscript) {
            const captionLines = await prisma.meetingTranscript.count({ where: { meetingId: ready.meetingId } });
            if (captionLines === 0) {
              await startRecordingTranscription(ready).catch((err) =>
                console.error('[webhook] sync transcript failed to start', ready.id, err),
              );
            }
          }
        }
      }
    }

    // LiveDoc Full Recording: record each screen share on its own while the meeting records
    if (event.event === 'track_published' && event.room && event.participant) {
      await onTrackPublished(event.room.name, event.track, event.participant.identity).catch((err) =>
        console.error('[webhooks livekit] screen section failed to start', err),
      );
    }

    // Capture Exact Start Time when the first user joins an Instant or Scheduled Meeting
    if (event.event === 'room_started' && event.room) {
      const roomName = event.room.name;
      const actualStartedAt = new Date(Number(event.room.creationTime) * 1000);

      const meeting = await prisma.meeting.findUnique({ where: { roomName } });
      if (meeting && meeting.status !== MEETING_STATUS.ENDED) {
        if (meeting.status === MEETING_STATUS.IDLE) {
          await resumeIdleMeeting(meeting.id);
        }
        const data: {
          actualStartedAt?: Date;
          status: string;
        } = { status: MEETING_STATUS.ACTIVE };
        if (!meeting.actualStartedAt) {
          data.actualStartedAt = actualStartedAt;
        }
        await prisma.meeting.update({
          where: { roomName },
          data,
        });
      }
    }

    // Room empty → IDLE；宽限期（默认 30 分钟）后自动 ENDED
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
      if (meeting) {
        // LiveDoc Full Recording: everyone left, so end Kloud's recording (stop may never come).
        const livedocRecordings = await prisma.recording.findMany({
          where: { meetingId: meeting.id, kind: 'livedoc_full', livedocToken: { not: null } },
        });
        for (const rec of livedocRecordings) {
          await finishLivedocRecording(rec, meeting.kloudMeetingId);
        }
        // Billing (no-op when disabled): caption minutes × 60 → host account, idempotent on cap:<meetingId>.
        await meterSafely(`cap:${meeting.id}`, () => meterCaptions(meeting));
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[webhooks livekit POST]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
