import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnnotationModel,
  StrokeBatcher,
  SyncAssembler,
  chunkSnapshot,
  parseAnnotationMsg,
  type AnnotationMsg,
} from './annotationModel';

type Seg = Extract<AnnotationMsg, { t: 'seg' }>;
const seg = (id: number, i: number, p: number[], extra: Partial<Seg> = {}): Seg => ({
  t: 'seg',
  id,
  c: '#ef4444',
  w: 3,
  i,
  p,
  ...extra,
});

describe('AnnotationModel', () => {
  it('keeps one path per sender when two people draw at the same time', () => {
    const m = new AnnotationModel();
    m.applySeg('alice', seg(1, 0, [0.1, 0.1], { s: 1 }));
    m.applySeg('bob', seg(1, 0, [0.9, 0.9], { s: 1 }));
    m.applySeg('alice', seg(1, 1, [0.2, 0.2]));
    m.applySeg('bob', seg(1, 1, [0.8, 0.8]));
    const [a, b] = m.list();
    expect(a.from).toBe('alice');
    expect(a.pts).toEqual([0.1, 0.1, 0.2, 0.2]);
    expect(b.from).toBe('bob');
    expect(b.pts).toEqual([0.9, 0.9, 0.8, 0.8]);
  });

  it('does not let one sender extend another sender’s stroke', () => {
    const m = new AnnotationModel();
    m.applySeg('alice', seg(7, 0, [0.1, 0.1]));
    m.applySeg('mallory', seg(7, 1, [0.5, 0.5]));
    expect(m.list().find((s) => s.from === 'alice')!.pts).toEqual([0.1, 0.1]);
  });

  it('places points by index, so repeated points are not drawn twice', () => {
    const m = new AnnotationModel();
    m.applySeg('a', seg(1, 0, [0.1, 0.1, 0.2, 0.2]));
    const change = m.applySeg('a', seg(1, 1, [0.2, 0.2, 0.3, 0.3]));
    expect(change).toMatchObject({ kind: 'append', fromPoint: 2 });
    expect(m.list()[0].pts).toEqual([0.1, 0.1, 0.2, 0.2, 0.3, 0.3]);
  });
});

describe('late joiner replay', () => {
  it('replays finished and in-progress strokes to someone who joins mid-share', () => {
    const presenter = new AnnotationModel();
    presenter.applySeg('alice', seg(1, 0, [0.1, 0.1, 0.2, 0.2], { s: 1, e: 1 }));
    presenter.applySeg('bob', seg(4, 0, [0.5, 0.5, 0.6, 0.6], { s: 1 }));

    // The newcomer already caught the tail of bob's stroke before the sync reply arrived.
    const late = new AnnotationModel();
    late.applySeg('bob', seg(4, 2, [0.7, 0.7]));
    presenter.applySeg('bob', seg(4, 2, [0.7, 0.7]));

    const assembler = new SyncAssembler();
    let strokes = null;
    for (const part of chunkSnapshot(presenter.snapshot())) {
      if (part.t !== 'sync') throw new Error('expected sync');
      strokes = assembler.add(part) ?? strokes;
    }
    expect(strokes).not.toBeNull();
    late.mergeSync(strokes!);

    const byFrom = Object.fromEntries(late.list().map((s) => [s.from, s]));
    expect(byFrom.alice.pts).toEqual([0.1, 0.1, 0.2, 0.2]);
    expect(byFrom.alice.done).toBe(true);
    expect(byFrom.bob.pts).toEqual([0.5, 0.5, 0.6, 0.6, 0.7, 0.7]);
    expect(byFrom.bob.base).toBe(0);
    // Order matches the presenter's (alice first).
    expect(late.list().map((s) => s.from)).toEqual(['alice', 'bob']);

    // Later points continue the merged stroke without gaps or repeats.
    late.applySeg('bob', seg(4, 3, [0.8, 0.8], { e: 1 }));
    expect(byFrom.bob.pts.length).toBe(8);
  });

  it('splits a long stroke across several sync messages and reassembles it', () => {
    const presenter = new AnnotationModel();
    const pts: number[] = [];
    for (let i = 0; i < 3000; i++) pts.push(i / 3000, 1 - i / 3000);
    presenter.applySeg('alice', seg(9, 0, pts.slice(0, 2000)));
    presenter.applySeg('alice', seg(9, 1000, pts.slice(2000, 4000)));
    presenter.applySeg('alice', seg(9, 2000, pts.slice(4000), { e: 1 }));

    const parts = chunkSnapshot(presenter.snapshot(), 4000);
    expect(parts.length).toBeGreaterThan(3);
    for (const p of parts) expect(JSON.stringify(p).length).toBeLessThan(4500);

    const assembler = new SyncAssembler();
    let out = null;
    // Parts may arrive in any order.
    for (const p of [...parts].reverse()) out = assembler.add(p as Extract<AnnotationMsg, { t: 'sync' }>) ?? out;
    expect(out).toHaveLength(1);
    expect(out![0].p).toEqual(pts);
    expect(out![0].d).toBe(1);
  });

  it('answers an empty board with a single empty sync', () => {
    const parts = chunkSnapshot(new AnnotationModel().snapshot());
    expect(parts).toEqual([{ t: 'sync', strokes: [], part: 0, parts: 1 }]);
  });

  it('clear wipes everything', () => {
    const m = new AnnotationModel();
    m.applySeg('a', seg(1, 0, [0.1, 0.1]));
    expect(m.clear()).toEqual({ kind: 'reset' });
    expect(m.size).toBe(0);
  });
});

