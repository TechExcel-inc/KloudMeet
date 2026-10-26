import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RtasrHelper } from './RtasrHelper';
import { CaptionEngineError } from './captionErrors';

/** OpenAI realtime socket stand-in: tests open and close it by hand. */
class MockSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static last: MockSocket | null = null;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string, public protocols?: string[]) {
    MockSocket.last = this;
  }
  send() {}
  close() {
    this.readyState = MockSocket.CLOSED;
  }
  open() {
    this.readyState = MockSocket.OPEN;
    this.onopen?.();
  }
  serverClose(code = 1006) {
    this.readyState = MockSocket.CLOSED;
    this.onclose?.({ code });
  }
}

class MockAudioContext {
  sampleRate = 24000;
  destination = {};
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
  createScriptProcessor() {
    return { connect() {}, disconnect() {}, onaudioprocess: null };
  }
  close() {
    return Promise.resolve();
  }
}

const track = { stop: vi.fn() };
const getUserMedia = vi.fn();
const fetchMock = vi.fn();

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

async function startLive(helper: RtasrHelper) {
  const started = helper.Start();
  await flush();
  MockSocket.last!.open();
  await started;
}

beforeEach(() => {
  MockSocket.last = null;
  track.stop.mockClear();
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [track] });
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ token: 'ek' }) });
  vi.stubGlobal('WebSocket', MockSocket);
  vi.stubGlobal('AudioContext', MockAudioContext);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RtasrHelper', () => {
  it('a drop after open releases the mic and reports it', async () => {
    const helper = new RtasrHelper(() => 'lk');
    const dropped = vi.fn();
    helper.OnDropped = dropped;
    await startLive(helper);

    MockSocket.last!.serverClose(1006);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(dropped.mock.calls[0][0]).toBeInstanceOf(CaptionEngineError);
    expect(dropped.mock.calls[0][0].kind).toBe('network');
  });

  it('Stop() does not count as a drop', async () => {
    const helper = new RtasrHelper(() => 'lk');
    const dropped = vi.fn();
    helper.OnDropped = dropped;
    await startLive(helper);
    const socket = MockSocket.last!;
    helper.Stop();
    socket.serverClose(1000);
    expect(dropped).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('rejects with network and releases the mic when the socket closes before open', async () => {
    const helper = new RtasrHelper(() => 'lk');
    const started = helper.Start();
    await flush();
    MockSocket.last!.serverClose(1006);
    await expect(started).rejects.toMatchObject({ kind: 'network' });
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('rejects with quota without opening the mic', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 402, json: async () => ({}) });
    const helper = new RtasrHelper(() => 'lk');
    await expect(helper.Start()).rejects.toMatchObject({ kind: 'quota' });
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
