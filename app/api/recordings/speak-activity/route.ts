/**
 * POST /api/recordings/speak-activity
 *
 * 录制机器人（Web Egress 打开的 isBot 页面）上报说话区间。
 * 鉴权：开始录制时生成并写入 Recording.activityToken 的一次性 token。
 * 入库时间保持采集端时钟：机器人与 egress 同机，和 Recording.mediaStartedAt 同一时钟，
 * 不可用服务器时间校正（会混入网络延迟）。对齐录像时减去 mediaStartedAt。
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { readSpeakBatch } from '@/lib/recordingSpeakActivity';
import { hasNoMedia } from '@/lib/liveNotes';
import { realignLiveNotes } from '@/lib/liveNotesServer';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

const NAME_MAX = 191;

const clampLevel = (value: number) => Math.min(1, Math.max(0, value));

export async function POST(req: NextRequest) {
  return runWithLocale(req, async () => {
  try {
    const batch = readSpeakBatch(await req.json().catch(() => null));
    if (!batch) {
      return apiJson({ error: 'Invalid speak activity batch' }, { status: 400 });
    }

    const recording = await prisma.recording.findUnique({
      where: { activityToken: batch.token },
      select: { id: true, deletedAt: true, meetingId: true, storageProvider: true, mediaStartedAt: true, createdAt: true },
    });
    if (!recording || recording.deletedAt) {
      return apiJson({ error: 'Recording not found' }, { status: 404 });
    }

    if (batch.intervals.length === 0) {
      return apiJson({ ok: true, count: 0 });
    }

    const result = await prisma.recordingSpeakInterval.createMany({
      data: batch.intervals.map((item) => ({
        recordingId: recording.id,
        participantIdentity: item.identity.slice(0, NAME_MAX),
        displayName: (item.name || item.identity).slice(0, NAME_MAX),
        startedAt: new Date(item.startMs),
        endedAt: new Date(item.endMs),
        avgLevel: clampLevel(item.avgLevel),
        peakLevel: clampLevel(item.peakLevel),
      })),
    });

    // AI Taking Notes: sentences arrive before the intervals around them, so name them now.
    if (hasNoMedia(recording)) {
      const fromMs = Math.min(...batch.intervals.map((item) => item.startMs));
      await realignLiveNotes(recording, { fromMs }).catch((err: unknown) =>
        console.error('[recordings speak-activity] live notes realign failed', recording.id, err),
      );
    }

    return apiJson({ ok: true, count: result.count });
  } catch (err) {
    console.error('[recordings speak-activity POST]', err);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
