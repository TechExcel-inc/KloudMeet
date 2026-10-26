import { describe, expect, it } from 'vitest';
import {
  MAX_REPLAY_NUMBERS,
  assembleReplay,
  buildReplayMessages,
  chunkStrokePoints,
  helloAnswerDelay,
  mergeReplay,
  designPageKey,
  isSameSiteHref,
  parseDesignPageMessage,
  parseDesignSyncMessage,
  toDocPoint,
  type DesignStroke,
} from './designSync';

describe('parseDesignPageMessage', () => {
  const hello = {
    source: 'kloud-design',
    v: 1,
    type: 'hello',
    href: 'https://design.kloud.cn/d/x/',
    title: 'Home',
    scrollX: 0,
    scrollY: 40,
    docWidth: 1200,
    docHeight: 3000,
    viewWidth: 1200,
    viewHeight: 700,
  };
  it('reads hello, size and scroll from the sync script', () => {
    expect(parseDesignPageMessage(hello)).toMatchObject({ type: 'hello', scrollY: 40, docHeight: 3000 });
    expect(parseDesignPageMessage({ ...hello, type: 'size' })?.type).toBe('size');
    expect(parseDesignPageMessage({ source: 'kloud-design', type: 'scroll', href: hello.href, scrollX: 0, scrollY: 9 })).toEqual({
      type: 'scroll',
      href: hello.href,
      scrollX: 0,
      scrollY: 9,
    });
  });
  it('ignores anything else', () => {
    expect(parseDesignPageMessage({ ...hello, source: 'other' })).toBeNull();
    expect(parseDesignPageMessage({ ...hello, scrollY: 'x' })).toBeNull();
    expect(parseDesignPageMessage({ ...hello, type: 'eval' })).toBeNull();
    expect(parseDesignPageMessage('hello')).toBeNull();
  });
});

describe('pages', () => {
  it('keeps pages on the link’s site and ignores the hash', () => {
    expect(isSameSiteHref('https://design.kloud.cn/d/x/b.html', 'https://design.kloud.cn/d/x/')).toBe(true);
    expect(isSameSiteHref('https://evil.example/d/x/', 'https://design.kloud.cn/d/x/')).toBe(false);
    expect(designPageKey('https://design.kloud.cn/d/x/b.html?v=2#top')).toBe('https://design.kloud.cn/d/x/b.html?v=2');
  });
});

describe('parseDesignSyncMessage', () => {
  it('accepts well-formed messages', () => {
    expect(parseDesignSyncMessage({ type: 'viewport', viewport: { zoom: 1.2, baseWidth: 1200, baseHeight: 700 } })).toEqual({
      type: 'viewport',
      viewport: { zoom: 1.2, baseWidth: 1200, baseHeight: 700 },
    });
    expect(parseDesignSyncMessage({ type: 'scroll', scroll: { href: 'https://a.io/', x: -3, y: 50 } })).toEqual({
      type: 'scroll',
      scroll: { href: 'https://a.io/', x: 0, y: 50 },
    });
    expect(parseDesignSyncMessage({ type: 'stroke', id: 'a1', page: 'p', color: '#ff3b30', points: [1, 2, 3, 4], start: true })).toEqual({
      type: 'stroke',
      id: 'a1',
      page: 'p',
      color: '#ff3b30',
      points: [1, 2, 3, 4],
      start: true,
    });
    expect(parseDesignSyncMessage({ type: 'laser', page: 'p', x: 1, y: 2, name: 'ying' })).toMatchObject({ type: 'laser', x: 1 });
    expect(parseDesignSyncMessage({ type: 'clear', page: 'p' })).toEqual({ type: 'clear', page: 'p' });
  });
  it('rejects bad colours, odd point lists and unknown types', () => {
    expect(parseDesignSyncMessage({ type: 'stroke', id: 'a', page: 'p', color: 'url(x)', points: [1, 2] })).toBeNull();
    expect(parseDesignSyncMessage({ type: 'stroke', id: 'a', page: 'p', color: '#ff3b30', points: [1, 2, 3] })).toBeNull();
    expect(parseDesignSyncMessage({ type: 'stroke', id: 'a', page: 'p', color: '#ff3b30', points: [1, 'x'] })).toBeNull();
    expect(parseDesignSyncMessage({ type: 'scroll', scroll: { href: 5, x: 0, y: 0 } })).toBeNull();
    expect(parseDesignSyncMessage({ type: 'nope' })).toBeNull();
  });
});

