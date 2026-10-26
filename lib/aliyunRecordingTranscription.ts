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
/** 提交阶段超过该时长仍未拿到 taskId，重新提交（进程中途退出等） */
const SUBMIT_STALE_MS = 2 * 60 * 1000;
/** 对齐写入的互斥标记；超时后允许下一次打开接着写 */
const SAVE_LOCK = 'resume';
const SAVE_STALE_MS = 60 * 1000;
const SOURCE_PREFIX = 'aliyun';
/** DashScope's answer for a file it processed but found no speech in: done, not failed */
const NO_SPEECH = 'SUCCESS_WITH_NO_VALID_FRAGMENT';

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
  | { state: 'pending' }
  | { state: 'running' }
  | { state: 'failed'; error: string }
  | { state: 'no_speech' }
  | { state: 'succeeded'; transcriptionUrl: string };

async function queryTask(taskId: string): Promise<TaskResult> {
  const res = await fetch(`${DASHSCOPE_BASE}/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`DashScope query failed (${res.status})`);
  const output = field(json, 'output');
  const status = field(output, 'task_status');
  if (status === 'PENDING') return { state: 'pending' };
  if (status === 'RUNNING') return { state: 'running' };
  const results = field(output, 'results');
  const first: unknown = Array.isArray(results) ? results[0] : undefined;
  const url = field(first, 'transcription_url');
  if (status === 'SUCCEEDED' && field(first, 'subtask_status') === 'SUCCEEDED' && typeof url === 'string') {
    return { state: 'succeeded', transcriptionUrl: url };
  }
  if (field(first, 'code') === NO_SPEECH || field(first, 'message') === NO_SPEECH) return { state: 'no_speech' };
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
  // 缺少 egress 回调写入的文件起点时，用开始录制请求返回的时间近似（通常偏早 1–2 秒）
  const start = recording.mediaStartedAt ?? recording.createdAt;
  const origin = start.getTime() + SPEAK_LAG_MS;
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

async function markFailed(recordingId: number, err: unknown, clearTask = false): Promise<void> {
  await prisma.recording.update({
    where: { id: recordingId },
    data: {
      sttStatus: 'FAILED',
      sttError: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
      ...(clearTask ? { sttTaskId: null } : {}),
    },
  });
}

/**
 * 识别中按录像时长估算。预计时间内从 5 走到 90；之后按同样时长缓慢趋近 99。
 * 匹配发言人停在 99，真正写完才是 100。排队不计入。
 */
function progressOf(recording: Recording): number {
  const status = toSttStatus(recording.sttStatus);
  if (status === 'SUCCEEDED') return 100;
  if (status === 'ALIGNING') return 99;
  if (status !== 'RUNNING' || !recording.sttStartedAt) return 0;
  const expected = Math.max(60_000, (recording.durationSeconds ?? 600) * 200);
  const ratio = (Date.now() - recording.sttStartedAt.getTime()) / expected;
  if (ratio <= 1) return Math.round(5 + ratio * 85);
  const tail = 9 * (1 - Math.exp(1 - ratio));
  return Math.min(99, Math.round(90 + tail));
}

export function transcribeStateOf(recording: Recording): TranscribeState {
  // Saved as a failure before "no speech" was recognised as done
  if (toSttStatus(recording.sttStatus) === 'FAILED' && recording.sttError?.includes(NO_SPEECH)) {
    return { status: 'SUCCEEDED', progress: 100, error: null };
  }
  return {
    status: toSttStatus(recording.sttStatus),
    progress: progressOf(recording),
    error: recording.sttError === SAVE_LOCK ? null : recording.sttError,
  };
}

/**
 * claimAndSubmit — 抢占后向阿里云提交新任务。
 * 已有 taskId 的失败不走这里，避免丢掉可继续的识别结果。
 */
async function claimAndSubmit(recording: Recording): Promise<TranscribeState> {
  const staleBefore = new Date(Date.now() - SUBMIT_STALE_MS);
  const claimed = await prisma.recording.updateMany({
    where: {
      id: recording.id,
      OR: [
        { sttStatus: null },
        { sttStatus: 'FAILED', sttTaskId: null },
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
        data: { sttStatus: 'RUNNING', sttTaskId: taskId },
      });
    } catch (err) {
      console.error('[aliyunRecordingTranscription] submit failed', err);
      await markFailed(recording.id, err, true);
    }
  }

  const fresh = await prisma.recording.findUniqueOrThrow({ where: { id: recording.id } });
  return transcribeStateOf(fresh);
}

/**
 * continueTask — 用已有阿里云 taskId 接着查进度；识别完成后写入字幕。
 * 写入中断（ALIGNING / 带 taskId 的 FAILED）会再次拉取结果，不重新提交。
 */
async function continueTask(recording: Recording): Promise<void> {
  const taskId = recording.sttTaskId;
  if (!taskId) return;

  const result = await queryTask(taskId).catch((err: unknown) => {
    console.error('[aliyunRecordingTranscription] query failed', err);
    return null;
  });
  if (!result) return;

  if (result.state === 'pending') {
    if (recording.sttStatus !== 'QUEUED') {
      await prisma.recording.updateMany({
        where: {
          id: recording.id,
          sttTaskId: taskId,
          sttStatus: { in: ['RUNNING', 'SUBMITTING', 'ALIGNING', 'FAILED'] },
        },
        data: { sttStatus: 'QUEUED', sttError: null },
      });
    }
    return;
  }

  if (result.state === 'running') {
    if (recording.sttStatus !== 'RUNNING') {
      await prisma.recording.updateMany({
        where: {
          id: recording.id,
          sttTaskId: taskId,
          sttStatus: { in: ['QUEUED', 'ALIGNING', 'FAILED', 'SUBMITTING'] },
        },
        data: {
          sttStatus: 'RUNNING',
          sttError: null,
          ...(recording.sttStatus === 'QUEUED' || recording.sttStatus === 'SUBMITTING'
            ? { sttStartedAt: new Date() }
            : {}),
        },
      });
    }
    return;
  }

  if (result.state === 'failed') {
    await markFailed(recording.id, new Error(result.error), true);
    return;
  }

  // Nobody spoke: the transcription is done and simply empty.
  if (result.state === 'no_speech') {
    await prisma.recording.update({
      where: { id: recording.id },
      data: { sttStatus: 'SUCCEEDED', sttError: null },
    });
    return;
  }

  const staleSave = new Date(Date.now() - SAVE_STALE_MS);
  const claimed = await prisma.recording.updateMany({
    where: {
      id: recording.id,
      sttTaskId: taskId,
      OR: [
        { sttStatus: 'RUNNING' },
        { sttStatus: 'FAILED' },
        { sttStatus: 'ALIGNING', sttError: null },
        { sttStatus: 'ALIGNING', sttError: SAVE_LOCK, sttStartedAt: { lt: staleSave } },
      ],
    },
    data: { sttStatus: 'ALIGNING', sttError: SAVE_LOCK, sttStartedAt: new Date() },
  });
  if (claimed.count === 0) return;

  try {
    await saveTranscripts(recording, result.transcriptionUrl);
  } catch (err) {
    console.error('[aliyunRecordingTranscription] save failed', err);
    await markFailed(recording.id, err);
  }
}

/**
 * startRecordingTranscription — 提交阿里云录音文件识别任务
 *
 * 进行中或已有 taskId 的失败改为接着查，不重新提交。
 *
 * @param recording  已 READY 的录像
 * @returns 提交后的任务状态
 */
export async function startRecordingTranscription(recording: Recording): Promise<TranscribeState> {
  const status = toSttStatus(recording.sttStatus);
  if (
    status === 'RUNNING' ||
    status === 'QUEUED' ||
    status === 'ALIGNING' ||
    status === 'SUBMITTING' ||
    (status === 'FAILED' && recording.sttTaskId)
  ) {
    return advanceRecordingTranscription(recording);
  }
  return claimAndSubmit(recording);
}

/**
 * advanceRecordingTranscription — 接着上次的解析往下走
 *
 * RUNNING 继续查阿里云；ALIGNING 或写入失败则重新拉取结果并写入。
 * 提交阶段超时则重新提交。由打开回放页和前端轮询驱动。
 *
 * @param recording  录像（读取当前 stt 状态）
 * @returns 最新任务状态
 */
export async function advanceRecordingTranscription(recording: Recording): Promise<TranscribeState> {
  const latest = await prisma.recording.findUnique({ where: { id: recording.id } });
  const current = latest ?? recording;
  const status = toSttStatus(current.sttStatus);

  if (status === 'SUBMITTING') {
    const stale =
      !current.sttStartedAt || Date.now() - current.sttStartedAt.getTime() > SUBMIT_STALE_MS;
    if (stale) return claimAndSubmit(current);
  } else if (
    current.sttTaskId &&
    (status === 'QUEUED' || status === 'RUNNING' || status === 'ALIGNING' || status === 'FAILED')
  ) {
    await continueTask(current);
  }

  const fresh = await prisma.recording.findUniqueOrThrow({ where: { id: recording.id } });
  return transcribeStateOf(fresh);
}
