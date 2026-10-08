import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { canManageRecording } from '@/lib/apiAuth';
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

    const recording = await prisma.recording.findUnique({
      where: { id: located.id },
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
            // 只取前100条 transcript，前端再分页
            transcripts: {
              orderBy: { captionTime: 'asc' },
              take: 500,
            },
          },
        },
        teamMember: { select: { id: true, fullName: true, username: true } },
      },
    });

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

    return NextResponse.json({
      recording: {
        id: recording.id,
        shareKey,
        visibility: recording.visibility,
        canManage,
        fileName: recording.fileName,
        durationSeconds: recording.durationSeconds,
        fileSizeBytes: recording.fileSizeBytes,
        status: recording.status,
        createdAt: recording.createdAt,
        streamUrl,
        recordedBy: recording.teamMember,
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
            transcripts: recording.meeting.transcripts,
          }
        : null,
    });
  } catch (err) {
    console.error('[replay summary GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
