import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { EgressClient, EncodedFileType, EncodedFileOutput, StreamOutput, StreamProtocol } from 'livekit-server-sdk';
import { hasNoMedia, liveNotesEnabled, NO_MEDIA_PROVIDER } from '@/lib/liveNotes';
import { askRecorderToFlush, finishLiveNotes } from '@/lib/liveNotesServer';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { newShareKey } from '@/lib/recordingShare';
import { SPEAK_TOKEN_PARAM } from '@/lib/recordingSpeakActivity';
import { checkReplayQuota } from '@/lib/billing/limits';
import { verifyParticipant } from '@/lib/livekitParticipantAuth';
import { endKloudRecording, finishLivedocRecording, startKloudRecording } from '@/lib/livedoc/kloudRecording';
import { startScreenSectionsForRoom, stopScreenSections } from '@/lib/livedoc/screenSections';
import { snapshotPresence } from '@/lib/livedoc/presenceRecord';
import {
  closePause,
  isRecordingMode,
  memberMayRecord,
  recordingModeOf,
  memberMayReportRoles,
  parseMeetingRoles,
  parsePauseSpans,
  type RecordingState,
} from '@/lib/recordingControls';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET = process.env.S3_SECRET;
const S3_REGION = process.env.S3_REGION;
const S3_BUCKET = process.env.S3_BUCKET;
const S3_ENDPOINT = process.env.S3_ENDPOINT;

/** After a live notes session failed, how long the meeting records a file instead. */
const LIVE_NOTES_RETRY_AFTER_MS = 30 * 60 * 1000;

type MeetingRow =NonNullable<Awaited<ReturnType<typeof prisma.meeting.findUnique>>>;
type RecordingRow = NonNullable<Awaited<ReturnType<typeof prisma.recording.findFirst>>>;

