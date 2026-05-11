import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { prisma } from '@/lib/db';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const MAX_TRANSCRIBE_BYTES = Number(process.env.POST_RECORDING_TRANSCRIBE_MAX_BYTES || 24 * 1024 * 1024);

const hasS3Config =
  !!process.env.S3_REGION &&
  !!process.env.S3_ACCESS_KEY &&
  !!process.env.S3_SECRET &&
  !!process.env.S3_BUCKET;

const s3 = hasS3Config
  ? new S3Client({
      region: process.env.S3_REGION!,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET!,
      },
    })
  : null;

type OpenAITranscriptionResponse = {
  text?: string;
  segments?: Array<{
    start?: number;
    end?: number;
    text?: string;
  }>;
};

async function readBodyToUint8Array(body: unknown): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const maybeTransform = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof maybeTransform.transformToByteArray === 'function') {
    return maybeTransform.transformToByteArray();
  }

  const stream = body as AsyncIterable<Uint8Array>;
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

async function loadRecordingBytes(storageUrl: string | null, storageKey: string): Promise<Uint8Array> {
  if (storageUrl) {
    const res = await fetch(storageUrl);
    if (res.ok) {
      return new Uint8Array(await res.arrayBuffer());
    }
  }

  if (!s3 || !process.env.S3_BUCKET) {
    throw new Error('Recording source is not accessible (no reachable URL and S3 is not configured)');
  }

  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: storageKey,
    }),
  );
  return readBodyToUint8Array(obj.Body);
}

async function transcribeWithOpenAI(fileName: string, bytes: Uint8Array): Promise<OpenAITranscriptionResponse> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  if (!bytes.length) {
    throw new Error('Recording file is empty');
  }
  if (bytes.length > MAX_TRANSCRIBE_BYTES) {
    throw new Error(`Recording is too large for direct transcription (${bytes.length} bytes)`);
  }

  const form = new FormData();
  form.append('model', 'gpt-4o-transcribe');
  form.append('response_format', 'verbose_json');
  form.append('file', new Blob([bytes as BlobPart]), fileName || 'recording.mp4');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI transcription failed (${res.status}): ${text}`);
  }

  return (await res.json()) as OpenAITranscriptionResponse;
}

export async function generateTranscriptFromRecording(recordingId: number): Promise<void> {
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    include: {
      meeting: {
        select: {
          id: true,
          startedAt: true,
          actualStartedAt: true,
        },
      },
    },
  });

  if (!recording || recording.status !== 'READY' || !recording.meeting) return;

  const existingCount = await prisma.meetingTranscript.count({
    where: { meetingId: recording.meetingId },
  });
  if (existingCount > 0) return;

  const recordingBytes = await loadRecordingBytes(recording.storageUrl || null, recording.storageKey);
  const transcript = await transcribeWithOpenAI(recording.fileName || recording.storageKey, recordingBytes);

  const meetingStart = recording.meeting.actualStartedAt || recording.meeting.startedAt || new Date();
  const segments = (transcript.segments || []).filter((s) => (s.text || '').trim());

  if (segments.length > 0) {
    await prisma.meetingTranscript.createMany({
      data: segments.map((segment, idx) => {
        const offsetSeconds = Math.max(0, Math.floor(Number(segment.start || 0)));
        return {
          meetingId: recording.meetingId,
          speakerName: 'Speaker 1',
          content: (segment.text || '').trim(),
          captionTime: new Date(meetingStart.getTime() + offsetSeconds * 1000),
          offsetSeconds,
          sourceId: `post-recording-${recording.id}-${idx}`,
        };
      }),
      skipDuplicates: true,
    });
    return;
  }

  const fullText = (transcript.text || '').trim();
  if (!fullText) return;

  await prisma.meetingTranscript.create({
    data: {
      meetingId: recording.meetingId,
      speakerName: 'Speaker 1',
      content: fullText,
      captionTime: meetingStart,
      offsetSeconds: 0,
      sourceId: `post-recording-${recording.id}-full`,
    },
  });
}
