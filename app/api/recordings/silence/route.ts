/**
 * GET /api/recordings/silence?seconds=N
 *
 * A silent audio file N seconds long (lib/silentWav.ts): the playback clock of a replay that has
 * no media file (AI Taking Notes). It carries no meeting data, so it needs no sign-in, and it is
 * the same for every request of the same length, so browsers may cache it.
 * Supports byte ranges, which media players need for seeking.
 */
import { NextRequest } from 'next/server';
import { SILENCE_MAX_SECONDS } from '@/lib/liveNotes';
import { parseByteRange, silentWavChunks, silentWavSize } from '@/lib/silentWav';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const seconds = Number(req.nextUrl.searchParams.get('seconds'));
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > SILENCE_MAX_SECONDS) {
    return new Response('seconds must be a whole number of seconds', { status: 400 });
  }
  const size = silentWavSize(seconds);
  const rangeHeader = req.headers.get('range');
  const range = parseByteRange(rangeHeader, size);
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  const chunks = silentWavChunks(seconds, range.start, range.end);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
  });
  return new Response(body, {
    status: rangeHeader ? 206 : 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(range.end - range.start + 1),
      'Accept-Ranges': 'bytes',
      ...(rangeHeader ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
