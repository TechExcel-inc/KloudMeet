import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssemblyAiHelper } from './AssemblyAiHelper';
import { CaptionEngineError } from './captionErrors';

/** Relay socket stand-in: tests drive open / ready / close by hand. */
class MockSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static last: MockSocket | null = null;
  readyState = 0;
  bufferedAmount = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) {
    MockSocket.last = this;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockSocket.CLOSED;
  }
  open() {
    this.readyState = MockSocket.OPEN;
    this.onopen?.();
  }
  ready() {
    this.onmessage?.({ data: JSON.stringify({ type: 'Begin' }) });
  }
  serverClose(code = 1011) {
    this.readyState = MockSocket.CLOSED;
    this.onclose?.({ code });
  }
}

class MockAudioContext {
  sampleRate = 16000;
  destination = {};
  closed = false;
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
  createScriptProcessor() {
    return { connect() {}, disconnect() {}, onaudioprocess: null };
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

const track = { stop: vi.fn() };
const getUserMedia = vi.fn();
const fetchMock = vi.fn();

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** Start and walk the stream to ready; resolves once the engine is live. */
async function startLive(helper: AssemblyAiHelper) {
  const started = helper.Start();
  await flush();
  MockSocket.last!.open();
  MockSocket.last!.ready();
  await started;
}

beforeEach(() => {
  MockSocket.last = null;
  track.stop.mockClear();
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [track] });
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ token: 't' }) });
  vi.stubGlobal('WebSocket', MockSocket);
  vi.stubGlobal('AudioContext', MockAudioContext);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AssemblyAiHelper', () => {
  it('maps partial turns and the final turn flushed when stopping', async () => {
    const helper = new AssemblyAiHelper(() => 'lk');
    const onMessage = vi.fn();
    helper.OnMessage = onMessage;
    await startLive(helper);
    const socket = MockSocket.last!;
    expect(new URL(socket.url).searchParams.get('speech_model')).toBe('whisper-rt');

    socket.onmessage?.({ data: JSON.stringify({
      type: 'Turn', turn_order: 0, transcript: '你好', end_of_turn: false,
    }) });
    helper.Stop();
    expect(socket.sent).toContain(JSON.stringify({ type: 'Terminate' }));
    socket.onmessage?.({ data: JSON.stringify({
      type: 'Turn', turn_order: 0, transcript: '你好。', end_of_turn: true, language_code: 'zh',
    }) });
    socket.serverClose(1000);

    expect(onMessage.mock.calls.map(([message]) => message)).toEqual([
      { id: 0, src: '你好', type: 1, detectedLanguage: undefined },
      { id: 0, src: '你好。', type: 0, detectedLanguage: 'zh' },
    ]);
  });

  it('a stream drop after ready releases the mic and reports it', async () => {
    const helper = new AssemblyAiHelper(() => 'lk');
    const dropped = vi.fn();
    helper.OnDropped = dropped;
    await startLive(helper);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    MockSocket.last!.serverClose(1011);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(dropped.mock.calls[0][0]).toBeInstanceOf(CaptionEngineError);
    expect(dropped.mock.calls[0][0].kind).toBe('network');
  });

  it('can start again after a drop', async () => {
    const helper = new AssemblyAiHelper(() => 'lk');
    await startLive(helper);
    MockSocket.last!.serverClose();
    await startLive(helper);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('Stop() does not count as a drop', async () => {
    const helper = new AssemblyAiHelper(() => 'lk');
    const dropped = vi.fn();
    helper.OnDropped = dropped;
    await startLive(helper);
    const socket = MockSocket.last!;
    helper.Stop();
    socket.serverClose(1000);
    expect(dropped).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('rejects with quota when the host has no caption time, without opening the mic', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 402, json: async () => ({}) });
    const helper = new AssemblyAiHelper(() => 'lk');
    await expect(helper.Start()).rejects.toMatchObject({ kind: 'quota' });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('rejects with mic-denied and closes the stream when the mic is blocked', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const helper = new AssemblyAiHelper(() => 'lk');
    const started = helper.Start();
    await flush();
    const socket = MockSocket.last!;
    socket.open();
    socket.ready();
    await expect(started).rejects.toMatchObject({ kind: 'mic-denied' });
    expect(socket.sent).toContain(JSON.stringify({ type: 'Terminate' }));
    socket.serverClose(1000);
  });

  it('rejects with network when the stream closes before ready', async () => {
    const helper = new AssemblyAiHelper(() => 'lk');
    const started = helper.Start();
    await flush();
    MockSocket.last!.serverClose(1013);
    await expect(started).rejects.toMatchObject({ kind: 'network' });
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
