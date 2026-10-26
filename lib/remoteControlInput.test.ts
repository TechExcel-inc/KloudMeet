import { afterEach, describe, expect, it, vi } from 'vitest';
import { Key } from '@nut-tree-fork/shared';
import { WheelAccumulator, decideKey, wheelPixels, type KeyLike } from './remoteControlInput';
import {
  acceptRemoteInput,
  createRateLimiter,
  isAllowedKey,
  limiterFor,
  sanitizeText,
  toNutKeys,
  toScreenPoint,
  wheelSteps,
} from '@/remote-input';
import { sanitizeControlMessage } from './RemoteControlOverlay';

const ev = (key: string, opts: Partial<KeyLike> = {}): KeyLike => ({
  key,
  code: opts.code ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key),
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...opts,
});

describe('decideKey (controller)', () => {
  it('sends plain typing as text so layouts and input methods work', () => {
    expect(decideKey(ev('a'), true)).toEqual({ kind: 'text' });
    expect(decideKey(ev('A', { shiftKey: true }), true)).toEqual({ kind: 'text' });
    expect(decideKey(ev('é', { altKey: true, code: 'KeyE' }), true)).toEqual({ kind: 'text' });
    // AltGr+Q on a German Windows keyboard reports Ctrl+Alt and types "@"
    expect(decideKey(ev('@', { ctrlKey: true, altKey: true, code: 'KeyQ' }), false)).toEqual({ kind: 'text' });
  });

  it('sends editing keys and common shortcuts, mapping Cmd/Ctrl to "primary"', () => {
    expect(decideKey(ev('Enter'), true)).toEqual({ kind: 'send', combo: { key: 'Enter', mods: [] } });
    expect(decideKey(ev('c', { metaKey: true }), true)).toEqual({ kind: 'send', combo: { key: 'c', mods: ['primary'] } });
    expect(decideKey(ev('c', { ctrlKey: true }), false)).toEqual({ kind: 'send', combo: { key: 'c', mods: ['primary'] } });
    expect(decideKey(ev('Z', { metaKey: true, shiftKey: true }), true)).toEqual({
      kind: 'send',
      combo: { key: 'z', mods: ['primary', 'shift'] },
    });
    expect(decideKey(ev('ArrowLeft', { altKey: true }), true)).toEqual({ kind: 'send', combo: { key: 'ArrowLeft', mods: ['alt'] } });
  });

  it('keeps system shortcuts on the controller’s computer', () => {
    for (const [e, mac] of [
      [ev('q', { metaKey: true }), true], // quit
      [ev('w', { metaKey: true }), true], // close window
      [ev('Tab', { metaKey: true }), true], // app switcher
      [ev('Tab', { altKey: true }), false], // Alt+Tab
      [ev('F4', { altKey: true }), false], // Alt+F4
      [ev(' ', { metaKey: true, code: 'Space' }), true], // Spotlight
      [ev('l', { metaKey: true }), false], // Win+L (lock)
      [ev('a', { ctrlKey: true }), true], // Ctrl on a Mac is not forwarded
      [ev('Escape', { metaKey: true, altKey: true }), true], // force quit
      [ev('Delete', { shiftKey: true }), false], // permanent delete in Explorer
    ] as const) {
      expect(decideKey(e, mac).kind).toBe('blocked');
    }
  });

  it('ignores lone modifiers and IME composition', () => {
    expect(decideKey(ev('Shift', { shiftKey: true }), true)).toEqual({ kind: 'ignore' });
    expect(decideKey(ev('Meta', { metaKey: true }), true)).toEqual({ kind: 'ignore' });
    expect(decideKey(ev('n', { isComposing: true }), true)).toEqual({ kind: 'ignore' });
    expect(decideKey(ev('Process'), false)).toEqual({ kind: 'ignore' });
  });
});

