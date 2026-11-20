import { describe, expect, it } from 'vitest';
import {
  hasNoMedia,
  liveNotesEnabled,
  liveSourceDurationMs,
  liveSourceId,
  liveSourcePrefix,
  notesDurationSeconds,
  readLiveBatch,
  reconnectDelayMs,
  sentenceWallTime,
  silenceUrl,
} from '@/lib/liveNotes';
import { parseByteRange, silentWavChunks, silentWavHeader, silentWavSize } from '@/lib/silentWav';

const sentence = { stream: 1_700_000_000_000, id: 3, startMs: 1_700_000_004_000, endMs: 1_700_000_006_500, text: ' hello ' };

describe('live notes settings', () => {
  it('takes live notes unless the server is set to keep a file', () => {
    expect(liveNotesEnabled({})).toBe(true);
    expect(liveNotesEnabled({ AI_NOTES_CAPTURE: 'live' })).toBe(true);
    expect(liveNotesEnabled({ AI_NOTES_CAPTURE: ' File ' })).toBe(false);
  });

  it('knows a session without a media file by its storage provider', () => {
    expect(hasNoMedia({ storageProvider: 'NONE' })).toBe(true);
    expect(hasNoMedia({ storageProvider: 'S3' })).toBe(false);
  });
});

describe('readLiveBatch', () => {
  it('accepts sentences and trims their text', () => {
    expect(readLiveBatch({ token: 't', sentences: [sentence] })).toEqual({
      token: 't',
      sentences: [{ ...sentence, text: 'hello' }],
    });
    expect(readLiveBatch({ token: 't', sentences: [] })).toEqual({ token: 't', sentences: [] });
  });

  it('refuses a batch with a bad sentence, no token, or too many sentences', () => {
    expect(readLiveBatch({ token: '', sentences: [] })).toBeNull();
    expect(readLiveBatch({ token: 't', sentences: [{ ...sentence, text: '   ' }] })).toBeNull();
    expect(readLiveBatch({ token: 't', sentences: [{ ...sentence, endMs: sentence.startMs - 1 }] })).toBeNull();
    expect(readLiveBatch({ token: 't', sentences: [{ ...sentence, startMs: 1.5 }] })).toBeNull();
    expect(readLiveBatch({ token: 't', sentences: [{ ...sentence, endMs: sentence.startMs + 11 * 60 * 1000 }] })).toBeNull();
    expect(readLiveBatch({ token: 't', sentences: Array.from({ length: 101 }, () => sentence) })).toBeNull();
    expect(readLiveBatch(null)).toBeNull();
  });
});

describe('live source ids', () => {
  it('carry the sentence length, which the transcript table has no column for', () => {
    const id = liveSourceId(42, sentence);
    expect(id).toBe('live-42-1700000000000-3-2500');
    expect(id.startsWith(liveSourcePrefix(42))).toBe(true);
    expect(liveSourceDurationMs(id)).toBe(2500);
  });

  it('are not confused with captions or file transcripts', () => {
    expect(liveSourceDurationMs(null)).toBeNull();
    expect(liveSourceDurationMs('aliyun-42-3')).toBeNull();
    expect(liveSourcePrefix(4)).not.toBe(liveSourcePrefix(42).slice(0, liveSourcePrefix(4).length));
  });
});

describe('sentenceWallTime', () => {
  const streamStartMs = 1_000_000;

  it('places a sentence by its offsets from the start of the stream', () => {
    expect(
      sentenceWallTime({ streamStartMs, beginMs: 4200, endMs: 6900, nowMs: streamStartMs + 8000, text: 'hello there' }),
    ).toEqual({ startMs: 1_004_200, endMs: 1_006_900 });
  });

  it('falls back to the arrival time when the offsets are missing or cannot be right', () => {
    const nowMs = streamStartMs + 20_000;
    for (const [beginMs, endMs] of [[null, null], [5000, 4000], [30_000, 40_000], [-1, 100]] as const) {
      const time = sentenceWallTime({ streamStartMs, beginMs, endMs, nowMs, text: 'twelve chars', silenceMs: 800 });
      expect(time.endMs).toBe(nowMs - 800);
      expect(time.startMs).toBe(nowMs - 800 - 12 * 220);
    }
  });

  it('never places a sentence before its stream started', () => {
    const time = sentenceWallTime({ streamStartMs, beginMs: null, endMs: null, nowMs: streamStartMs + 500, text: 'x'.repeat(100) });
    expect(time.startMs).toBe(streamStartMs);
    expect(time.endMs).toBe(streamStartMs);
  });
});

describe('session helpers', () => {
  it('backs off reconnects up to 15 seconds', () => {
    expect([0, 1, 2, 3, 4, 9].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
  });

  it('measures a session in whole seconds, never negative', () => {
    expect(notesDurationSeconds(new Date(0), new Date(65_900))).toBe(65);
    expect(notesDurationSeconds(new Date(5000), new Date(0))).toBe(0);
  });

  it('builds a silent clock of the session length, within limits', () => {
    expect(silenceUrl(65.2)).toBe('/api/recordings/silence?seconds=66');
    expect(silenceUrl(0)).toBe('/api/recordings/silence?seconds=1');
    expect(silenceUrl(99 * 3600)).toBe('/api/recordings/silence?seconds=43200');
  });
});

describe('silent WAV', () => {
  const bytes = (seconds: number, start: number, end: number) => {
    const parts = [...silentWavChunks(seconds, start, end)];
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };

  it('is a valid 8 kHz 8-bit mono file of the asked length', () => {
    const header = silentWavHeader(10);
    const view = new DataView(header.buffer);
    const text = (offset: number) => String.fromCharCode(...header.subarray(offset, offset + 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint32(4, true)).toBe(36 + 80_000);
    expect([view.getUint16(20, true), view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)]).toEqual([1, 1, 8000, 8]);
    expect(view.getUint32(40, true)).toBe(80_000);
    expect(silentWavSize(10)).toBe(80_044);
  });

  it('serves any byte range of the same file', () => {
    const whole = bytes(20, 0, silentWavSize(20) - 1);
    expect(whole.length).toBe(silentWavSize(20));
    expect(whole.subarray(44).every((value) => value === 0x80)).toBe(true);
    expect(bytes(20, 10, 99)).toEqual(whole.subarray(10, 100));
    expect(bytes(20, 44, 44)).toEqual(new Uint8Array([0x80]));
    expect(bytes(20, 70_000, 150_000)).toEqual(whole.subarray(70_000, 150_001));
  });

  it('reads Range headers the way players send them', () => {
    expect(parseByteRange(null, 1000)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(parseByteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    for (const bad of ['bytes=1000-', 'bytes=5-2', 'bytes=-', 'bytes=-0', 'items=0-5', 'bytes=0-1,5-9']) {
      expect(parseByteRange(bad, 1000)).toBe('invalid');
    }
  });
});
