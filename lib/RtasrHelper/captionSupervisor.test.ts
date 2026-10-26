import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptionSupervisor, type CaptionStatus } from './captionSupervisor';
import { CaptionEngineError, httpFailure, isRetryable, micFailure } from './captionErrors';
import { parsePeerCaptionState, peerStateOf } from './captionPeers';
import type { CaptionEngine } from './RtasrHelper';

/** Engine whose Start() outcome each test scripts. */
class FakeEngine implements CaptionEngine {
  languageCode = 'en';
  OnDropped?: (err: CaptionEngineError) => void;
  starts = 0;
  stops = 0;
  private pending: { resolve: () => void; reject: (e: unknown) => void } | null = null;

  Start() {
    this.starts += 1;
    return new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }
  Stop() {
    this.stops += 1;
  }
  async succeed() {
    this.pending?.resolve();
    this.pending = null;
    await flush();
  }
  async fail(err: unknown = new CaptionEngineError('network', 'relay down')) {
    this.pending?.reject(err);
    this.pending = null;
    await flush();
  }
  async drop() {
    this.OnDropped?.(new CaptionEngineError('network', 'relay closed'));
    await flush();
  }
}

async function flush() {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

function setup(options = {}) {
  const engine = new FakeEngine();
  const statuses: CaptionStatus[] = [];
  const sup = new CaptionSupervisor(engine, (s) => statuses.push(s), { delays: [1000, 2000, 4000], stableMs: 30000, ...options });
  return { engine, statuses, sup, last: () => statuses[statuses.length - 1] };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CaptionSupervisor', () => {
  it('goes connecting → live', async () => {
    const { engine, sup, statuses } = setup();
    sup.start();
    expect(sup.status.state).toBe('connecting');
    await engine.succeed();
    expect(statuses.map((s) => s.state)).toEqual(['connecting', 'live']);
  });

  it('reconnects with backoff after a drop mid-meeting and releases the engine first', async () => {
    const { engine, sup, last } = setup();
    sup.start();
    await engine.succeed();
    const stopsBefore = engine.stops;
    await engine.drop();
    expect(engine.stops).toBe(stopsBefore + 1);
    expect(last()).toEqual({ state: 'reconnecting', failure: 'network', attempt: 1 });
    expect(engine.starts).toBe(1);
    vi.advanceTimersByTime(999);
    expect(engine.starts).toBe(1);
    vi.advanceTimersByTime(1);
    expect(engine.starts).toBe(2);
    await engine.succeed();
    expect(last().state).toBe('live');
  });

  it('gives up after the last delay and stops retrying', async () => {
    const { engine, sup, last } = setup();
    sup.start();
    await engine.fail();
    for (const delay of [1000, 2000, 4000]) {
      vi.advanceTimersByTime(delay);
      await engine.fail();
    }
    expect(engine.starts).toBe(4);
    expect(last()).toEqual({ state: 'failed', failure: 'network', attempt: 3 });
    vi.advanceTimersByTime(60000);
    expect(engine.starts).toBe(4);
  });

  it('fails at once when retrying cannot help', async () => {
    const { engine, sup, last } = setup();
    sup.start();
    await engine.fail(new CaptionEngineError('mic-denied', 'NotAllowedError'));
    expect(last()).toEqual({ state: 'failed', failure: 'mic-denied', attempt: 0 });
    vi.advanceTimersByTime(60000);
    expect(engine.starts).toBe(1);
  });

  it('Retry starts over with a fresh set of attempts', async () => {
    const { engine, sup, last } = setup({ delays: [1000] });
    sup.start();
    await engine.fail();
    vi.advanceTimersByTime(1000);
    await engine.fail();
    expect(last().state).toBe('failed');
    sup.retry();
    expect(last()).toEqual({ state: 'connecting', attempt: 0 });
    await engine.fail();
    expect(last()).toEqual({ state: 'reconnecting', failure: 'network', attempt: 1 });
  });

  it('stop() cancels a pending retry and ignores a late Start result', async () => {
    const { engine, sup, last } = setup();
    sup.start();
    await engine.fail();
    sup.stop();
    expect(last()).toEqual({ state: 'idle', attempt: 0 });
    vi.advanceTimersByTime(60000);
    expect(engine.starts).toBe(1);

    sup.start();
    sup.stop();
    await engine.succeed();
    expect(last().state).toBe('idle');
  });

  it('a drop reported after stop() is ignored', async () => {
    const { engine, sup, last } = setup();
    sup.start();
    await engine.succeed();
    sup.stop();
    await engine.drop();
    expect(last().state).toBe('idle');
  });

  it('nudge() (network back) skips the rest of the wait', async () => {
    const { engine, sup } = setup();
    sup.start();
    await engine.fail();
    expect(engine.starts).toBe(1);
    sup.nudge();
    expect(engine.starts).toBe(2);
  });

  it('nudge() after giving up on the network tries again; other failures wait for Retry', async () => {
    const { engine, sup, last } = setup({ delays: [] });
    sup.start();
    await engine.fail();
    expect(last()).toEqual({ state: 'failed', failure: 'network', attempt: 0 });
    sup.nudge();
    expect(engine.starts).toBe(2);
    expect(last().state).toBe('connecting');

    await engine.fail(new CaptionEngineError('mic-denied', 'NotAllowedError'));
    expect(last().state).toBe('failed');
    sup.nudge();
    expect(engine.starts).toBe(2);
  });

  it('nudge() does nothing once stopped', async () => {
    const { engine, sup } = setup({ delays: [] });
    sup.start();
    await engine.fail();
    sup.stop();
    sup.nudge();
    expect(engine.starts).toBe(1);
  });

  it('a connection that stays up earns fresh retries; a flapping one does not', async () => {
    const { engine, sup, last } = setup();
    sup.start();
    await engine.succeed();
    await engine.drop();
    vi.advanceTimersByTime(1000);
    await engine.succeed();
    await engine.drop(); // dropped again quickly: keeps counting
    expect(last().attempt).toBe(2);
    vi.advanceTimersByTime(2000);
    await engine.succeed();
    vi.advanceTimersByTime(30000);
    await engine.drop(); // stayed up 30 s: counts from 1 again
    expect(last().attempt).toBe(1);
  });

  it('start() while already running is a no-op', async () => {
    const { engine, sup } = setup();
    sup.start();
    sup.start();
    expect(engine.starts).toBe(1);
  });
});