describe('StrokeBatcher', () => {
  it('sends the first point at once, then batches moves, then marks the end', () => {
    const sent: Seg[] = [];
    const timers: (() => void)[] = [];
    const b = new StrokeBatcher(
      3,
      '#3b82f6',
      6,
      (s) => sent.push(s),
      40,
      0.001,
      (fn) => {
        timers.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      () => {},
    );
    b.add(0.1, 0.1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ s: 1, i: 0, p: [0.1, 0.1] });

    for (let k = 1; k <= 10; k++) b.add(0.1 + k * 0.01, 0.1);
    expect(sent).toHaveLength(1); // ten moves, no message yet
    expect(timers).toHaveLength(1); // one pending batch
    timers.shift()!();
    expect(sent).toHaveLength(2);
    expect(sent[1].i).toBe(1);
    expect(sent[1].p).toHaveLength(20);

    b.add(0.5, 0.5);
    b.end();
    expect(sent[2]).toMatchObject({ i: 11, e: 1, p: [0.5, 0.5] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('schedules with the real timer without binding it to the batcher (browsers throw "Illegal invocation")', () => {
    vi.useFakeTimers();
    const receivers: unknown[] = [];
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(function (this: unknown, ...args: Parameters<typeof setTimeout>) {
      receivers.push(this);
      return real(...args);
    } as typeof setTimeout);
    const sent: Seg[] = [];
    const b = new StrokeBatcher(2, '#ef4444', 3, (s) => sent.push(s));
    b.add(0.1, 0.1);
    b.add(0.2, 0.2);
    b.add(0.3, 0.3);
    expect(receivers.length).toBe(1);
    expect(receivers[0]).not.toBe(b);
    vi.advanceTimersByTime(40);
    expect(sent.map((s) => s.p)).toEqual([[0.1, 0.1], [0.2, 0.2, 0.3, 0.3]]);
  });

  it('never builds a batch the receivers would reject, even if the timer is late', () => {
    const sent: Seg[] = [];
    const b = new StrokeBatcher(5, '#fff', 3, (s) => sent.push(s), 40, 0, () => 0 as unknown as ReturnType<typeof setTimeout>, () => {});
    for (let k = 0; k < 3000; k++) b.add((k % 1000) / 1000, Math.floor(k / 1000) / 10);
    b.end();
    for (const s of sent) expect(parseAnnotationMsg(s)).not.toBeNull();
    expect(sent.reduce((n, s) => n + s.p.length / 2, 0)).toBe(3000);
  });

  it('drops points that barely moved', () => {
    const sent: Seg[] = [];
    const b = new StrokeBatcher(1, '#fff', 3, (s) => sent.push(s), 40, 0.01);
    b.add(0.5, 0.5);
    expect(b.add(0.501, 0.5)).toBeNull();
    b.end();
    expect(sent.flatMap((s) => s.p)).toEqual([0.5, 0.5]);
  });
});

describe('parseAnnotationMsg', () => {
  it('accepts valid messages', () => {
    expect(parseAnnotationMsg({ t: 'seg', id: 1, c: '#ef4444', w: 3, i: 0, p: [0.1, 0.2], s: 1 })).toMatchObject({ t: 'seg', s: 1 });
    expect(parseAnnotationMsg({ t: 'clear' })).toEqual({ t: 'clear' });
  });

  it('rejects out-of-range or malformed input', () => {
    expect(parseAnnotationMsg({ t: 'seg', id: 1, c: '#ef4444', w: 3, i: 0, p: [1.5, 0.2] })).toBeNull();
    expect(parseAnnotationMsg({ t: 'seg', id: 1, c: 'red;background:url(x)', w: 3, i: 0, p: [] })).toBeNull();
    expect(parseAnnotationMsg({ t: 'seg', id: 1, c: '#fff', w: 999, i: 0, p: [] })).toBeNull();
    expect(parseAnnotationMsg({ t: 'seg', id: 1, c: '#fff', w: 3, i: 0, p: [0.1] })).toBeNull();
    expect(parseAnnotationMsg('nope')).toBeNull();
    // the old one-point format on the old topic is not this protocol
    expect(parseAnnotationMsg({ type: 'draw', x: 0.1, y: 0.1, color: '#fff' })).toBeNull();
  });
});
