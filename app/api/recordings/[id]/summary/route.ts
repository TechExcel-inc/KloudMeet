import { replaySpeakerResolver } from '@/lib/replaySpeakerIdentity';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { storeClient } from '@/lib/objectStore';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { canManageRecording } from '@/lib/apiAuth';
import { transcribeStateOf } from '@/lib/recordingTranscription';
import { RECORDING_STATUS_ARCHIVED, billingLimitResponse } from '@/lib/billing/limits';
import { parsePauseSpans, pauseRangesInMedia, recordingModeOf } from '@/lib/recordingControls';
import { hasNoMedia, silenceUrl } from '@/lib/liveNotes';
import { NO_PRESENTATION, type PresentationState } from '@/lib/meetingPresentation';
import { loadPresentation, schedulePresentation } from '@/lib/meetingPresentationServer';
import { SHOT_KIND, shotAnchor, type ShareShot } from '@/lib/shareShot';
import { finishScreenSections } from '@/lib/livedoc/screenSections';
import { isPresenceKind, type PresenceEvent } from '@/lib/livedoc/presence';
import { isInternalMember } from '@/lib/internalStaff.server';
import {
  authorizeRecordingView,
  ensureShareKey,
  findRecordingByKey,
  isRecordingResponse,
} from '@/lib/recordingShare';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

const s3 = storeClient();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithLocale(req, async () => {
  try {
    const { id } = await params;
    const located = await findRecordingByKey(id);
    if (!located) {
      return apiJson({ error: 'Recording not found' }, { status: 404 });
    }

    const access = await authorizeRecordingView(req, located);
    if (isRecordingResponse(access)) return access;

    if (located.status === RECORDING_STATUS_ARCHIVED) {
      // Free plan keeps only the latest replays; older ones are archived (not deleted) until upgrade.
      return billingLimitResponse(
        'replay_retention',
        'This replay is archived. The Free plan keeps your 3 most recent replays; upgrade to restore it.',
      );
    }
    if (located.status !== 'READY') {
      return apiJson(
        { error: `Recording is not ready yet (status: ${located.status})` },
        { status: 404 },
      );
    }

    const shareKey = await ensureShareKey(located);
    const canManage =
      access.memberId !== null
        ? await canManageRecording(access.memberId, located)
        : false;
    const canTranscribe = access.memberId !== null;

    const loadReplay = (recordingId: number) =>
      prisma.recording.findUnique({
        where: { id: recordingId },
        include: {
          meeting: {
            include: {
              createdByMember: { select: { id: true, fullName: true, username: true, avatarUrl: true } },
              participants: {
                include: {
                  teamMember: { select: { id: true, fullName: true, username: true, avatarUrl: true } },
                },
                orderBy: { joinedAt: 'asc' },
              },
              summaryItems: { orderBy: { sortOrder: 'asc' } },
              summary: {
                select: {
                  topic: true,
                  overview: true,
                  speakers: true,
                  todos: true,
                  model: true,
                  fallbackReason: true,
                  updatedAt: true,
                },
              },
              // Every line, so long meetings keep their whole transcript; only what the page shows
              transcripts: {
                orderBy: { captionTime: 'asc' },
                select: { id: true, speakerName: true, speakerMemberId: true, content: true, captionTime: true, offsetSeconds: true, sourceId: true },
              },
            },
          },
          teamMember: { select: { id: true, fullName: true, username: true } },
          sections: { where: { kind: { in: ['screen', SHOT_KIND] }, status: 'READY' }, orderBy: { startMs: 'asc' } },
        },
      });

    // LiveDoc Full: finish screen sections whose egress has ended, so the replay has them
    await finishScreenSections([located.id]).catch((e) =>
      console.error('[replay summary] screen sections failed to finish', e),
    );
    let recording = await loadReplay(located.id);

    if (!recording || recording.deletedAt) {
      return apiJson({ error: 'Recording not found' }, { status: 404 });
    }

    // 生成 S3 预签名播放 URL（1小时有效期）
    let streamUrl: string | null = null;
    const noMedia = hasNoMedia(recording);
    if (noMedia) {
      // AI Taking Notes kept no audio: replay keeps time with a silent file of the session's length.
      const lastLine = recording.meeting?.transcripts.reduce((max, line) => Math.max(max, line.offsetSeconds ?? 0), 0) ?? 0;
      streamUrl = silenceUrl(recording.durationSeconds || lastLine + 60);
    } else {
      try {
        const command = new GetObjectCommand({
          Bucket: process.env.S3_BUCKET!,
          Key: recording.storageKey,
        });
        streamUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
      } catch (e) {
        console.error('[replay summary] S3 presign failed:', e);
      }
    }

    const mediaStart = recording.mediaStartedAt ?? recording.createdAt;
    // LiveDoc Full Recording: the replay shows LiveDoc (Kloud's saved actions) and the screen
    // shares on the voice's clock. Kloud time (ms) = media time (ms) + offsetMs.
    let livedoc: {
      recordingId: number;
      kloudMeetingId: number;
      offsetMs: number;
      screens: Array<{ url: string; startMs: number; endMs: number | null }>;
    } | null = null;
    if (recording.kind === 'livedoc_full' && recording.livedocRecordingId && recording.meeting?.kloudMeetingId) {
      const offsetMs = recording.livedocStartedAt
        ? mediaStart.getTime() - recording.livedocStartedAt.getTime()
        : 0;
      const screens = [];
      for (const section of recording.sections) {
        if (section.kind !== 'screen' || section.startMs === null) continue;
        try {
          const url = await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: section.storageKey }),
            { expiresIn: 3600 },
          );
          screens.push({ url, startMs: section.startMs, endMs: section.endMs });
        } catch (e) {
          console.error('[replay summary] S3 presign failed for section', section.id, e);
        }
      }
      livedoc = {
        recordingId: recording.livedocRecordingId,
        kloudMeetingId: recording.meeting.kloudMeetingId,
        offsetMs,
        screens,
      };
    }

    const shots: ShareShot[] = [];
    const shotOffsetMs = shotAnchor(recording).getTime() - mediaStart.getTime();
    for (const section of recording.sections) {
      if (section.kind !== SHOT_KIND || section.startMs === null) continue;
      try {
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: section.storageKey }),
          { expiresIn: 3600 },
        );
        shots.push({
          url,
          startMs: section.startMs + shotOffsetMs,
          endMs: section.endMs === null ? null : section.endMs + shotOffsetMs,
        });
      } catch (e) {
        console.error('[replay summary] S3 presign failed for shot', section.id, e);
      }
    }

    // AI Taking Notes: the AI presentation of the meeting. It is made when the session ends; if
    // that didn't happen (the server restarted meanwhile), opening the replay starts it.
    let presentation: PresentationState = NO_PRESENTATION;
    if (noMedia) {
      presentation = await loadPresentation(recording.meetingId);
      if (presentation.status === 'NONE' && (recording.meeting?.transcripts.length ?? 0) > 0) {
        schedulePresentation(recording.meetingId, { memberId: recording.teamMemberId });
        presentation = { status: 'GENERATING', content: null };
      }
    }

    const transcripts = recording.meeting?.transcripts ?? [];
    const resolveSpeaker = replaySpeakerResolver(recording.meeting?.participants ?? []);
    const regenerated = transcripts.filter((row) => row.sourceId?.startsWith(`assemblyai-${recording.id}-`));

    return apiJson({
      recording: {
        id: recording.id,
        shareKey,
        visibility: recording.visibility,
        canManage,
        // No audio was kept, so there is nothing to transcribe afterwards.
        canTranscribe: canTranscribe && !noMedia,
        // False for AI Taking Notes: streamUrl is then a silent clock, not a recording.
        hasMedia: !noMedia,
        presentation,
        fileName: recording.fileName,
        durationSeconds: recording.durationSeconds,
        // Paused stretches, as [start, end] seconds into the file: the player skips them
        pausedRanges: pauseRangesInMedia(parsePauseSpans(recording.pauseSpans), recording.mediaStartedAt),
        fileSizeBytes: recording.fileSizeBytes,
        status: recording.status,
        createdAt: recording.createdAt,
        streamUrl,
        notesOnly: recordingModeOf(recording.mode) === 'ai_notes',
        recordedBy: recording.teamMember,
        transcribe: transcribeStateOf(recording),
        livedoc,
        shots,
        presence: await loadPresence(recording.id, recording.kind),
      },
      meeting: recording.meeting
        ? {
            id: recording.meeting.id,
            kloudMeetingId: recording.meeting.kloudMeetingId,
            title: recording.meeting.title,
            description: recording.meeting.description,
            roomName: recording.meeting.roomName,
            status: recording.meeting.status,
            actualStartedAt: recording.meeting.actualStartedAt,
            endedAt: recording.meeting.endedAt,
            actualDurationMinutes: recording.meeting.actualDurationMinutes,
            createdBy: recording.meeting.createdByMember,
            participants: recording.meeting.participants.map((p) => ({
              id: p.id,
              displayName: p.displayName,
              joinedAt: p.joinedAt,
              leftAt: p.leftAt,
              durationSeconds: p.durationSeconds,
              member: p.teamMember,
            })),
            summaryItems: recording.meeting.summaryItems,
            // Topic / overview / speakers / to-dos of the structured summary; null for older summaries.
            // Which model wrote it is an internal note, only for staff on INTERNAL_STAFF_EMAILS.
            summary: recording.meeting.summary
              ? await withInternalNote(recording.meeting.summary, access.memberId)
              : null,
            transcripts: (regenerated.length ? regenerated : transcripts).map(row => {
              const speaker = resolveSpeaker(row);
              return { id: row.id, speakerName: speaker.name, speakerKey: speaker.key, verifiedAttendee: speaker.verifiedAttendee,
                content: row.content, captionTime: row.captionTime, offsetSeconds: row.offsetSeconds };
            }),
          }
        : null,
    });
  } catch (err) {
    console.error('[replay summary GET]', err);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}

