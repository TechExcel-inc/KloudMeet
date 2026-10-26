import {
  DirectFileOutput,
  EgressClient,
  EgressStatus,
  RoomServiceClient,
  TrackSource,
  type EgressInfo,
} from 'livekit-server-sdk';
import { prisma } from '@/lib/db';
import { egressTimeToDate } from '@/lib/recordingSpeakActivity';

/**
 * LiveDoc Full Recording: each screen share is recorded on its own (a LiveKit track egress of the
 * screen-share video) as a RecordingSection placed on Kloud's LiveDoc timeline, so the replay can
 * show it full view for the stretch it was on. The voice is recorded separately.
 *
 * Webhooks are not relied on: a share is also reported by the page that started the recording,
 * and sections are finished by asking LiveKit for their egress (on stop, sync and replay).
 */

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

function egressClient(): EgressClient | null {
  if (!LIVEKIT_URL || !API_KEY || !API_SECRET) return null;
  return new EgressClient(LIVEKIT_URL, API_KEY, API_SECRET);
}

/** The recording bucket (S3 or Aliyun OSS), as the record route uses it. */
function directFileOutput(filepath: string): DirectFileOutput | null {
  const { S3_ACCESS_KEY, S3_SECRET, S3_REGION, S3_BUCKET, S3_ENDPOINT } = process.env;
  if (!S3_ACCESS_KEY || !S3_SECRET || !S3_REGION || !S3_BUCKET) return null;
  if (S3_ENDPOINT && S3_ENDPOINT.includes('aliyuncs.com')) {
    return new DirectFileOutput({
      filepath,
      output: {
        case: 'aliOSS',
        value: { accessKey: S3_ACCESS_KEY, secret: S3_SECRET, region: S3_REGION, bucket: S3_BUCKET, endpoint: S3_ENDPOINT },
      },
    });
  }
  return new DirectFileOutput({
    filepath,
    output: {
      case: 's3',
      value: {
        accessKey: S3_ACCESS_KEY,
        secret: S3_SECRET,
        region: S3_REGION,
        bucket: S3_BUCKET,
        ...(S3_ENDPOINT && !S3_ENDPOINT.includes('amazonaws.com') ? { endpoint: S3_ENDPOINT } : {}),
      },
    },
  });
}

