/**
 * A silent WAV file of a chosen length, produced on request and never stored.
 *
 * Replay keeps time with a media element (seeking, speed, the paused-stretch skip, the LiveDoc
 * stage all read it). An AI Taking Notes session has no media file, so replay plays this silent
 * file of the session's length instead: the same player, the same clock, no sound.
 *
 * 8 kHz, 8-bit, mono PCM: the smallest format every browser plays (8 KB per second).
 */

const SAMPLE_RATE = 8000;
const HEADER_BYTES = 44;
/** 8-bit PCM is unsigned: this is zero amplitude. */
const SILENCE = 0x80;
const CHUNK_BYTES = 64 * 1024;

export function silentWavSize(seconds: number): number {
  return HEADER_BYTES + seconds * SAMPLE_RATE;
}

export function silentWavHeader(seconds: number): Uint8Array {
  const dataBytes = seconds * SAMPLE_RATE;
  const header = new Uint8Array(HEADER_BYTES);
  const view = new DataView(header.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) header[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk length
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE, true); // bytes per second
  view.setUint16(32, 1, true); // bytes per sample frame
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return header;
}

/**
 * The byte range a `Range` header asks for, inclusive, within a file of `size` bytes.
 * `null` header: the whole file. Returns 'invalid' for a range that can't be served (416).
 */
export function parseByteRange(header: string | null, size: number): { start: number; end: number } | 'invalid' {
  if (!header) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return 'invalid';
  if (!match[1]) {
    // "-N": the last N bytes
    const last = Number(match[2]);
    if (last <= 0) return 'invalid';
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || end < start) return 'invalid';
  return { start, end };
}

/** Bytes `start..end` (inclusive) of the silent WAV of `seconds`, in chunks. */
export function* silentWavChunks(seconds: number, start: number, end: number): Generator<Uint8Array> {
  let at = start;
  if (at < HEADER_BYTES) {
    const header = silentWavHeader(seconds);
    const part = header.subarray(at, Math.min(HEADER_BYTES, end + 1));
    yield part;
    at += part.length;
  }
  while (at <= end) {
    const length = Math.min(CHUNK_BYTES, end - at + 1);
    yield new Uint8Array(length).fill(SILENCE);
    at += length;
  }
}
