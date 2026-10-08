import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  authorizeRecordingView,
  findRecordingByKey,
  isRecordingResponse,
} from '@/lib/recordingShare';

const s3Client = new S3Client({
  region: process.env.S3_REGION || 'us-west-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET!,
  },
});

function extractS3Key(url: string): string | null {
  try {
    const u = new URL(url);
    const key = u.pathname.replace(/^\//, '');
    return key || null;
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const recording = await findRecordingByKey(resolvedParams.id);
    if (!recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    const access = await authorizeRecordingView(req, recording);
    if (isRecordingResponse(access)) return access;

    if (recording.status !== 'READY') {
      return NextResponse.json(
        { error: `Recording is not ready yet (status: ${recording.status})` },
        { status: 404 },
      );
    }

    let s3Key: string | null = recording.storageKey;

    if (s3Key && s3Key.startsWith('EG_') && recording.storageUrl) {
      s3Key = extractS3Key(recording.storageUrl);
    } else if (!s3Key && recording.storageUrl) {
      s3Key = extractS3Key(recording.storageUrl);
    }

    if (!s3Key) {
      return NextResponse.json({ error: 'Cannot determine S3 object key' }, { status: 404 });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: s3Key,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return NextResponse.json({ url: presignedUrl });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[stream] ERROR:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
