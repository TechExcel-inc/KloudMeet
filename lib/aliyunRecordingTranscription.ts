import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Recording } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  alignSpeakTranscript,
  SPEAK_LAG_MS,
  type SpeakWindow,
  type TimedSentence,
} from '@/lib/alignSpeakTranscript';
import { toSttStatus, type TranscribeState } from '@/lib/recordingTranscribeState';

const DASHSCOPE_BASE = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1';
const MODEL = process.env.DASHSCOPE_FILE_ASR_MODEL || 'paraformer-v2';
/** 阿里云排队后才下载文件，链接有效期要覆盖排队时间 */
const FILE_URL_TTL_SECONDS = 12 * 3600;
/** 提交阶段超过该时长仍未拿到 taskId，视为失败（进程中途退出等） */
const SUBMIT_STALE_MS = 2 * 60 * 1000;
const SOURCE_PREFIX = 'aliyun';

const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-west-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET || '',
  },
});

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

function apiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY || '';
  if (!key) throw new Error('DASHSCOPE_API_KEY is not configured');
  return key;
}

function objectKey(recording: Recording): string | null {
  const fromUrl = (url: string | null) => {
    if (!url) return null;
    try {
      return new URL(url).pathname.replace(/^\//, '') || null;
    } catch {
      return null;
    }
  };
  if (recording.storageKey && !recording.storageKey.startsWith('EG_')) return recording.storageKey;
  return fromUrl(recording.storageUrl);
}

async function fileUrl(recording: Recording): Promise<string> {
  const key = objectKey(recording);
  if (!key || !process.env.S3_BUCKET) throw new Error('Cannot determine recording object key');
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), {
    expiresIn: FILE_URL_TTL_SECONDS,
  });
}

async function submitTask(url: string): Promise<string> {
  const res = await fetch(`${DASHSCOPE_BASE}/services/audio/asr/transcription`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: MODEL,
      input: { file_urls: [url] },
      parameters: { channel_id: [0], language_hints: ['zh', 'en'] },
    }),
  });
  const json: unknown = await res.json().catch(() => null);
  const taskId = field(field(json, 'output'), 'task_id');
  if (!res.ok || typeof taskId !== 'string') {
    throw new Error(`DashScope submit failed (${res.status}): ${String(field(json, 'message') ?? '')}`);
  }
  return taskId;
}

type TaskResult =
  | { state: 'running' }
  | { state: 'failed'; error: string }
  | { state: 'succeeded'; transcriptionUrl: string };

async function queryTask(taskId: string): Promise<TaskResult> {
  const res = await fetch(`${DASHSCOPE_BASE}/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`DashScope query failed (${res.status})`);
  const output = field(json, 'output');
  const status = field(output, 'task_status');
  if (status === 'PENDING' || status === 'RUNNING') return { state: 'running' };
  const results = field(output, 'results');
  const first: unknown = Array.isArray(results) ? results[0] : undefined;
  const url = field(first, 'transcription_url');
  if (status === 'SUCCEEDED' && field(first, 'subtask_status') === 'SUCCEEDED' && typeof url === 'string') {
    return { state: 'succeeded', transcriptionUrl: url };
  }
  const message = field(first, 'message') ?? field(output, 'message') ?? status;
  return { state: 'failed', error: `DashScope task failed: ${String(message)}` };
}

async function fetchSentences(url: string): Promise<TimedSentence[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download transcription result (${res.status})`);
  const json: unknown = await res.json();
  const transcripts = field(json, 'transcripts');
  if (!Array.isArray(transcripts)) return [];
  return transcripts
    .flatMap((item: unknown) => {
      const sentences = field(item, 'sentences');
      return Array.isArray(sentences) ? sentences : [];
    })
    .flatMap((sentence: unknown): TimedSentence[] => {
      const begin = field(sentence, 'begin_time');
      const end = field(sentence, 'end_time');
      const text = field(sentence, 'text');
      if (typeof begin !== 'number' || typeof end !== 'number' || typeof text !== 'string') return [];
      const trimmed = text.trim();
      return trimmed ? [{ startMs: begin, endMs: end, text: trimmed }] : [];
    })
    .sort((a, b) => a.startMs - b.startMs);
}

async function speakWindows(recording: Recording): Promise<SpeakWindow[]> {
  if (!recording.mediaStartedAt) return [];
  const origin = recording.mediaStartedAt.getTime() + SPEAK_LAG_MS;
  const rows = await prisma.recordingSpeakInterval.findMany({
    where: { recordingId: recording.id },
    orderBy: { startedAt: 'asc' },
  });
  return rows.map((row) => ({
    identity: row.participantIdentity,
    name: row.displayName,
    startMs: row.startedAt.getTime() - origin,
    endMs: row.endedAt.getTime() - origin,
    avgLevel: row.avgLevel,
  }));
}

