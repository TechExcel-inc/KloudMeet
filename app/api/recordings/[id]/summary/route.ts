import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { canManageRecording } from '@/lib/apiAuth';
import { transcribeStateOf } from '@/lib/aliyunRecordingTranscription';
import { RECORDING_STATUS_ARCHIVED, billingLimitResponse } from '@/lib/billing/limits';
import { parsePauseSpans, pauseRangesInMedia } from '@/lib/recordingControls';
import { isInternalMember } from '@/lib/internalStaff.server';
import {
  authorizeRecordingView,
  ensureShareKey,
  findRecordingByKey,
  isRecordingResponse,
} from '@/lib/recordingShare';

const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-west-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET!,
  },
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const located = await findRecordingByKey(id);
    if (!located) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
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
      return NextResponse.json(
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
              transcripts: {
                orderBy: { captionTime: 'asc' },
                take: 500,
              },
            },
          },
          teamMember: { select: { id: true, fullName: true, username: true } },
          sections: { where: { kind: 'screen', status: 'READY' }, orderBy: { startMs: 'asc' } },
        },
      });

    let recording = await loadReplay(located.id);

    if (!recording || recording.deletedAt) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    // 生成 S3 预签名播放 URL（1小时有效期）
    let streamUrl: string | null = null;
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: recording.storageKey,
      });
      streamUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    } catch (e) {
      console.error('[replay summary] S3 presign failed:', e);
    }

    // LiveDoc Full Recording: the replay shows LiveDoc (Kloud's saved actions) and the screen
    // shares on the voice's clock. Kloud time (ms) = media time (ms) + offsetMs.
    let livedoc: {
      recordingId: number;
      kloudMeetingId: number;
      offsetMs: number;
      screens: Array<{ url: string; startMs: number; endMs: number | null }>;
    } | null = null;
    if (recording.kind === 'livedoc_full' && recording.livedocRecordingId && recording.meeting?.kloudMeetingId) {
      const offsetMs =
        recording.mediaStartedAt && recording.livedocStartedAt
          ? recording.mediaStartedAt.getTime() - recording.livedocStartedAt.getTime()
          : 0;
      const screens = [];
      for (const section of recording.sections) {
        if (section.startMs === null) continue;
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

    return NextResponse.json({
      recording: {
        id: recording.id,
        shareKey,
        visibility: recording.visibility,
        canManage,
        canTranscribe,
        fileName: recording.fileName,
        durationSeconds: recording.durationSeconds,
        // Paused stretches, as [start, end] seconds into the file: the player skips them
        pausedRanges: pauseRangesInMedia(parsePauseSpans(recording.pauseSpans), recording.mediaStartedAt),
        fileSizeBytes: recording.fileSizeBytes,
        status: recording.status,
        createdAt: recording.createdAt,
        streamUrl,
        recordedBy: recording.teamMember,
        transcribe: transcribeStateOf(recording),
        livedoc,
      },
      meeting: recording.meeting
        ? {
            id: recording.meeting.id,
            kloudMeetingId: recording.meeting.kloudMeetingId,
            title: recording.meeting.title,
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
            transcripts: recording.meeting.transcripts,
          }
        : null,
    });
  } catch (err) {
    console.error('[replay summary GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
