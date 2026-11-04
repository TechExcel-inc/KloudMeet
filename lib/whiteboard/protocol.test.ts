import { describe, expect, it } from 'vitest';
import {
  boardLeader,
  boardText,
  canEditBoard,
  fitBounds,
  parseLive,
  parseReliable,
  parseSavedBoard,
  rememberElements,
  serializeBoard,
  takeChangedElements,
  type BoardElement,
  type BoardRoles,
} from './protocol';

const el = (id: string, version: number, extra: Partial<BoardElement> = {}): BoardElement => ({
  id,
  version,
  versionNonce: version * 7,
  isDeleted: false,
  type: 'rectangle',
  ...extra,
});

const roles: BoardRoles = {
  hostIdentity: 'host',
  cohostIdentities: ['co-b', 'co-a'],
  presenterIdentities: [],
};

describe('canEditBoard', () => {
  it('lets host, co-hosts and presenters draw', () => {
    const r = { ...roles, presenterIdentities: ['p'] };
    expect(['host', 'co-a', 'co-b', 'p'].map((id) => canEditBoard(id, r))).toEqual([true, true, true, true]);
    expect(canEditBoard('guest', r)).toBe(false);
  });

  it('never treats an empty host as a match', () => {
    expect(canEditBoard('', { ...roles, hostIdentity: '' })).toBe(false);
  });
});

describe('boardLeader', () => {
  it('prefers a presenter who is in the room', () => {
    expect(boardLeader(['host', 'p2', 'p1'], { ...roles, presenterIdentities: ['p2', 'p1'] })).toBe('p1');
  });

  it('falls back to the host, then the first co-host by identity', () => {
    expect(boardLeader(['host', 'co-a'], roles)).toBe('host');
    expect(boardLeader(['co-b', 'co-a', 'guest'], roles)).toBe('co-a');
  });

  it('is null when no one who can draw is here', () => {
    expect(boardLeader(['guest'], { ...roles, presenterIdentities: ['gone'] })).toBeNull();
  });
});

describe('takeChangedElements / rememberElements', () => {
  it('sends each version once and skips what came from others', () => {
    const known = new Map<string, number>();
    expect(takeChangedElements([el('a', 1), el('b', 1)], known).map((e) => e.id)).toEqual(['a', 'b']);
    expect(takeChangedElements([el('a', 1), el('b', 2)], known).map((e) => e.id)).toEqual(['b']);
    rememberElements([el('c', 5)], known);
    expect(takeChangedElements([el('c', 5)], known)).toEqual([]);
    expect(takeChangedElements([el('c', 6)], known).map((e) => e.version)).toEqual([6]);
  });
});

describe('fitBounds', () => {
  it('centres the leader view and keeps the aspect ratio', () => {
    // 1000×500 scene area into a 500×500 viewport: zoom 0.5, vertically centred
    const { zoom, scrollX, scrollY } = fitBounds([0, 0, 1000, 500], 500, 500);
    expect(zoom).toBe(0.5);
    // scene (0, 0) lands on the left edge; scene (0, 250) on the vertical centre
    expect((0 + scrollX) * zoom).toBeCloseTo(0);
    expect((250 + scrollY) * zoom).toBeCloseTo(250);
  });

  it('works for bounds away from the origin', () => {
    const { zoom, scrollX, scrollY } = fitBounds([100, 200, 300, 400], 400, 400);
    expect(zoom).toBe(2);
    expect((200 + scrollX) * zoom).toBeCloseTo(200);
    expect((300 + scrollY) * zoom).toBeCloseTo(200);
  });
});

describe('saved scene', () => {
  it('drops deleted elements and reads back', () => {
    const scene = serializeBoard([el('a', 1), el('b', 2, { isDeleted: true })]);
    expect(parseSavedBoard(scene).map((e) => e.id)).toEqual(['a']);
    expect(JSON.parse(scene).appState.viewBackgroundColor).toBe('#ffffff');
  });

  it('treats a missing or broken scene as empty', () => {
    expect(parseSavedBoard(null)).toEqual([]);
    expect(parseSavedBoard('{oops')).toEqual([]);
  });

  it('collects the text of live text elements', () => {
    const text = boardText([
      el('t1', 1, { type: 'text', text: ' Goals ' }),
      el('t2', 1, { type: 'text', text: 'old', isDeleted: true }),
      el('r', 1),
      el('t3', 1, { type: 'text', text: 'Risks' }),
    ]);
    expect(text).toBe('Goals\nRisks');
  });
});

describe('message parsing', () => {
  it('accepts well-formed messages', () => {
    expect(parseReliable(JSON.stringify({ t: 'req', board: 7, have: 3 }))).toEqual({ t: 'req', board: 7, have: 3 });
    expect(parseReliable(JSON.stringify({ t: 'el', board: 7, elements: [el('a', 1), { id: 1 }] }))).toEqual({
      t: 'el',
      board: 7,
      elements: [el('a', 1)],
    });
    expect(parseLive(JSON.stringify({ t: 'view', board: 7, bounds: [0, 0, 10, 10] }))).toEqual({
      t: 'view',
      board: 7,
      bounds: [0, 0, 10, 10],
    });
  });

  it('rejects junk', () => {
    expect(parseReliable('nope')).toBeNull();
    expect(parseReliable(JSON.stringify({ t: 'full', board: 7, elements: [] }))).toBeNull();
    expect(parseLive(JSON.stringify({ t: 'view', board: 7, bounds: [10, 0, 0, 10] }))).toBeNull();
    expect(parseLive(JSON.stringify({ t: 'ptr', board: '7', x: 1, y: 1 }))).toBeNull();
  });
});
