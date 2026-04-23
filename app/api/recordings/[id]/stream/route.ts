import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({
  region: process.env.S3_REGION || 'us-west-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET!,
  },
});

/**
 * 从 S3 URL 中提取 object key
 * 例如: https://bucket.s3.region.amazonaws.com/recordings/foo.mp4
 *   → recordings/foo.mp4
 */
function extractS3Key(url: string): string | null {
  try {
    const u = new URL(url);
    // pathname starts with '/', remove leading slash
    const key = u.pathname.replace(/^\//, '');
    return key || null;
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const recordingId = parseInt(resolvedParams.id, 10);
    console.log('[stream] recordingId:', recordingId);

    if (isNaN(recordingId)) {
      return NextResponse.json({ error: 'Invalid recording ID' }, { status: 400 });
    }

    const recording = await prisma.recording.findUnique({
      where: { id: recordingId },
    });
    console.log('[stream] recording:', JSON.stringify({
      id: recording?.id,
      status: recording?.status,
      storageKey: recording?.storageKey,
      storageUrl: recording?.storageUrl,
    }));

    if (!recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    if (recording.status !== 'READY') {
      return NextResponse.json(
        { error: `Recording is not ready yet (status: ${recording.status})` },
        { status: 404 }
      );
    }

    // 优先用 storageKey，若它是 egressId 格式则尝试从 storageUrl 提取真实路径
    let s3Key: string | null = recording.storageKey;

    // egressId 格式: "EG_xxxxx" — 不是真正的 S3 key，尝试从 storageUrl 解析
    if (s3Key && s3Key.startsWith('EG_') && recording.storageUrl) {
      s3Key = extractS3Key(recording.storageUrl);
      console.log('[stream] storageKey is egressId, extracted key from storageUrl:', s3Key);
    } else if (!s3Key && recording.storageUrl) {
      s3Key = extractS3Key(recording.storageUrl);
      console.log('[stream] no storageKey, extracted from storageUrl:', s3Key);
    }

    console.log('[stream] final s3Key:', s3Key);
    console.log('[stream] S3_BUCKET:', process.env.S3_BUCKET);
    console.log('[stream] S3_REGION:', process.env.S3_REGION);

    if (!s3Key) {
      return NextResponse.json({ error: 'Cannot determine S3 object key' }, { status: 404 });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: s3Key,
    });

    // Generate a presigned URL valid for 1 hour
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    console.log('[stream] presignedUrl generated OK');

    return NextResponse.json({ url: presignedUrl });
  } catch (error: any) {
    console.error('[stream] ERROR:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