describe('geometry', () => {
  it('maps a point on screen to the page document', () => {
    expect(toDocPoint({ x: 100, y: 50 }, { x: 0, y: 1200 }, 0.5)).toEqual({ x: 200, y: 1300 });
  });
  it('chunks long strokes', () => {
    const points = Array.from({ length: 1000 }, (_, i) => i);
    const chunks = chunkStrokePoints(points);
    expect(chunks.map((c) => c.length)).toEqual([800, 200]);
    expect(chunks.flat()).toEqual(points);
  });
});

describe('stroke replay for late joiners', () => {
  const stroke = (id: string, n: number, page = 'https://design.kloud.cn/d/x/', by = 'host'): DesignStroke => ({
    id: `${by}:${id}`,
    page,
    by,
    color: '#ff3b30',
    points: Array.from({ length: n * 2 }, (_, i) => i),
  });
  /** What the late joiner ends up with: over the wire (JSON + parse), then put back together */
  const roundTrip = (messages: ReturnType<typeof buildReplayMessages>) =>
    assembleReplay(
      messages.map((m) => {
        const parsed = parseDesignSyncMessage(JSON.parse(JSON.stringify(m)));
        if (parsed?.type !== 'replay') throw new Error('replay did not parse');
        return parsed.strokes;
      }),
    );

  it('answers with one empty, last message when nothing is drawn', () => {
    expect(buildReplayMessages([], 'r1')).toEqual([{ type: 'replay', req: 'r1', part: 0, last: true, strokes: [] }]);
  });

  it('sends small drawings in one message and rebuilds them exactly', () => {
    const strokes = [stroke('a', 10), stroke('b', 20, 'https://design.kloud.cn/d/x/about')];
    const messages = buildReplayMessages(strokes, 'r1');
    expect(messages).toHaveLength(1);
    expect(messages[0].last).toBe(true);
    expect(roundTrip(messages)).toEqual(strokes);
  });

  it('splits large drawings into numbered parts that each parse, and rebuilds long strokes', () => {
    const strokes = [stroke('long', 2500), stroke('b', 300), stroke('c', 5)];
    const messages = buildReplayMessages(strokes, '*');
    expect(messages.length).toBeGreaterThan(5);
    messages.forEach((m, i) => {
      expect(m.part).toBe(i);
      expect(m.last).toBe(i === messages.length - 1);
      expect(JSON.stringify(m).length).toBeLessThan(15_000);
      expect(m.strokes.reduce((n, s) => n + s.points.length, 0)).toBeLessThanOrEqual(800);
    });
    expect(messages[1].strokes[0].cont).toBe(true);
    expect(roundTrip(messages)).toEqual(strokes);
  });

  it('keeps message size bounded when page keys are long', () => {
    const page = `https://design.kloud.cn/${'p'.repeat(1900)}`;
    const strokes = Array.from({ length: 40 }, (_, i) => stroke(`s${i}`, 3, page));
    const messages = buildReplayMessages(strokes, 'r');
    messages.forEach((m) => expect(JSON.stringify(m).length).toBeLessThan(15_000));
    expect(roundTrip(messages)).toEqual(strokes);
  });

  it('leaves out the oldest strokes beyond the replay budget', () => {
    const per = MAX_REPLAY_NUMBERS / 2 / 4; // points per stroke so that 4 strokes fill the budget
    const strokes = [stroke('old', per), stroke('a', per), stroke('b', per), stroke('c', per), stroke('new', per)];
    const ids = roundTrip(buildReplayMessages(strokes, 'r')).map((s) => s.id);
    expect(ids).toEqual(['host:a', 'host:b', 'host:c', 'host:new']);
  });

  it('skips the rest of a stroke whose first piece is missing', () => {
    const piece = { id: 'h:x', by: 'h', page: 'p', color: '#ff3b30', points: [1, 2], cont: true };
    expect(assembleReplay([[piece]])).toEqual([]);
  });

  it('rejects malformed hello and replay messages', () => {
    expect(parseDesignSyncMessage({ type: 'hello', req: 'abc' })).toEqual({ type: 'hello', req: 'abc' });
    expect(parseDesignSyncMessage({ type: 'hello', req: 'abc', driver: true, again: true })).toEqual({
      type: 'hello',
      req: 'abc',
      driver: true,
      again: true,
    });
    expect(parseDesignSyncMessage({ type: 'hello', req: 'abc', driver: 'yes', again: 1 })).toEqual({ type: 'hello', req: 'abc' });
    expect(parseDesignSyncMessage({ type: 'hello' })).toBeNull();
    expect(parseDesignSyncMessage({ type: 'hello', req: 'x'.repeat(41) })).toBeNull();
    const good = { type: 'replay', req: 'r', part: 0, last: true, strokes: [{ id: 'h:1', by: 'h', page: 'p', color: '#ff3b30', points: [1, 2] }] };
    expect(parseDesignSyncMessage(good)?.type).toBe('replay');
    expect(parseDesignSyncMessage({ ...good, part: -1 })).toBeNull();
    expect(parseDesignSyncMessage({ ...good, part: 1.5 })).toBeNull();
    expect(parseDesignSyncMessage({ ...good, strokes: [{ ...good.strokes[0], color: 'red' }] })).toBeNull();
    expect(parseDesignSyncMessage({ ...good, strokes: [{ ...good.strokes[0], points: [1] }] })).toBeNull();
    expect(parseDesignSyncMessage({ ...good, strokes: [{ ...good.strokes[0], points: [1, NaN] }] })).toBeNull();
    const tooMany = Array.from({ length: 3 }, (_, i) => ({ ...good.strokes[0], id: `h:${i}`, points: Array(400).fill(1) }));
    expect(parseDesignSyncMessage({ ...good, strokes: tooMany })).toBeNull();
  });

  it('merges a replay: the replay wins for older strokes, newer ones stay, longer copies win', () => {
    const cleared = stroke('cleared', 3); // removed while this participant was away
    const partial = stroke('live', 2); // part of a stroke still being drawn, seen live
    const fresh = stroke('fresh', 4); // started after asking
    const replay = [stroke('a', 3), stroke('live', 5)];
    const seenAfterAsking = new Set([fresh.id, partial.id]);
    const merged = mergeReplay([cleared, partial, fresh], replay, (s) => seenAfterAsking.has(s.id));
    expect(merged.map((s) => s.id)).toEqual(['host:a', 'host:live', 'host:fresh']);
    expect(merged[1].points).toHaveLength(10);

    const longerLive = stroke('live', 8);
    expect(mergeReplay([longerLive], replay, () => true)[1].points).toHaveLength(16);
  });
});

describe('who answers a hello', () => {
  const driver = { canDraw: true, isDriver: true, hasStrokes: false };
  const cohost = { canDraw: true, isDriver: false, hasStrokes: true };
  const attendee = { canDraw: false, isDriver: false, hasStrokes: true };

  it('the driver answers first, even with nothing drawn ("nothing drawn" ends the asking)', () => {
    expect(helloAnswerDelay({}, driver)).toBe(250);
  });

  it('others who can draw answer only when the driver asks or the driver stayed quiet, and later', () => {
    expect(helloAnswerDelay({}, cohost)).toBeNull();
    expect(helloAnswerDelay({ driver: true }, cohost)).toBe(700);
    expect(helloAnswerDelay({ again: true }, cohost)).toBe(700);
    expect(helloAnswerDelay({ again: true }, { ...cohost, hasStrokes: false })).toBeNull();
  });

  it('attendees never answer (their drawings would not be accepted)', () => {
    expect(helloAnswerDelay({ driver: true, again: true }, attendee)).toBeNull();
  });
});