describe('caption failure kinds', () => {
  it('maps token endpoint statuses', () => {
    expect(httpFailure(402)).toBe('quota');
    expect(httpFailure(401)).toBe('auth');
    expect(httpFailure(503)).toBe('network');
    expect(httpFailure(429)).toBe('network');
    expect(httpFailure(404)).toBe('unavailable');
  });

  it('maps getUserMedia errors', () => {
    expect(micFailure({ name: 'NotAllowedError' })).toBe('mic-denied');
    expect(micFailure({ name: 'NotFoundError' })).toBe('mic-missing');
    expect(micFailure({ name: 'OverconstrainedError' })).toBe('mic-missing');
    expect(micFailure({ name: 'NotReadableError' })).toBe('mic-busy');
  });

  it('retries only what can recover by itself', () => {
    expect(isRetryable('network')).toBe(true);
    expect(isRetryable('auth')).toBe(true);
    expect(isRetryable('mic-busy')).toBe(true);
    expect(isRetryable('mic-denied')).toBe(false);
    expect(isRetryable('quota')).toBe(false);
    expect(isRetryable('unavailable')).toBe(false);
  });
});

describe('peer caption state', () => {
  it('announces idle and live as ok', () => {
    expect(peerStateOf({ state: 'idle', attempt: 0 })).toBe('ok');
    expect(peerStateOf({ state: 'live', attempt: 0 })).toBe('ok');
    expect(peerStateOf({ state: 'reconnecting', attempt: 1 })).toBe('reconnecting');
    expect(peerStateOf({ state: 'failed', attempt: 5 })).toBe('failed');
  });

  it('parses only known states', () => {
    expect(parsePeerCaptionState('{"state":"failed"}')).toBe('failed');
    expect(parsePeerCaptionState('{"state":"weird"}')).toBeNull();
    expect(parsePeerCaptionState('not json')).toBeNull();
  });
});
