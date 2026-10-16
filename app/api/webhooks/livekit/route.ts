import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { WebhookReceiver } from 'livekit-server-sdk';
import {
  expireStaleIdleMeetings,
  markMeetingIdleFromEmptyRoom,
  MEETING_STATUS,
  resumeIdleMeeting,
} from '@/lib/meetingRejoin';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

const receiver = new WebhookReceiver(API_KEY || '', API_SECRET || '');

/** LiveKit egress 时间戳为纳秒；0 表示尚未开始 */
function nsToDate(ns: bigint): Date | null {
  return ns > 0n ? new Date(Number(ns / 1_000_000n)) : null;
}

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
      const mediaStartedAt = nsToDate(event.egressInfo.startedAt);
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

      if (recording) {
        if (error) {
          await prisma.recording.update({
            where: { id: recording.id },
            data: { status: 'FAILED' }
          });
        } else if (fileInfo) {
          const mediaStartedAt =
            nsToDate(fileInfo.startedAt) ??
            recording.mediaStartedAt ??
            nsToDate(event.egressInfo.startedAt);
          await prisma.recording.update({
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
        }
      }
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
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[webhooks livekit POST]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
