/**
 * /api/recordings/[id]/transcribe
 *
 * POST：提交阿里云录音文件识别任务（会议已有字幕时拒绝）。
 * GET ：轮询任务进度；完成时用录制采样的说话区间匹配说话人并写入 MeetingTranscript。
 * 仅录像管理者可用（控制识别费用）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isRecordingResponse, loadManagedRecording } from '@/lib/recordingShare';
import {
  advanceRecordingTranscription,
  startRecordingTranscription,
} from '@/lib/aliyunRecordingTranscription';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const loaded = await loadManagedRecording(req, (await params).id);
    if (isRecordingResponse(loaded)) return loaded;
    const recording = loaded.recording;

    if (recording.status !== 'READY') {
      return NextResponse.json({ error: 'Recording is not ready yet' }, { status: 409 });
    }
    const existing = await prisma.meetingTranscript.count({
      where: { meetingId: recording.meetingId },
    });
    if (existing > 0) {
      return NextResponse.json({ error: 'Transcript already exists' }, { status: 409 });
    }

    return NextResponse.json(await startRecordingTranscription(recording));
  } catch (err) {
    console.error('[POST /api/recordings/[id]/transcribe]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const loaded = await loadManagedRecording(req, (await params).id);
    if (isRecordingResponse(loaded)) return loaded;
    return NextResponse.json(await advanceRecordingTranscription(loaded.recording), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[GET /api/recordings/[id]/transcribe]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
