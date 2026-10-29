import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KloudBackgroundProcessor } from './videoBackground';

type Look = { kind: 'blur'; radius: number } | { kind: 'image'; url: string };
const label = (look: Look) => (look.kind === 'blur' ? `blur:${look.radius}` : `image:${look.url}`);

/** Stands in for the cut-out pipeline: init resolves when the test says so. */
class FakeInner {
  static made: FakeInner[] = [];
  static failNext = false;
  processedTrack = { id: `processed-${FakeInner.made.length}` } as unknown as MediaStreamTrack;
  modes: string[] = [];
  destroyed = false;
  private release!: () => void;
  private fail!: (e: Error) => void;
  ready = new Promise<void>((resolve, reject) => {
    this.release = resolve;
    this.fail = reject;
  });
  constructor(look: Look) {
    FakeInner.made.push(this);
    this.modes.push(label(look));
    if (FakeInner.failNext) {
      FakeInner.failNext = false;
      queueMicrotask(() => this.fail(new Error('model fetch failed')));
    }
  }
  init() {
    return this.ready;
  }
  finishInit() {
    this.release();
  }
  async switchTo(look: Look) {
    this.modes.push(label(look));
  }
  async destroy() {
    this.destroyed = true;
  }
}

vi.mock('./backgroundCutout', () => ({
  createBackgroundPipeline: (look: Look) => new FakeInner(look),
}));
vi.mock('@livekit/track-processors', () => ({ supportsBackgroundProcessors: () => true }));
vi.mock('./useToolbarIsMobile', () => ({ isToolbarMobileUserAgent: () => false }));
vi.mock('./customBackgrounds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./customBackgrounds')>()),
  customBackgroundUrl: async (id: string) => (id === 'custom:kept-image' ? 'blob:kept' : undefined),
}));

const live = () => ({ kind: 'video', track: { readyState: 'live' } }) as never;
const ended = () => ({ kind: 'video', track: { readyState: 'ended' } }) as never;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('KloudBackgroundProcessor', () => {
  beforeEach(() => {
    FakeInner.made = [];
    FakeInner.failNext = false;
  });

  it('starts with the chosen background and reports running', async () => {
    const statuses: string[] = [];
    const p = new KloudBackgroundProcessor('blur', (s) => statuses.push(s));
    const init = p.init(live());
    await tick();
    FakeInner.made[0].finishInit();
    await init;
    expect(FakeInner.made[0].modes).toEqual(['blur:14']);
    expect(p.processedTrack).toBe(FakeInner.made[0].processedTrack);
    expect(statuses).toEqual(['starting', 'running']);
  });

  it('never throws when the pipeline fails: the camera goes out without it', async () => {
    const statuses: string[] = [];
    const p = new KloudBackgroundProcessor('forest', (s) => statuses.push(s));
    FakeInner.failNext = true;
    await expect(p.init(live())).resolves.toBeUndefined();
    expect(p.processedTrack).toBeUndefined();
    expect(FakeInner.made[0].destroyed).toBe(true);
    expect(statuses).toEqual(['starting', 'failed']);
  });

  it('waits while the camera is off and starts on restart', async () => {
    const p = new KloudBackgroundProcessor('shelf');
    await p.init(ended());
    expect(FakeInner.made).toHaveLength(0);
    expect(p.processedTrack).toBeUndefined();
    const restart = p.restart(live());
    await tick();
    FakeInner.made[0].finishInit();
    await restart;
    expect(FakeInner.made[0].modes).toEqual(['image:/backgrounds/shelf.jpg']);
    expect(p.currentStatus).toBe('running');
  });

  it('applies a pick made while it was still starting', async () => {
    const p = new KloudBackgroundProcessor('blur');
    const init = p.init(live());
    await tick();
    await p.setBackground('indigo');
    FakeInner.made[0].finishInit();
    await init;
    expect(FakeInner.made[0].modes).toEqual(['blur:14', 'image:/backgrounds/indigo.jpg']);
  });

  it('switches without rebuilding once running', async () => {
    const p = new KloudBackgroundProcessor('blur-light');
    const init = p.init(live());
    await tick();
    FakeInner.made[0].finishInit();
    await init;
    await p.setBackground('mist');
    expect(FakeInner.made).toHaveLength(1);
    expect(FakeInner.made[0].modes).toEqual(['blur:5', 'image:/backgrounds/mist.jpg']);
  });

  it('cleans up a slow start that was destroyed meanwhile', async () => {
    const statuses: string[] = [];
    const p = new KloudBackgroundProcessor('blur', (s) => statuses.push(s));
    const init = p.init(live());
    await tick();
    await p.destroy();
    FakeInner.made[0].finishInit();
    await init;
    expect(FakeInner.made[0].destroyed).toBe(true);
    expect(p.processedTrack).toBeUndefined();
    expect(statuses[statuses.length - 1]).toBe('idle');
  });

  it('uses an image the person added', async () => {
    const p = new KloudBackgroundProcessor('custom:kept-image');
    const init = p.init(live());
    await tick();
    FakeInner.made[0].finishInit();
    await init;
    expect(FakeInner.made[0].modes).toEqual(['image:blob:kept']);
  });

  it('falls back to blur when an added image is gone, and saves that', async () => {
    const saved: string[] = [];
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (_key: string, value: string) => saved.push(value) });
    vi.stubGlobal('window', new EventTarget());
    try {
      const p = new KloudBackgroundProcessor('custom:gone-image');
      const init = p.init(live());
      await tick();
      FakeInner.made[0].finishInit();
      await init;
      expect(FakeInner.made[0].modes).toEqual(['blur:14']);
      expect(p.currentBackground).toBe('blur');
      expect(saved).toEqual(['blur']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('builds a fresh pipeline for each track it is put on', async () => {
    const p = new KloudBackgroundProcessor('blur');
    const first = p.init(live());
    await tick();
    FakeInner.made[0].finishInit();
    await first;
    await p.destroy();
    const second = p.init(live());
    await tick();
    FakeInner.made[1].finishInit();
    await second;
    expect(FakeInner.made[0].destroyed).toBe(true);
    expect(p.processedTrack).toBe(FakeInner.made[1].processedTrack);
  });
});
