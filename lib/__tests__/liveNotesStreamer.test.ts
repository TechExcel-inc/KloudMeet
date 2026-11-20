import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_NOTES_PATH, LIVE_NOTES_TOKEN_PATH } from '@/lib/liveNotes';
import { floatToPcm16, NotesStream, resampleMono, type NotesSocket } from '@/lib/liveNotesStreamer';

/** A relay connection the test drives by hand. */
class FakeSocket implements NotesSocket {
  readyState = 0;
  bufferedAmount = 0;
  sent: Array<string | ArrayBuffer> = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  /** The connection opens and the recognizer says it is ready. */
  ready() {
    this.readyState = 1;
    this.onopen?.();
    this.say({ type: 'ready' });
  }
  say(line: object) {
    this.onmessage?.({ data: JSON.stringify(line) });
  }
  audio(): ArrayBuffer[] {
    return this.sent.filter((item): item is ArrayBuffer => typeof item !== 'string');
  }
  texts(): Array<{ type: string; lang?: string }> {
    return this.sent.filter((item): item is string => typeof item === 'string').map((item) => JSON.parse(item));
  }
}

const frame = (fill: number) => new Uint8Array(8192).fill(fill).buffer;

describe('NotesStream', () => {
  let now: number;
  let sockets: FakeSocket[];
  let ticket: { status: number; body?: object };
  let posted: Array<{ token: string; sentences: Array<{ stream: number; id: number; startMs: number; endMs: number; text: string }> }>;
  let postStatus: number;
  let ticketCalls: number;
  let stream: NotesStream;

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (url === LIVE_NOTES_TOKEN_PATH) {
      ticketCalls += 1;
      expect(body).toEqual({ token: 'rec-token', clock: now });
      return Response.json(ticket.body ?? {}, { status: ticket.status });
    }
    if (url === LIVE_NOTES_PATH) {
      if (postStatus === 200) posted.push(body);
      return Response.json({ ok: postStatus === 200 }, { status: postStatus });
    }
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;

  /** Lets pending promises (the ticket request) settle. */
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(0);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_700_000_000_000;
    sockets = [];
    posted = [];
    postStatus = 200;
    ticketCalls = 0;
    ticket = { status: 200, body: { live: true, token: 'ticket-1', lang: '' } };
    stream = new NotesStream({
      token: 'rec-token',
      relayUrl: (value) => `wss://relay.test/ws/funasr?token=${value}`,
      openSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      fetchImpl,
      now: () => now,
      log: () => undefined,
    });
  });

  afterEach(() => {
    stream.stop();
    vi.useRealTimers();
  });

  it('sends audio captured before the connection was ready first, then live audio', async () => {
    stream.start();
    stream.pushAudio(frame(1), now - 256);
    await settle();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('wss://relay.test/ws/funasr?token=ticket-1');
    stream.pushAudio(frame(2), now);
    expect(sockets[0].audio()).toHaveLength(0);

    sockets[0].ready();
    expect(sockets[0].texts()).toEqual([{ type: 'start', lang: '' }]);
    stream.pushAudio(frame(3), now + 256);
    expect(sockets[0].audio().map((buffer) => new Uint8Array(buffer)[0])).toEqual([1, 2, 3]);
  });

  it('places a finished sentence on the page clock and posts it', async () => {
    stream.start();
    await settle();
    sockets[0].ready();
    stream.pushAudio(frame(1), now);
    const streamStart = now;
    now += 9000;
    sockets[0].say({ type: 'partial', id: 1, text: 'hello', begin: 1200, end: null });
    sockets[0].say({ type: 'final', id: 1, text: ' hello everyone ', begin: 1200, end: 4300 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(posted).toEqual([
      { token: 'rec-token', sentences: [{ stream: streamStart, id: 1, startMs: streamStart + 1200, endMs: streamStart + 4300, text: 'hello everyone' }] },
    ]);
  });

  it('keeps a sentence and tries again when the server cannot take it yet', async () => {
    stream.start();
    await settle();
    sockets[0].ready();
    stream.pushAudio(frame(1), now);
    now += 5000;
    sockets[0].say({ type: 'final', id: 1, text: 'first', begin: 0, end: 1000 });
    postStatus = 503;
    await vi.advanceTimersByTimeAsync(1000);
    expect(posted).toHaveLength(0);
    postStatus = 200;
    await vi.advanceTimersByTimeAsync(1000);
    expect(posted).toHaveLength(1);
    expect(posted[0].sentences[0].text).toBe('first');
    await vi.advanceTimersByTimeAsync(3000);
    expect(posted).toHaveLength(1);
  });

  it('waits for the session row, and never streams for a recording that keeps a file', async () => {
    ticket = { status: 404 };
    stream.start();
    await settle();
    expect(sockets).toHaveLength(0);
    ticket = { status: 200, body: { live: true, token: 'ticket-2', lang: 'zh' } };
    await vi.advanceTimersByTimeAsync(2000);
    expect(sockets).toHaveLength(1);
    sockets[0].ready();
    expect(sockets[0].texts()).toEqual([{ type: 'start', lang: 'zh' }]);

    const other = new NotesStream({
      token: 'rec-token',
      relayUrl: (value) => value,
      openSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      fetchImpl,
      now: () => now,
      log: () => undefined,
    });
    ticket = { status: 409, body: { live: false } };
    other.start();
    await settle();
    const calls = ticketCalls;
    other.pushAudio(frame(1), now);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    expect(ticketCalls).toBe(calls);
    expect(other.active).toBe(false);
    other.stop();
  });

  it('says once whether the recording takes live notes, so audio is captured only then', async () => {
    const make = (answers: boolean[]) => new NotesStream({
      token: 'rec-token',
      relayUrl: (value) => value,
      openSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      fetchImpl,
      now: () => now,
      log: () => undefined,
      onLive: (live) => answers.push(live),
    });
    const live: boolean[] = [];
    const first = make(live);
    ticket = { status: 404 };
    first.start();
    await settle();
    expect(live).toEqual([]);
    ticket = { status: 200, body: { live: true, token: 'ticket-1', lang: '' } };
    await vi.advanceTimersByTimeAsync(2000);
    expect(live).toEqual([true]);
    // Reconnecting does not announce again.
    sockets[0].ready();
    sockets[0].readyState = 3;
    sockets[0].onclose?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
    expect(live).toEqual([true]);
    first.stop();

    const file: boolean[] = [];
    const second = make(file);
    ticket = { status: 409, body: { live: false } };
    second.start();
    await settle();
    expect(file).toEqual([false]);
    second.stop();
  });

  it('reconnects when the relay drops, without losing the audio captured meanwhile', async () => {
    stream.start();
    await settle();
    sockets[0].ready();
    stream.pushAudio(frame(1), now);
    const firstStart = now;

    sockets[0].readyState = 3;
    sockets[0].onclose?.();
    now += 300;
    stream.pushAudio(frame(2), now);
    ticket = { status: 200, body: { live: true, token: 'ticket-2', lang: '' } };
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
    sockets[1].ready();
    expect(sockets[1].audio().map((buffer) => new Uint8Array(buffer)[0])).toEqual([2]);

    // The new stream times its sentences from its own first frame.
    now += 4000;
    sockets[1].say({ type: 'final', id: 1, text: 'after the drop', begin: 500, end: 2500 });
    await vi.advanceTimersByTimeAsync(1000);
    const [line] = posted[0].sentences;
    expect(line.stream).toBe(firstStart + 300);
    expect(line.startMs).toBe(firstStart + 300 + 500);
  });

  it('reconnects when the relay stops taking audio', async () => {
    stream.start();
    await settle();
    sockets[0].ready();
    sockets[0].bufferedAmount = 2_000_000;
    stream.pushAudio(frame(7), now);
    expect(sockets[0].closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
    sockets[1].ready();
    expect(sockets[1].audio().map((buffer) => new Uint8Array(buffer)[0])).toEqual([7]);
  });

  it('pausing takes the sentence in progress and sends nothing until notes resume', async () => {
    stream.start();
    await settle();
    sockets[0].ready();
    stream.pushAudio(frame(1), now);
    now += 3000;

    stream.setPaused(true);
    expect(sockets[0].texts().slice(-1)).toEqual([{ type: 'finish' }]);
    sockets[0].say({ type: 'final', id: 1, text: 'said just before the pause', begin: 0, end: 2500 });
    sockets[0].say({ type: 'closed' });
    expect(sockets[0].closed).toBe(true);
    stream.pushAudio(frame(2), now);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sockets).toHaveLength(1);
    expect(posted.flatMap((batch) => batch.sentences.map((line) => line.text))).toEqual(['said just before the pause']);

    stream.setPaused(false);
    await settle();
    expect(sockets).toHaveLength(2);
    sockets[1].ready();
    stream.pushAudio(frame(3), now);
    expect(sockets[1].audio().map((buffer) => new Uint8Array(buffer)[0])).toEqual([3]);
  });

  it('finish() hands in the last sentence at once and does not reconnect', async () => {
    stream.start();
    await settle();
    sockets[0].ready();
    stream.pushAudio(frame(1), now);
    now += 4000;

    const done = stream.finish();
    sockets[0].say({ type: 'final', id: 2, text: 'the last words', begin: 1000, end: 3000 });
    sockets[0].say({ type: 'closed' });
    await done;
    expect(posted.flatMap((batch) => batch.sentences.map((line) => line.text))).toEqual(['the last words']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sockets).toHaveLength(1);
  });

  it('finish() does not wait forever for a recognizer that says nothing', async () => {
    stream.start();
    await settle();
    sockets[0].ready();
    let finished = false;
    void stream.finish().then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(1400);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(finished).toBe(true);
    expect(sockets[0].closed).toBe(true);
  });
});

describe('audio conversion', () => {
  it('resamples to 16 kHz and converts to PCM16', () => {
    const input = new Float32Array(48).fill(0.5);
    const resampled = resampleMono(input, 48000, 16000);
    expect(resampled.length).toBe(16);
    expect(resampleMono(input, 16000, 16000)).toBe(input);
    const pcm = new Int16Array(floatToPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5])));
    expect(Array.from(pcm)).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
  });
});