describe('desktop policy (remote-input.js)', () => {
  it('maps primary to Cmd on macOS and Ctrl elsewhere', () => {
    expect(toNutKeys({ key: 'v', mods: ['primary'] }, 'darwin', Key as any)).toEqual([Key.LeftCmd, Key.V]);
    expect(toNutKeys({ key: 'v', mods: ['primary'] }, 'win32', Key as any)).toEqual([Key.LeftControl, Key.V]);
    expect(toNutKeys({ key: 'Enter', mods: [] }, 'win32', Key as any)).toEqual([Key.Return]);
    expect(toNutKeys({ key: 'ArrowRight', mods: ['shift'] }, 'darwin', Key as any)).toEqual([Key.LeftShift, Key.Right]);
  });

  it('refuses anything outside the allowlist even if a page sends it', () => {
    expect(toNutKeys({ key: 'q', mods: ['primary'] }, 'darwin', Key as any)).toBeNull();
    expect(toNutKeys({ key: 'F4', mods: ['alt'] }, 'win32', Key as any)).toBeNull();
    expect(isAllowedKey({ key: 'a', mods: ['meta' as any] })).toBe(false);
    expect(isAllowedKey({ key: 'Tab', mods: ['primary'] })).toBe(false);
    expect(isAllowedKey({ key: 's', mods: ['primary', 'alt'] })).toBe(false); // includes the stop shortcut's shape
  });

  it('sanitizes typed text', () => {
    expect(sanitizeText('hi\u0007 there\n')).toBe('hi there');
    expect(sanitizeText('日本語')).toBe('日本語');
    expect(sanitizeText('x'.repeat(500))).toHaveLength(200);
    expect(sanitizeText(42)).toBe('');
  });

  it('converts wheel pixels to each OS’s scroll units', () => {
    expect(wheelSteps(0, 100, 'darwin')).toEqual({ down: 100, right: 0 });
    expect(wheelSteps(0, -100, 'win32')).toEqual({ down: -120, right: 0 });
    expect(wheelSteps(30, 0, 'linux')).toEqual({ down: 0, right: 1 });
    expect(wheelSteps(0, 1e9, 'darwin').down).toBe(2000);
  });

  it('rate-limits bursts', () => {
    let now = 0;
    const allow = createRateLimiter(3, 1000, () => now);
    expect([allow(), allow(), allow(), allow()]).toEqual([true, true, true, false]);
    now = 1000;
    expect(allow()).toBe(true);
  });
});

describe('desktop session gate (main.js)', () => {
  const off = { protocol: true, active: false, pausedUntil: 0 };
  const on = { protocol: true, active: true, pausedUntil: 0 };
  const legacy = { protocol: false, active: false, pausedUntil: 0 };

  it('executes nothing while control is not granted', () => {
    for (const type of ['mousemove', 'mousedown', 'mouseup', 'dblclick', 'wheel', 'key', 'text']) {
      expect(acceptRemoteInput(off, { type }, 0)).toBe(false);
      expect(acceptRemoteInput(on, { type }, 0)).toBe(true);
    }
  });

  it('keeps pages from before sessions existed to the mouse, as before', () => {
    expect(acceptRemoteInput(legacy, { type: 'mousedown' }, 0)).toBe(true);
    expect(acceptRemoteInput(legacy, { type: 'key', key: 'c', mods: ['primary'] }, 0)).toBe(false);
    expect(acceptRemoteInput(legacy, { type: 'text', text: 'hi' }, 0)).toBe(false);
    expect(acceptRemoteInput(legacy, { type: 'wheel' }, 0)).toBe(false);
  });

  it('pauses while the presenter moves their own mouse, but still lets a button go', () => {
    const paused = { ...on, pausedUntil: 1500 };
    expect(acceptRemoteInput(paused, { type: 'mousedown' }, 1000)).toBe(false);
    expect(acceptRemoteInput(paused, { type: 'key', key: 'Enter' }, 1000)).toBe(false);
    expect(acceptRemoteInput(paused, { type: 'mouseup' }, 1000)).toBe(true);
    expect(acceptRemoteInput(paused, { type: 'mousedown' }, 1500)).toBe(true);
  });

  it('rejects unknown types, including object-prototype names', () => {
    for (const type of ['screen-info', 'shell', 'constructor', 'hasOwnProperty', '__proto__', undefined]) {
      expect(acceptRemoteInput(on, { type }, 0)).toBe(false);
    }
    expect(acceptRemoteInput(on, null, 0)).toBe(false);
    expect(['mousemove', 'dblclick', 'wheel', 'key', 'text'].map(limiterFor)).toEqual(['pointer', 'pointer', 'wheel', 'key', 'text']);
  });

  it('maps positions onto the shared screen and never past its edge', () => {
    // Second monitor to the right of a 1440-wide primary
    const screen = { x: 1440, y: 0, width: 1920, height: 1080 };
    expect(toScreenPoint({ x: 0, y: 0 }, screen)).toEqual({ x: 1440, y: 0 });
    expect(toScreenPoint({ x: 0.5, y: 0.5 }, screen)).toEqual({ x: 2400, y: 540 });
    expect(toScreenPoint({ x: 1, y: 1 }, screen)).toEqual({ x: 3359, y: 1079 });
    expect(toScreenPoint({ x: 7, y: -3 }, screen)).toEqual({ x: 3359, y: 0 });
    expect(toScreenPoint({ x: Number.NaN, y: 'x' }, screen)).toEqual({ x: 1440, y: 0 });
    // absolute positions: ignored for current pages, clamped for old ones
    expect(toScreenPoint({ x: 0.5, y: 0.5, absX: 0, absY: 0 }, screen)).toEqual({ x: 2400, y: 540 });
    expect(toScreenPoint({ absX: 99999, absY: -5 }, screen, true)).toEqual({ x: 3359, y: 0 });
  });
});