/** LiveDoc Full presence. Missing table (SQL not applied yet) leaves the replay without the people window. */
async function loadPresence(recordingId: number, kind: string): Promise<PresenceEvent[]> {
  if (kind !== 'livedoc_full') return [];
  try {
    const rows = await prisma.recordingPresence.findMany({
      where: { recordingId },
      orderBy: [{ atMs: 'asc' }, { id: 'asc' }],
      select: { identity: true, name: true, kind: true, on: true, atMs: true },
    });
    return rows.flatMap((row): PresenceEvent[] =>
      isPresenceKind(row.kind)
        ? [{ identity: row.identity, name: row.name, kind: row.kind, on: row.on, atMs: row.atMs }]
        : [],
    );
  } catch (err) {
    console.error('[replay summary] presence failed', err);
    return [];
  }
}

/** The summary head for the page; the model note is added only for internal staff. */
async function withInternalNote(
  summary: {
    topic: string | null;
    overview: string | null;
    speakers: unknown;
    todos: unknown;
    model: string | null;
    fallbackReason: string | null;
    updatedAt: Date;
  },
  memberId: number | null,
) {
  const { model, fallbackReason, updatedAt, ...head } = summary;
  if (!model || !(await isInternalMember(memberId))) return head;
  return { ...head, generation: { model, fallbackReason, at: updatedAt } };
}
