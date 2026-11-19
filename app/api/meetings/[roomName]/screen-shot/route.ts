import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyParticipant } from '@/lib/livekitParticipantAuth';
import { putMultipart, screenShotKey } from '@/lib/objectStore';
import { recordingModeOf } from '@/lib/recordingControls';
import { SHOT_KIND, SHOT_MAX_BYTES, shotAnchor, shotOffset } from '@/lib/shareShot';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

/**
 * POST /api/meetings/[roomName]/screen-shot
 *
 * AI Notes Only：共享者上传一张有变化的画面。`?end=1` 表示这次共享结束，收起还开着的图。
 * 鉴权用参会 token，访客共享也可以交图。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ roomName: string }> }) {
  return runWithLocale(request, async () => {
    try {
      const roomName = (await params)?.roomName;
      const participant = await verifyParticipant(request, { publish: true });
      if (!roomName || !participant || participant.room !== roomName) {
        return apiJson({ error: 'Unauthorized' }, { status: 401 });
      }

      const meeting = await prisma.meeting.findUnique({ where: { roomName }, select: { id: true } });
      if (!meeting) return apiJson({ error: 'Meeting not found' }, { status: 404 });
      const recording = await prisma.recording.findFirst({
        where: { meetingId: meeting.id, status: 'PROCESSING', deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (!recording || recordingModeOf(recording.mode) !== 'ai_notes') {
        return apiJson({ error: 'No AI Notes recording' }, { status: 409 });
      }

      const at = new Date();
      const ms = shotOffset(shotAnchor(recording), at);
      const open = {
        recordingId: recording.id,
        kind: SHOT_KIND,
        userId: participant.identity,
        endMs: null,
        status: 'READY',
      };

      if (request.nextUrl.searchParams.get('end') === '1') {
        const rows = await prisma.recordingSection.findMany({ where: open, select: { id: true, startMs: true } });
        for (const row of rows) {
          await prisma.recordingSection.update({
            where: { id: row.id },
            data: { endMs: Math.max(ms, row.startMs ?? ms) },
          });
        }
        return apiJson({ ok: true });
      }

      const type = request.headers.get('content-type') ?? '';
      if (!type.startsWith('image/jpeg')) return apiJson({ error: 'JPEG required' }, { status: 400 });
      const bytes = Buffer.from(await request.arrayBuffer());
      if (bytes.length < 32 || bytes.length > SHOT_MAX_BYTES) {
        return apiJson({ error: 'Unexpected image size' }, { status: 400 });
      }
      if (!process.env.S3_BUCKET) return apiJson({ error: 'Storage is not configured' }, { status: 500 });

      const key = screenShotKey(roomName, at.getTime(), crypto.randomUUID().slice(0, 8));
      await putMultipart(key, bytes, 'image/jpeg');

      const previous = await prisma.recordingSection.findMany({ where: open, select: { id: true, startMs: true } });
      for (const row of previous) {
        await prisma.recordingSection.update({
          where: { id: row.id },
          data: { endMs: Math.max(ms, row.startMs ?? ms) },
        });
      }
      await prisma.recordingSection.create({
        data: {
          recordingId: recording.id,
          kind: SHOT_KIND,
          storageKey: key,
          status: 'READY',
          startMs: ms,
          userId: participant.identity,
          providerRef: `shot_${crypto.randomUUID()}`,
        },
      });
      return apiJson({ ok: true });
    } catch (err) {
      console.error('[meetings screen-shot POST]', err);
      return apiJson({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
