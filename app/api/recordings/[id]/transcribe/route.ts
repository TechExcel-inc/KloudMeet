/**
 * /api/recordings/[id]/transcribe
 *
 * POST：提交阿里云录音文件识别任务（会议已有字幕时拒绝）。
 * GET ：轮询任务进度；完成时用录制采样的说话区间匹配说话人并写入 MeetingTranscript。
 * 已登录且能观看该录像的用户可用。
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { isRecordingResponse, loadAccessibleRecording } from '@/lib/recordingShare';
import {
  advanceRecordingTranscription,
  startRecordingTranscription,
} from '@/lib/aliyunRecordingTranscription';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return runWithLocale(req, async () => {
  try {
    const loaded = await loadAccessibleRecording(req, (await params).id);
    if (isRecordingResponse(loaded)) return loaded;
    const recording = loaded.recording;

    if (recording.status !== 'READY') {
      return apiJson({ error: 'Recording is not ready yet' }, { status: 409 });
    }
    const existing = await prisma.meetingTranscript.count({
      where: { meetingId: recording.meetingId },
    });
    if (existing > 0) {
      return apiJson({ error: 'Transcript already exists' }, { status: 409 });
    }

    return apiJson(await startRecordingTranscription(recording));
  } catch (err) {
    console.error('[POST /api/recordings/[id]/transcribe]', err);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}

export async function GET(req: NextRequest, { params }: Params) {
  return runWithLocale(req, async () => {
  try {
    const loaded = await loadAccessibleRecording(req, (await params).id);
    if (isRecordingResponse(loaded)) return loaded;
    return apiJson(await advanceRecordingTranscription(loaded.recording), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[GET /api/recordings/[id]/transcribe]', err);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
