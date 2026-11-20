/**
 * POST /api/recordings/live-notes
 *
 * AI Taking Notes: the recorder page (the web egress bot) posts each sentence the recognizer
 * finished while the meeting runs. No audio is stored; these rows are the notes' transcript.
 * Auth: the one-time Recording.activityToken the recorder page was opened with.
 * Sentence times stay on the recorder's clock (the same clock as its speak intervals).
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { hasNoMedia, readLiveBatch } from '@/lib/liveNotes';
import { saveLiveSentences } from '@/lib/liveNotesServer';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return runWithLocale(req, async () => {
  try {
    const batch = readLiveBatch(await req.json().catch(() => null));
    if (!batch) {
      return apiJson({ error: 'Invalid live notes batch' }, { status: 400 });
    }

    const recording = await prisma.recording.findUnique({ where: { activityToken: batch.token } });
    if (!recording || recording.deletedAt) {
      return apiJson({ error: 'Recording not found' }, { status: 404 });
    }
    // A recording with a media file gets its transcript from the file afterwards.
    if (!hasNoMedia(recording)) {
      return apiJson({ error: 'This recording keeps a media file', live: false }, { status: 409 });
    }

    const count = batch.sentences.length ? await saveLiveSentences(recording, batch.sentences) : 0;
    return apiJson({ ok: true, count });
  } catch (err) {
    console.error('[recordings live-notes POST]', err);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