/** The running livedoc_full recording of a room, if any. */
async function activeLivedocRecording(roomName: string) {
  const meeting = await prisma.meeting.findUnique({ where: { roomName }, select: { id: true } });
  if (!meeting) return null;
  return prisma.recording.findFirst({
    where: { meetingId: meeting.id, kind: 'livedoc_full', status: 'PROCESSING', deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/** Starts in progress, by track, so the webhook and the page reporting the same share start it once. */
const starting = new Map<string, Promise<void>>();

/** Start recording one screen-share track of a running livedoc_full recording (once per track). */
export function startScreenSection(
  recording: { id: number; livedocStartedAt: Date | null },
  roomName: string,
  trackSid: string,
  identity: string,
): Promise<void> {
  const running = starting.get(trackSid);
  if (running) return running;
  const job = start(recording, roomName, trackSid, identity).finally(() => starting.delete(trackSid));
  starting.set(trackSid, job);
  return job;
}

async function start(
  recording: { id: number; livedocStartedAt: Date | null },
  roomName: string,
  trackSid: string,
  identity: string,
): Promise<void> {
  const client = egressClient();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // No extension: LiveKit adds the one that fits the track's codec.
  const output = directFileOutput(`recordings/${roomName}-screen-${stamp}`);
  if (!client || !output) return;
  const active = await client.listEgress({ roomName, active: true });
  if (active.some((info) => info.request.case === 'track' && info.request.value.trackId === trackSid)) return;
  const info = await client.startTrackEgress(roomName, output, trackSid);
  const startMs = recording.livedocStartedAt ? Date.now() - recording.livedocStartedAt.getTime() : null;
  await prisma.recordingSection.create({
    data: {
      recordingId: recording.id,
      kind: 'screen',
      storageKey: info.egressId,
      providerRef: info.egressId,
      startMs,
      userId: identity,
    },
  });
}

/** LiveKit track_published: a screen share started in a room that records LiveDoc Full. */
export async function onTrackPublished(
  roomName: string,
  track: { sid: string; source: TrackSource } | undefined,
  identity: string,
): Promise<void> {
  if (!track || track.source !== TrackSource.SCREEN_SHARE) return;
  const recording = await activeLivedocRecording(roomName);
  if (!recording) return;
  await startScreenSection(recording, roomName, track.sid, identity);
}

/** Recording starts while someone already shares their screen. */
export async function startScreenSectionsForRoom(
  recording: { id: number; livedocStartedAt: Date | null },
  roomName: string,
): Promise<void> {
  if (!LIVEKIT_URL || !API_KEY || !API_SECRET) return;
  const rooms = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
  const participants = await rooms.listParticipants(roomName);
  for (const p of participants) {
    for (const track of p.tracks) {
      if (track.source === TrackSource.SCREEN_SHARE) {
        await startScreenSection(recording, roomName, track.sid, p.identity);
      }
    }
  }
}

/** Recording stops: finish the screen sections already done, stop the ones still running. */
export async function stopScreenSections(recordingId: number): Promise<void> {
  const client = egressClient();
  if (!client) return;
  await finishScreenSections([recordingId]);
  const running = await prisma.recordingSection.findMany({
    where: { recordingId, kind: 'screen', status: 'PROCESSING' },
  });
  for (const section of running) {
    await client.stopEgress(section.providerRef).catch((e) =>
      console.error('[screenSections] stopEgress failed', section.providerRef, e),
    );
  }
}

const ENDED = [EgressStatus.EGRESS_COMPLETE, EgressStatus.EGRESS_FAILED, EgressStatus.EGRESS_ABORTED, EgressStatus.EGRESS_LIMIT_REACHED];

/** Finish the screen sections of these recordings whose egress has ended, asking LiveKit (no webhook needed). */
export async function finishScreenSections(recordingIds: number[]): Promise<void> {
  const client = egressClient();
  if (!client || recordingIds.length === 0) return;
  const open = await prisma.recordingSection.findMany({
    where: { recordingId: { in: recordingIds }, kind: 'screen', status: 'PROCESSING' },
  });
  for (const section of open) {
    const info = await client
      .listEgress({ egressId: section.providerRef })
      .then((list) => list[0])
      .catch((e) => console.error('[screenSections] listEgress failed', section.providerRef, e));
    if (info && ENDED.includes(info.status)) await settle(section, info);
  }
}

/** LiveKit egress_ended for a screen section: the file is ready (or failed). Returns true if it was one. */
export async function onSectionEgressEnded(info: EgressInfo): Promise<boolean> {
  const section = await prisma.recordingSection.findFirst({ where: { providerRef: info.egressId } });
  if (!section) return false;
  if (section.status === 'PROCESSING') await settle(section, info);
  return true;
}

/** An ended egress: its section is READY with the file placed on Kloud's timeline, or FAILED. */
async function settle(section: { id: number; recordingId: number; startMs: number | null }, info: EgressInfo) {
  const file = info.fileResults?.[0] ?? (info.result?.case === 'file' ? info.result.value : null);
  if (info.error || !file?.filename) {
    await prisma.recordingSection.update({ where: { id: section.id }, data: { status: 'FAILED' } });
    return;
  }
  const recording = await prisma.recording.findUnique({
    where: { id: section.recordingId },
    select: { livedocStartedAt: true },
  });
  // Place the file exactly: its own start on Kloud's timeline, and its length.
  const fileStart = egressTimeToDate(file.startedAt) ?? egressTimeToDate(info.startedAt);
  const startMs =
    fileStart && recording?.livedocStartedAt
      ? fileStart.getTime() - recording.livedocStartedAt.getTime()
      : section.startMs;
  const durationMs = file.duration ? Math.round(Number(file.duration) / 1_000_000) : null;
  await prisma.recordingSection.update({
    where: { id: section.id },
    data: {
      status: 'READY',
      storageKey: file.filename,
      startMs,
      endMs: startMs !== null && durationMs !== null ? startMs + durationMs : null,
    },
  });
}
