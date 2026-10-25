import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { EgressClient, EncodedFileType, EncodedFileOutput } from 'livekit-server-sdk';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { newShareKey } from '@/lib/recordingShare';
import { SPEAK_TOKEN_PARAM } from '@/lib/recordingSpeakActivity';
import { checkReplayQuota } from '@/lib/billing/limits';
import { verifyParticipant } from '@/lib/livekitParticipantAuth';
import { endKloudRecording, finishLivedocRecording, startKloudRecording } from '@/lib/livedoc/kloudRecording';
import {
  closePause,
  isRecordingMode,
  isRecordingOption,
  memberMayRecord,
  memberMayReportRoles,
  parseMeetingRoles,
  parsePauseSpans,
  type RecordingState,
} from '@/lib/recordingControls';

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET = process.env.S3_SECRET;
const S3_REGION = process.env.S3_REGION;
const S3_BUCKET = process.env.S3_BUCKET;
const S3_ENDPOINT = process.env.S3_ENDPOINT;

type MeetingRow = NonNullable<Awaited<ReturnType<typeof prisma.meeting.findUnique>>>;
type RecordingRow = NonNullable<Awaited<ReturnType<typeof prisma.recording.findFirst>>>;

/** The running recording of a meeting (egress still writing), if any. */
function findActiveRecording(meetingId: number) {
  return prisma.recording.findFirst({
    where: { meetingId, status: 'PROCESSING', deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

function stateOf(meeting: MeetingRow, active: RecordingRow | null): RecordingState {
  const mode = active?.mode ?? meeting.recordingMode;
  return {
    active: !!active,
    paused: !!active?.pausedAt,
    mode: isRecordingMode(mode) ? mode : 'follow',
    hostOnly: meeting.recordingHostOnly,
    syncTranscript: meeting.recordingSyncTranscript,
    option: isRecordingOption(meeting.recordingOption) ? meeting.recordingOption : 'screen_share',
    livedocRecordingId: active?.livedocRecordingId ?? null,
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
  const roomName = (await params)?.roomName;
  if (!roomName) return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });
  const participant = await verifyParticipant(request);
  if (!participant || participant.room !== roomName) {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;
  }
  const meeting = await prisma.meeting.findUnique({ where: { roomName } });
  if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
  return NextResponse.json({ state: stateOf(meeting, await findActiveRecording(meeting.id)) });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> }
) {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;

    const resolvedParams = await params;
    const roomName = resolvedParams?.roomName;
    if (!roomName) {
      return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });
    }

    const body = await request.json();
    const { action, pageUrl } = body;
    // LiveDoc Full Recording: the Kloud user token of whoever starts / stops (their LiveDoc login)
    const livedocToken = typeof body.livedocToken === 'string' && body.livedocToken ? body.livedocToken : null;
    const teamMemberId = member.id;

    const meeting = await prisma.meeting.findUnique({ where: { roomName } });
    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const roles = parseMeetingRoles(meeting.meetingRoles);

    // The current host's client keeps the server's view of who is host / co-host / presenter.
    if (action === 'roles') {
      if (!memberMayReportRoles({ memberId: teamMemberId, creatorId: meeting.createdByMemberId, roles })) {
        return NextResponse.json({ error: 'Only the host can update roles' }, { status: 403 });
      }
      const next = parseMeetingRoles(body.roles);
      await prisma.meeting.update({ where: { id: meeting.id }, data: { meetingRoles: { ...next } } });
      return NextResponse.json({ success: true });
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
        if (!isHostLike) return NextResponse.json({ error: 'Only the host can change this' }, { status: 403 });
        if (typeof body.hostOnly === 'boolean') data.recordingHostOnly = body.hostOnly;
        if (typeof body.syncTranscript === 'boolean') data.recordingSyncTranscript = body.syncTranscript;
      }
      const active = await findActiveRecording(meeting.id);
      if (body.mode !== undefined) {
        if (!isRecordingMode(body.mode)) return NextResponse.json({ error: 'Unknown recording mode' }, { status: 400 });
        if (!mayRecord) return NextResponse.json({ error: 'You cannot change the recording' }, { status: 403 });
        // Audio-only is a different kind of file: switching to or from it needs a new recording.
        if (active && (active.mode === 'audio') !== (body.mode === 'audio')) {
          return NextResponse.json({ error: 'Stop the recording to switch to or from audio only', code: 'MODE_NEEDS_RESTART' }, { status: 409 });
        }
        data.recordingMode = body.mode;
        if (active) await prisma.recording.update({ where: { id: active.id }, data: { mode: body.mode } });
      }
      const updated = await prisma.meeting.update({ where: { id: meeting.id }, data });
      return NextResponse.json({ success: true, state: stateOf(updated, await findActiveRecording(meeting.id)) });
    }

    // Start / stop / pause / resume: the creator, host and co-hosts — and presenters when the
    // meeting isn't host-only.
    if (!memberMayRecord({ memberId: teamMemberId, creatorId: meeting.createdByMemberId, roles, hostOnly: meeting.recordingHostOnly })) {
      return NextResponse.json({ error: 'Only the host can record this meeting', code: 'RECORDING_NOT_ALLOWED' }, { status: 403 });
    }

    if (action === 'pause' || action === 'resume') {
      const active = await findActiveRecording(meeting.id);
      if (!active) return NextResponse.json({ error: 'No active recording found' }, { status: 404 });
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
      return NextResponse.json({ success: true, state: stateOf(meeting, await findActiveRecording(meeting.id)) });
    }

    if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
      return NextResponse.json({ error: 'LiveKit configuration missing' }, { status: 500 });
    }

    const egressClient = new EgressClient(LIVEKIT_URL, API_KEY, API_SECRET);

    if (action === 'stop') {
      const activeRecordings = await prisma.recording.findMany({
        where: { meetingId: meeting.id, status: 'PROCESSING' }
      });
      if (activeRecordings.length === 0) {
        return NextResponse.json({ error: 'No active recording found' }, { status: 404 });
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
        await finishLivedocRecording(rec, meeting.kloudMeetingId, livedocToken);
      }
      
      return NextResponse.json({ success: true, message: 'Stopping recording', state: { ...stateOf(meeting, null) } });
    }

    // Otherwise, START recording
    // Billing: refuse to start once the recorder's replay hours are used up (402 BILLING_LIMIT).
    const quotaError = await checkReplayQuota(teamMemberId);
    if (quotaError) return quotaError;

    if (!S3_ACCESS_KEY || !S3_SECRET || !S3_REGION || !S3_BUCKET) {
      console.error('S3 configuration is missing in .env');
      return NextResponse.json({ error: 'Cloud storage (S3/OSS) configuration is missing in environment variables. LiveKit Cloud requires a cloud storage destination for recordings.' }, { status: 500 });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = `recordings/${roomName}-${timestamp}.mp4`;

    let fileOutput: EncodedFileOutput;
    
    // Check if it's AliOSS or S3 based on endpoint or explicit variable
    if (S3_ENDPOINT && S3_ENDPOINT.includes('aliyuncs.com')) {
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
      return NextResponse.json({ error: 'pageUrl is required for Web Egress' }, { status: 400 });
    }

    // Use startWebEgress so that LiveKit runs a headless browser to record exactly what's on the screen
    // Adding ?isBot=true so the frontend component skips the PreJoin waiting room
    // LiveDoc Full Recording: Kloud saves the LiveDoc actions; the media is the meeting's voice,
    // recorded for now with the audio-only web egress (later its own voice and screen sections).
    const livedocFull = meeting.recordingOption === 'livedoc_full';
    let livedocRecordingId: number | null = null;
    let livedocStartedAt: Date | null = null;
    if (livedocFull) {
      if (!meeting.kloudMeetingId) {
        return NextResponse.json({ error: 'LiveDoc is not ready in this meeting yet', code: 'LIVEDOC_NOT_READY' }, { status: 409 });
      }
      if (!livedocToken) {
        return NextResponse.json({ error: 'livedocToken is required for LiveDoc Full Recording' }, { status: 400 });
      }
      try {
        livedocRecordingId = await startKloudRecording(meeting.kloudMeetingId, livedocToken);
      } catch (e) {
        console.error('[meetings record] Kloud start_recording failed', e);
        return NextResponse.json({ error: 'LiveDoc recording could not start', code: 'LIVEDOC_RECORDING_FAILED' }, { status: 502 });
      }
      livedocStartedAt = new Date();
    }

    const mode = livedocFull
      ? 'audio'
      : isRecordingMode(body.mode) ? body.mode : isRecordingMode(meeting.recordingMode) ? meeting.recordingMode : 'follow';
    const activityToken = newShareKey();
    const parsedUrl = new URL(pageUrl);
    parsedUrl.searchParams.set('isBot', 'true');
    parsedUrl.searchParams.set(SPEAK_TOKEN_PARAM, activityToken);
    const targetUrl = parsedUrl.toString();

    let info;
    try {
      info = await egressClient.startWebEgress(
        targetUrl,
        fileOutput, // The new standard requires passing the output definition object natively here
        {
          audioOnly: mode === 'audio',
          videoOnly: false,
        }
      );
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
        fileName: `${roomName}-${timestamp}.mp4`,
        storageProvider: S3_ENDPOINT?.includes('aliyuncs') ? 'ALI_OSS' : 'S3',
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
    if (!livedocFull && meeting.recordingMode !== mode) {
      await prisma.meeting.update({ where: { id: meeting.id }, data: { recordingMode: mode } });
    }

    return NextResponse.json({
      success: true,
      recording,
      egressId: info.egressId,
      state: { ...stateOf(meeting, recording), mode },
    });
  } catch (error: any) {
    console.error('[meetings record POST]', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
