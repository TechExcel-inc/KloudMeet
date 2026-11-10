import { RoomServiceClient, TrackSource, type ParticipantInfo } from 'livekit-server-sdk';
import { prisma } from '@/lib/db';
import { isRecorderParticipant } from '@/lib/recorderParticipant';
import { isPresenceKind, type PresenceKind } from '@/lib/livedoc/presence';

export interface PresenceInput {
  identity: string;
  name: string;
  kind: PresenceKind;
  on: boolean;
}

/** The recording bot is marked in token metadata, which participants cannot set themselves. */
export function isPresenceRecorder(metadata?: string): boolean {
  return isRecorderParticipant({ metadata });
}

function clean(event: PresenceInput): PresenceInput | null {
  const identity = event.identity.trim().slice(0, 191);
  if (!identity || !isPresenceKind(event.kind) || typeof event.on !== 'boolean') {
    return null;
  }
  return { identity, name: event.name.trim().slice(0, 80), kind: event.kind, on: event.on };
}

/**
 * appendPresence — 把一批状态写进正在进行的 LiveDoc 全量录制。
 * 与上一条相同的状态不重复写。时间取服务器收到的时刻。
 */
export async function appendPresence(roomName: string, raw: PresenceInput[]): Promise<number> {
  const events = raw.map(clean).filter((event): event is PresenceInput => event !== null);
  if (!events.length) return 0;
  const meeting = await prisma.meeting.findUnique({ where: { roomName }, select: { id: true } });
  if (!meeting) return 0;
  const recording = await prisma.recording.findFirst({
    where: { meetingId: meeting.id, kind: 'livedoc_full', status: 'PROCESSING', deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, livedocStartedAt: true },
  });
  if (!recording?.livedocStartedAt) return 0;
  const atMs = Math.max(0, Date.now() - recording.livedocStartedAt.getTime());
  let wrote = 0;
  for (const event of events) {
    const last = await prisma.recordingPresence.findFirst({
      where: { recordingId: recording.id, identity: event.identity, kind: event.kind },
      orderBy: [{ atMs: 'desc' }, { id: 'desc' }],
      select: { on: true },
    });
    if (last && last.on === event.on) continue;
    await prisma.recordingPresence.create({
      data: {
        recordingId: recording.id,
        identity: event.identity,
        name: event.name,
        kind: event.kind,
        on: event.on,
        atMs,
      },
    });
    wrote += 1;
  }
  return wrote;
}

function deviceOn(participant: ParticipantInfo, source: TrackSource): boolean {
  const track = participant.tracks.find((item) => item.source === source);
  return !!track && !track.muted;
}

/** Who is already in the room when LiveDoc Full recording starts, with mic and camera as they are. */
export async function snapshotPresence(roomName: string): Promise<void> {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) return;
  const participants = await new RoomServiceClient(url, key, secret).listParticipants(roomName);
  const events: PresenceInput[] = [];
  for (const participant of participants) {
    if (isPresenceRecorder(participant.metadata)) continue;
    const name = participant.name || participant.identity;
    events.push(
      { identity: participant.identity, name, kind: 'room', on: true },
      { identity: participant.identity, name, kind: 'mic', on: deviceOn(participant, TrackSource.MICROPHONE) },
      { identity: participant.identity, name, kind: 'cam', on: deviceOn(participant, TrackSource.CAMERA) },
    );
  }
  await appendPresence(roomName, events);
}