/** The running recording of a meeting (egress still writing), if any. */
function findActiveRecording(meetingId: number) {
  return prisma.recording.findFirst({
    where: { meetingId, status: 'PROCESSING', deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/** 会议开过活文档，AI Notes Only 才能把活文档动作一起录下来。 */
function meetingHasLivedoc(meeting: MeetingRow): boolean {
  return !!meeting.kloudMeetingId;
}

function stateOf(meeting: MeetingRow, active: RecordingRow | null): RecordingState {
  // 正在录的这场用它自己的模式；否则用会议上下一次会用的模式。旧的四种在这里折成两种。
  // 不落文件的就是 AI Notes Only，避免旧行 mode 仍是默认 full 时，菜单总是停在完整录制。
  const stored = recordingModeOf(active?.mode ?? meeting.recordingMode);
  const mode = active && hasNoMedia(active) ? 'ai_notes' : stored;
  const livedoc = active?.kind === 'livedoc_full';
  return {
    active: !!active,
    paused: !!active?.pausedAt,
    mode: recordingModeOf(mode),
    hostOnly: meeting.recordingHostOnly,
    syncTranscript: meeting.recordingSyncTranscript,
    option: livedoc ? 'livedoc_full' : 'screen_share',
    livedocRecordingId: livedoc ? active?.livedocRecordingId ?? null : null,
    // What is running decides; with nothing running, what a new AI Notes session would do.
    notesLive: active ? hasNoMedia(active) : liveNotesEnabled(),
  };
}

/**
 * GET — the meeting's recording state, for anyone in the meeting (LiveKit participant token,
 * including the recorder bot and guests) or a signed-in member.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
) {
  return runWithLocale(request, async () => {
  const roomName = (await params)?.roomName;
  if (!roomName) return apiJson({ error: 'Room name not provided' }, { status: 400 });
  const participant = await verifyParticipant(request);
  if (!participant || participant.room !== roomName) {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;
  }
  const meeting = await prisma.meeting.findUnique({ where: { roomName } });
  if (!meeting) return apiJson({ error: 'Meeting not found' }, { status: 404 });
  return apiJson({ state: stateOf(meeting, await findActiveRecording(meeting.id)) });

  });
}

/** Hosts the recorder may load: this request's own host plus the configured public app host. */
function allowedPageHosts(request: NextRequest): Set<string> {
  const hosts = new Set<string>(['meet.kloud.cn']);
  for (const h of [request.headers.get('x-forwarded-host'), request.headers.get('host')]) {
    if (h) hosts.add(h.split(',')[0].trim());
  }
  try {
    if (process.env.NEXT_PUBLIC_APP_URL) hosts.add(new URL(process.env.NEXT_PUBLIC_APP_URL).host);
  } catch {
    /* ignore malformed env */
  }
  return hosts;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> }
) {
  return runWithLocale(request, async () => {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;

    const resolvedParams = await params;
    const roomName = resolvedParams?.roomName;
    if (!roomName) {
      return apiJson({ error: 'Room name not provided' }, { status: 400 });
    }

    const body = await request.json();
    const { action, pageUrl } = body;
    // LiveDoc Full Recording: the Kloud user token of whoever starts / stops (their LiveDoc login)
    const livedocToken = typeof body.livedocToken === 'string' && body.livedocToken ? body.livedocToken : null;
    const teamMemberId = member.id;

    const meeting = await prisma.meeting.findUnique({ where: { roomName } });
    if (!meeting) {
      return apiJson({ error: 'Meeting not found' }, { status: 404 });
    }
    const roles = parseMeetingRoles(meeting.meetingRoles);

    // The current host's client keeps the server's view of who is host / co-host / presenter.
    if (action === 'roles') {
      if (!memberMayReportRoles({ memberId: teamMemberId, creatorId: meeting.createdByMemberId, roles })) {
        return apiJson({ error: 'Only the host can update roles' }, { status: 403 });
      }
      const next = parseMeetingRoles(body.roles);
      await prisma.meeting.update({ where: { id: meeting.id }, data: { meetingRoles: { ...next } } });
      return apiJson({ success: true });
    }

    // Recording settings: host-only and sync transcript belong to the host; the layout to
    // anyone who may record.
    if (action === 'settings') {
      const isHostLike = memberMayReportRoles({ memberId: teamMemberId, creatorId: meeting.createdByMemberId, roles });
      const mayRecord = memberMayRecord({
        memberId: teamMemberId,
        creatorId: meeting.createdByMemberId,
        roles,
        hostOnly: meeting.recordingHostOnly,
      });
      const data: { recordingHostOnly?: boolean; recordingSyncTranscript?: boolean; recordingMode?: string } = {};
      if (typeof body.hostOnly === 'boolean' || typeof body.syncTranscript === 'boolean') {
        if (!isHostLike) return apiJson({ error: 'Only the host can change this' }, { status: 403 });
        if (typeof body.hostOnly === 'boolean') data.recordingHostOnly = body.hostOnly;
        if (typeof body.syncTranscript === 'boolean') data.recordingSyncTranscript = body.syncTranscript;
      }
      const active = await findActiveRecording(meeting.id);
      if (body.mode !== undefined) {
        if (!isRecordingMode(body.mode)) return apiJson({ error: 'Unknown recording mode' }, { status: 400 });
        if (!mayRecord) return apiJson({ error: 'You cannot change the recording' }, { status: 403 });
        // 两种录的不是同一种文件：一种只录音频，一种录视频。换的话要先停。
        if (active && stateOf(meeting, active).mode !== body.mode) {
          return apiJson({ error: 'Stop the recording to switch mode', code: 'MODE_NEEDS_RESTART' }, { status: 409 });
        }
        data.recordingMode = body.mode;
        if (active) await prisma.recording.update({ where: { id: active.id }, data: { mode: body.mode } });
      }
      const updated = await prisma.meeting.update({ where: { id: meeting.id }, data });
      return apiJson({ success: true, state: stateOf(updated, await findActiveRecording(meeting.id)) });
    }

    // Start / stop / pause / resume: the creator, host and co-hosts — and presenters when the
    // meeting isn't host-only.
    if (!memberMayRecord({ memberId: teamMemberId, creatorId: meeting.createdByMemberId, roles, hostOnly: meeting.recordingHostOnly })) {
      return apiJson({ error: 'Only the host can record this meeting', code: 'RECORDING_NOT_ALLOWED' }, { status: 403 });
    }

    // The recording page saw a screen share start: record it (also without LiveKit's webhook).
    if (action === 'screen') {
      const active = await findActiveRecording(meeting.id);
      if (active?.kind === 'livedoc_full' && recordingModeOf(active.mode) !== 'ai_notes') {
        await startScreenSectionsForRoom(active, roomName);
      }
      return apiJson({ success: true });
    }

    if (action === 'pause' || action === 'resume') {
      const active = await findActiveRecording(meeting.id);
      if (!active) return apiJson({ error: 'No active recording found' }, { status: 404 });
      const now = new Date();
      if (action === 'pause' && !active.pausedAt) {
        await prisma.recording.update({ where: { id: active.id }, data: { pausedAt: now } });
      } else if (action === 'resume' && active.pausedAt) {
        const spans = closePause(parsePauseSpans(active.pauseSpans), active.pausedAt, now);
        await prisma.recording.update({
          where: { id: active.id },
          data: { pausedAt: null, pauseSpans: spans as unknown as object[] },
        });
      }
      return apiJson({ success: true, state: stateOf(meeting, await findActiveRecording(meeting.id)) });
    }

    if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
      return apiJson({ error: 'LiveKit configuration missing' }, { status: 500 });
    }

    const egressClient = new EgressClient(LIVEKIT_URL, API_KEY, API_SECRET);

    if (action === 'stop') {
      const activeRecordings = await prisma.recording.findMany({
        where: { meetingId: meeting.id, status: 'PROCESSING' }
      });
      if (activeRecordings.length === 0) {
        return apiJson({ error: 'No active recording found' }, { status: 404 });
      }
      
      // AI Taking Notes: let the recorder hand in the sentence being spoken before it is shut down.
      if (activeRecordings.some((rec) => hasNoMedia(rec) && !rec.pausedAt)) {
        await askRecorderToFlush(roomName);
      }

      // Stop all active egresses for this meeting (a pause still open ends here)
      const now = new Date();
      for (const rec of activeRecordings) {
        if (rec.pausedAt) {
          await prisma.recording.update({
            where: { id: rec.id },
            data: { pausedAt: null, pauseSpans: closePause(parsePauseSpans(rec.pauseSpans), rec.pausedAt, now) as unknown as object[] },
          });
        }
        // We stored egressId in storageKey temporarily
        try {
          await egressClient.stopEgress(rec.storageKey);
        } catch (e) {
          console.error('Failed to stop egress', rec.storageKey, e);
        }
        if (rec.kind === 'livedoc_full') {
          await stopScreenSections(rec.id);
          await finishLivedocRecording(rec, meeting.kloudMeetingId, livedocToken);
        }
        const openMs = Math.max(0, now.getTime() - (rec.livedocStartedAt ?? rec.createdAt).getTime());
        await prisma.recordingSection.updateMany({
          where: { recordingId: rec.id, kind: 'shot', endMs: null },
          data: { endMs: openMs },
        });
        // No file will arrive to make it READY: the session ends here.
        if (hasNoMedia(rec)) {
          await finishLiveNotes(rec, { endedAt: now }).catch((e) =>
            console.error('[meetings record] live notes failed to finish', rec.id, e),
          );
        }
      }
      
      return apiJson({ success: true, message: 'Stopping recording', state: { ...stateOf(meeting, null) } });
    }

    // A late or duplicate start must not replace an already running session.
    const running = await findActiveRecording(meeting.id);
    if (running) return apiJson({ success: true, state: stateOf(meeting, running), alreadyActive: true });

    // Otherwise, START recording
    // Billing: refuse to start once the recorder's replay hours are used up (402 BILLING_LIMIT).
    const quotaError = await checkReplayQuota(teamMemberId);
    if (quotaError) return quotaError;

    const mode = isRecordingMode(body.mode) ? body.mode : recordingModeOf(meeting.recordingMode);
    // AI Taking Notes: speech becomes text while the meeting runs and no file is written
    // (lib/liveNotes.ts). AI_NOTES_CAPTURE=file keeps the old audio file instead.
    // If a live notes session of this meeting just ended in failure (its recorder broke before
    // any notes), don't try the same thing again: record the audio file as before.
    const brokeRecently = mode === 'ai_notes' && liveNotesEnabled()
      ? await prisma.recording.findFirst({
          where: {
            meetingId: meeting.id,
            storageProvider: NO_MEDIA_PROVIDER,
            status: 'FAILED',
            createdAt: { gte: new Date(Date.now() - LIVE_NOTES_RETRY_AFTER_MS) },
          },
          select: { id: true },
        })
      : null;
    const wantLiveNotes = mode === 'ai_notes' && liveNotesEnabled() && !brokeRecently;
    const hasStorage = !!(S3_ACCESS_KEY && S3_SECRET && S3_REGION && S3_BUCKET);

    if (!hasStorage && !wantLiveNotes) {
      console.error('S3 configuration is missing in .env');
      return apiJson({ error: 'Cloud storage (S3/OSS) configuration is missing in environment variables. LiveKit Cloud requires a cloud storage destination for recordings.' }, { status: 500 });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = `recordings/${roomName}-${timestamp}.mp4`;

    let fileOutput: EncodedFileOutput | null = null;

    // Check if it's AliOSS or S3 based on endpoint or explicit variable
    if (!hasStorage) {
      fileOutput = null;
    } else if (S3_ENDPOINT && S3_ENDPOINT.includes('aliyuncs.com')) {
      fileOutput = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath,
        output: {
          case: 'aliOSS',
          value: {
            accessKey: S3_ACCESS_KEY,
            secret: S3_SECRET,
            region: S3_REGION,
            bucket: S3_BUCKET,
            endpoint: S3_ENDPOINT,
          }
        }
      });
    } else {
      fileOutput = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath,
        output: {
          case: 's3',
          value: {
            accessKey: S3_ACCESS_KEY,
            secret: S3_SECRET,
            region: S3_REGION,
            bucket: S3_BUCKET,
            ...(S3_ENDPOINT && !S3_ENDPOINT.includes('amazonaws.com') ? { endpoint: S3_ENDPOINT } : {})
          }
        }
      });
    }

    if (!pageUrl) {
      return apiJson({ error: 'pageUrl is required for Web Egress' }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(pageUrl);
    } catch {
      return apiJson({ error: 'Invalid pageUrl' }, { status: 400 });
    }
    // The egress browser must only load this app's own meeting page, never an arbitrary URL.
    if (
      !/^https?:$/.test(parsedUrl.protocol) ||
      !allowedPageHosts(request).has(parsedUrl.host) ||
      !parsedUrl.pathname.startsWith('/rooms/')
    ) {
      return apiJson({ error: 'pageUrl must be this meeting page' }, { status: 400 });
    }

    // AI Notes Only 且会议已有活文档：Kloud 记下活文档动作，媒体只录音频。
    // 完整录制不走 LiveDoc，网页出口录整段会议画面（共享也在这段视频里）。
    const livedocFull = mode === 'ai_notes' && meetingHasLivedoc(meeting) && !!livedocToken;
    let livedocRecordingId: number | null = null;
    let livedocStartedAt: Date | null = null;
    if (livedocFull && meeting.kloudMeetingId && livedocToken) {
      try {
        livedocRecordingId = await startKloudRecording(meeting.kloudMeetingId, livedocToken);
      } catch (e) {
        console.error('[meetings record] Kloud start_recording failed', e);
        return apiJson({ error: 'LiveDoc recording could not start', code: 'LIVEDOC_RECORDING_FAILED' }, { status: 502 });
      }
      livedocStartedAt = new Date();
    }

    const audioOnly = mode === 'ai_notes';
    // Use startWebEgress so that LiveKit runs a headless browser to record exactly what's on the screen
    // Adding ?isBot=true so the frontend component skips the PreJoin waiting room
    const activityToken = newShareKey();
    parsedUrl.searchParams.set('isBot', 'true');
    parsedUrl.searchParams.set(SPEAK_TOKEN_PARAM, activityToken);
    const targetUrl = parsedUrl.toString();

    let info;
    let noMedia = false;
    try {
      if (wantLiveNotes) {
        // The recorder needs an output to run, so it gets a stream with no destination: the
        // page is loaded and plays the room's audio, and nothing is written or sent anywhere.
        // The page itself sends that audio to the recognizer (lib/useLiveNotesStreamer.ts).
        try {
          info = await egressClient.startWebEgress(
            targetUrl,
            new StreamOutput({ protocol: StreamProtocol.RTMP, urls: [] }),
            { audioOnly: true, videoOnly: false },
          );
          noMedia = true;
        } catch (e) {
          if (!fileOutput) throw e;
          console.error('[meetings record] live notes recorder failed to start; recording a file instead', e);
        }
      }
      if (!info) {
        if (!fileOutput) throw new Error('Cloud storage (S3/OSS) configuration is missing');
        info = await egressClient.startWebEgress(
          targetUrl,
          fileOutput, // The new standard requires passing the output definition object natively here
          {
            audioOnly,
            videoOnly: false,
          }
        );
      }
    } catch (e) {
      // Don't leave Kloud recording a meeting that has no media.
      if (livedocRecordingId && meeting.kloudMeetingId && livedocToken) {
        await endKloudRecording(meeting.kloudMeetingId, livedocToken);
      }
      throw e;
    }

    // Create tracking record
    const recording = await prisma.recording.create({
      data: {
        meetingId: meeting.id,
        teamMemberId: teamMemberId,
        shareKey: newShareKey(),
        visibility: 'PRIVATE',
        fileName: noMedia ? `${roomName}-${timestamp}` : `${roomName}-${timestamp}.mp4`,
        storageProvider: noMedia ? NO_MEDIA_PROVIDER : S3_ENDPOINT?.includes('aliyuncs') ? 'ALI_OSS' : 'S3',
        storageKey: info.egressId, // Temporarily store egressId here
        status: 'PROCESSING',
        activityToken,
        mode,
        syncTranscript: meeting.recordingSyncTranscript,
        ...(livedocFull
          ? { kind: 'livedoc_full', livedocRecordingId, livedocStartedAt, livedocToken }
          : {}),
      }
    });
    // AI Notes Only 的共享由共享者截有变化的画面，不另开一路屏幕视频。
    if (livedocFull) {
      await snapshotPresence(roomName).catch((e) =>
        console.error('[meetings record] presence snapshot failed', e),
      );
    }
    if (meeting.recordingMode !== mode) {
      await prisma.meeting.update({ where: { id: meeting.id }, data: { recordingMode: mode } });
    }

    return apiJson({
      success: true,
      recording,
      egressId: info.egressId,
      state: { ...stateOf(meeting, recording), mode },
    });
  } catch (error: any) {
    console.error('[meetings record POST]', error);
    return apiJson({ error: error.message || 'Internal server error' }, { status: 500 });
  }

  });
}