describe('sanitizeControlMessage (presenter page)', () => {
  it('passes valid input and drops absolute positions', () => {
    expect(sanitizeControlMessage({ type: 'mousedown', x: 0.5, y: 0.5, button: 2, absX: 10, absY: 10 })).toEqual({
      type: 'mousedown',
      x: 0.5,
      y: 0.5,
      button: 2,
    });
    expect(sanitizeControlMessage({ type: 'wheel', x: 0.1, y: 0.2, dx: 0, dy: 99999 })).toMatchObject({ dy: 2000 });
    expect(sanitizeControlMessage({ type: 'key', key: 'c', mods: ['primary'] })).toMatchObject({ key: 'c' });
  });

  it('drops malformed or disallowed input', () => {
    expect(sanitizeControlMessage({ type: 'mousedown', x: 5, y: 0.5 })).toBeNull();
    expect(sanitizeControlMessage({ type: 'key', key: 'q', mods: ['primary'] })).toBeNull();
    expect(sanitizeControlMessage({ type: 'text', text: '\u0000' })).toBeNull();
    expect(sanitizeControlMessage({ type: 'screen-info' })).toBeNull();
    expect(sanitizeControlMessage({ type: 'shell', cmd: 'rm' })).toBeNull();
  });
});

describe('wheel input (controller)', () => {
  it('normalizes line and page deltas to pixels', () => {
    expect(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800)).toEqual({ dx: 0, dy: 48 });
    expect(wheelPixels({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 800)).toEqual({ dx: 0, dy: 800 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('schedules with the real timer without binding it to the accumulator', () => {
    vi.useFakeTimers();
    const receivers: unknown[] = [];
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(function (this: unknown, ...args: Parameters<typeof setTimeout>) {
      receivers.push(this);
      return real(...args);
    } as typeof setTimeout);
    const sent: { dy: number }[] = [];
    const acc = new WheelAccumulator((m) => sent.push(m));
    acc.add(0.5, 0.5, 0, 40);
    acc.add(0.5, 0.5, 0, 60);
    expect(receivers).toHaveLength(1);
    expect(receivers[0]).not.toBe(acc);
    vi.advanceTimersByTime(33);
    expect(sent).toEqual([{ x: 0.5, y: 0.5, dx: 0, dy: 100 }]);
  });

  it('batches a trackpad’s stream of tiny deltas', () => {
    const sent: { dx: number; dy: number }[] = [];
    const timers: (() => void)[] = [];
    const acc = new WheelAccumulator(
      (m) => sent.push(m),
      33,
      (fn) => {
        timers.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      () => {},
    );
    for (let i = 0; i < 20; i++) acc.add(0.5, 0.5, 0, 2.5);
    expect(sent).toHaveLength(0);
    expect(timers).toHaveLength(1);
    timers[0]();
    expect(sent).toEqual([{ x: 0.5, y: 0.5, dx: 0, dy: 50 }]);
  });
});
