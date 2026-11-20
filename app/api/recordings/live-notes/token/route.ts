/**
 * POST /api/recordings/live-notes/token
 *
 * The recorder page asks for a one-time Fun-ASR relay ticket before it opens (or reopens) its
 * recognition stream. Auth: Recording.activityToken.
 *
 * The first call also fixes the session's time zero to the recorder's clock, so sentence
 * offsets and speak intervals share one clock from the first sentence on.
 *
 * 409 `live: false` tells the page this recording keeps a media file (or has ended): it must
 * not stream.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { issueFunAsrTicket } from '@/lib/funAsrToken';
import { hasNoMedia } from '@/lib/liveNotes';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A recorder clock further than this from the server's is ignored as time zero. */
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  return runWithLocale(req, async () => {
  try {
    const body: unknown = await req.json().catch(() => null);
    const token = typeof body === 'object' && body !== null ? Reflect.get(body, 'token') : null;
    const clock = typeof body === 'object' && body !== null ? Reflect.get(body, 'clock') : null;
    if (typeof token !== 'string' || !token) {
      return apiJson({ error: 'token is required' }, { status: 400 });
    }

    const recording = await prisma.recording.findUnique({
      where: { activityToken: token },
      select: { id: true, deletedAt: true, storageProvider: true, status: true, pausedAt: true, mediaStartedAt: true },
    });
    if (!recording || recording.deletedAt) {
      return apiJson({ error: 'Recording not found' }, { status: 404 });
    }
    if (!hasNoMedia(recording) || recording.status !== 'PROCESSING') {
      return apiJson({ error: 'Live notes are not running for this recording', live: false }, { status: 409 });
    }

    const key = process.env.DASHSCOPE_API_KEY || '';
    if (!key) {
      return apiJson({ error: 'Fun-ASR is not configured' }, { status: 500 });
    }

    if (
      !recording.mediaStartedAt &&
      typeof clock === 'number' && Number.isFinite(clock) &&
      Math.abs(clock - Date.now()) <= CLOCK_TOLERANCE_MS
    ) {
      await prisma.recording.updateMany({
        where: { id: recording.id, mediaStartedAt: null },
        data: { mediaStartedAt: new Date(clock) },
      });
    }

    return apiJson(
      {
        live: true,
        token: issueFunAsrTicket(key),
        paused: !!recording.pausedAt,
        // Empty: the recognizer detects the language itself (meetings mix Chinese and English).
        lang: (process.env.AI_NOTES_LANGUAGE || '').trim().toLowerCase(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[recordings live-notes token POST]', err);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
