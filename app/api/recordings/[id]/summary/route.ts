import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
    // 鉴权检查：需要登录用户才能访问录制回放
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.split(' ')[1];
    const session = await prisma.session.findUnique({
      where: { token },
      select: { id: true, expiresAt: true, teamMemberId: true },
    });
    if (!session || session.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const { id } = await params;
    const recordingId = parseInt(id);
    if (isNaN(recordingId)) {
      return NextResponse.json({ error: 'Invalid recording ID' }, { status: 400 });
    }

    // 查询录制记录 + 关联会议信息
    const recording = await prisma.recording.findUnique({
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
            kloudMeetingId: (recording.meeting as any).kloudMeetingId ?? null,
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