/** 识别结果对齐说话人后写入 MeetingTranscript；无采样数据时统一记为 Speaker 1 */
async function saveTranscripts(recording: Recording, transcriptionUrl: string): Promise<void> {
  const sentences = await fetchSentences(transcriptionUrl);
  const windows = await speakWindows(recording);
  const aligned = windows.length
    ? alignSpeakTranscript(sentences, windows)
    : sentences.map((sentence) => ({ ...sentence, speakerName: 'Speaker 1' }));
  const origin = (recording.mediaStartedAt ?? recording.createdAt).getTime();
  const prefix = `${SOURCE_PREFIX}-${recording.id}-`;

  await prisma.$transaction([
    prisma.meetingTranscript.deleteMany({
      where: { meetingId: recording.meetingId, sourceId: { startsWith: prefix } },
    }),
    prisma.meetingTranscript.createMany({
      data: aligned.map((sentence, idx) => ({
        meetingId: recording.meetingId,
        speakerName: sentence.speakerName,
        content: sentence.text,
        captionTime: new Date(origin + sentence.startMs),
        offsetSeconds: Math.max(0, Math.floor(sentence.startMs / 1000)),
        sourceId: `${prefix}${idx}`,
      })),
    }),
    prisma.recording.update({
      where: { id: recording.id },
      data: { sttStatus: 'SUCCEEDED', sttError: null },
    }),
  ]);
}

async function markFailed(recordingId: number, err: unknown): Promise<void> {
  await prisma.recording.update({
    where: { id: recordingId },
    data: {
      sttStatus: 'FAILED',
      sttError: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
    },
  });
}

/** RUNNING 阶段按录像时长估算进度（约 0.1 倍实时，最短 30 秒），封顶 90 */
function progressOf(recording: Recording): number {
  const status = toSttStatus(recording.sttStatus);
  if (status === 'SUCCEEDED') return 100;
  if (status === 'ALIGNING') return 95;
  if (status === 'SUBMITTING') return 3;
  if (status !== 'RUNNING' || !recording.sttStartedAt) return 0;
  const expected = Math.max(30_000, (recording.durationSeconds ?? 600) * 100);
  const elapsed = Date.now() - recording.sttStartedAt.getTime();
  return Math.min(90, Math.round(5 + (elapsed / expected) * 85));
}

export function transcribeStateOf(recording: Recording): TranscribeState {
  return {
    status: toSttStatus(recording.sttStatus),
    progress: progressOf(recording),
    error: recording.sttError,
  };
}

/**
 * startRecordingTranscription — 提交阿里云录音文件识别任务
 *
 * 仅在无任务或上次失败时提交；用条件更新抢占，避免重复点击提交多个任务。
 *
 * @param recording  已 READY 的录像
 * @returns 提交后的任务状态
 */
export async function startRecordingTranscription(recording: Recording): Promise<TranscribeState> {
  const staleBefore = new Date(Date.now() - SUBMIT_STALE_MS);
  const claimed = await prisma.recording.updateMany({
    where: {
      id: recording.id,
      OR: [
        { sttStatus: null },
        { sttStatus: 'FAILED' },
        { sttStatus: 'SUBMITTING', sttStartedAt: { lt: staleBefore } },
      ],
    },
    data: { sttStatus: 'SUBMITTING', sttStartedAt: new Date(), sttError: null, sttTaskId: null },
  });

  if (claimed.count > 0) {
    try {
      const taskId = await submitTask(await fileUrl(recording));
      await prisma.recording.update({
        where: { id: recording.id },
        data: { sttStatus: 'RUNNING', sttTaskId: taskId, sttStartedAt: new Date() },
      });
    } catch (err) {
      console.error('[aliyunRecordingTranscription] submit failed', err);
      await markFailed(recording.id, err);
    }
  }

  const fresh = await prisma.recording.findUniqueOrThrow({ where: { id: recording.id } });
  return transcribeStateOf(fresh);
}

/**
 * advanceRecordingTranscription — 轮询阿里云任务，完成后对齐说话人并写入字幕
 *
 * 由前端轮询驱动；RUNNING → ALIGNING 用条件更新抢占，保证只写入一次。
 *
 * @param recording  录像（读取当前 stt 状态）
 * @returns 最新任务状态
 */
export async function advanceRecordingTranscription(recording: Recording): Promise<TranscribeState> {
  const status = toSttStatus(recording.sttStatus);

  if (status === 'SUBMITTING' && recording.sttStartedAt) {
    if (Date.now() - recording.sttStartedAt.getTime() > SUBMIT_STALE_MS) {
      await markFailed(recording.id, new Error('Submit timed out'));
    }
  }

  if (status === 'RUNNING' && recording.sttTaskId) {
    // 查询失败多为网络抖动，保持 RUNNING 等下次轮询
    const result = await queryTask(recording.sttTaskId).catch((err: unknown) => {
      console.error('[aliyunRecordingTranscription] query failed', err);
      return null;
    });
    if (result?.state === 'failed') await markFailed(recording.id, new Error(result.error));
    if (result?.state === 'succeeded') {
      const claimed = await prisma.recording.updateMany({
        where: { id: recording.id, sttStatus: 'RUNNING' },
        data: { sttStatus: 'ALIGNING' },
      });
      if (claimed.count > 0) {
        try {
          await saveTranscripts(recording, result.transcriptionUrl);
        } catch (err) {
          console.error('[aliyunRecordingTranscription] save failed', err);
          await markFailed(recording.id, err);
        }
      }
    }
  }

  const fresh = await prisma.recording.findUniqueOrThrow({ where: { id: recording.id } });
  return transcribeStateOf(fresh);
}
