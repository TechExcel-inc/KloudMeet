/**
 * Controller side of remote-control keyboard and wheel input: turns browser events into the
 * small messages the presenter's desktop app executes. The allowlist itself lives in
 * remote-input.js so the meeting page and the desktop app apply the same rules.
 */
import { comboLabel, isAllowedKey } from '@/remote-input';

export type RcMod = 'primary' | 'shift' | 'alt';
export type RcKeyCombo = { key: string; mods: RcMod[] };

/** Desktop features the presenter's app reports in its screen-info broadcast. */
export const RC_CAP_WHEEL = 'wheel';
export const RC_CAP_KEYS = 'keys';

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'OS', 'AltGraph', 'CapsLock', 'Fn', 'FnLock', 'Hyper', 'Super']);

const NAMED_FROM_KEY: Record<string, string> = {
  Enter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  Escape: 'Escape',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ' ': 'Space',
};

export type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> & {
  isComposing?: boolean;
};

export type KeyDecision =
  /** Send this combo as one key press. */
  | { kind: 'send'; combo: RcKeyCombo }
  /** Plain typing: let it reach the hidden text field and send it as text. */
  | { kind: 'text' }
  /** A shortcut that stays on the controller's computer (shown as a hint). */
  | { kind: 'blocked'; label: string }
  /** Modifier on its own, IME composition, …: nothing to do. */
  | { kind: 'ignore' };

/**
 * Decide what a keydown on the controller's side becomes. `isMac` is the controller's OS:
 * its Cmd (Mac) or Ctrl (others) is the "primary" modifier, which the presenter's app maps
 * to its own Cmd or Ctrl.
 */
export function decideKey(e: KeyLike, isMac: boolean): KeyDecision {
  if (e.isComposing || e.key === 'Process' || e.key === 'Dead' || e.key === 'Unidentified') return { kind: 'ignore' };
  if (MODIFIER_KEYS.has(e.key)) return { kind: 'ignore' };

  const primary = isMac ? e.metaKey : e.ctrlKey;
  // The other one (Ctrl on a Mac, the Windows key elsewhere) is never forwarded.
  const foreign = isMac ? e.ctrlKey : e.metaKey;
  const mods: RcMod[] = [];
  if (primary) mods.push('primary');
  if (e.shiftKey) mods.push('shift');
  if (e.altKey) mods.push('alt');

  let key: string | null = NAMED_FROM_KEY[e.key] ?? null;
  if (!key && /^F\d{1,2}$/.test(e.key)) key = e.key;
  if (!key && e.key.length === 1) {
    const lower = e.key.toLowerCase();
    if (/^[a-z]$/.test(lower)) key = lower;
    else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else key = e.key;
  }
  if (!key) return { kind: 'ignore' };

  const printable = e.key.length === 1;
  // Typing (including Shift and Option/AltGr characters) goes through the text field so
  // keyboard layouts and input methods produce the right characters.
  // AltGr on Windows/Linux reports Ctrl+Alt; it types symbols such as @ or € on many layouts.
  const altGr = !isMac && e.ctrlKey && e.altKey && printable && !/^[a-z0-9]$/i.test(e.key);
  if (printable && ((!primary && !foreign) || altGr)) {
    return { kind: 'text' };
  }

  const combo: RcKeyCombo = { key, mods };
  if (!foreign && isAllowedKey(combo)) return { kind: 'send', combo };
  const label = comboLabel({ key, mods }, isMac);
  return { kind: 'blocked', label: foreign ? `${isMac ? '⌃' : 'Win+'}${label}` : label };
}

/** Wheel delta in pixels whatever the event's deltaMode (0 px, 1 lines, 2 pages). */
export function wheelPixels(
  e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>,
  pageHeight: number,
): { dx: number; dy: number } {
  const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? Math.max(100, pageHeight) : 1;
  return { dx: e.deltaX * factor, dy: e.deltaY * factor };
}

/**
 * Adds up wheel movement and hands it out at most every `intervalMs`, so a trackpad's
 * stream of tiny deltas becomes ~30 messages a second.
 */
export class WheelAccumulator {
  private dx = 0;
  private dy = 0;
  private x = 0;
  private y = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly send: (m: { x: number; y: number; dx: number; dy: number }) => void,
    private readonly intervalMs = 33,
    // Wrapped: browsers throw "Illegal invocation" when setTimeout is called as a method of another object.
    private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) => setTimeout(fn, ms),
    private readonly cancel: (t: ReturnType<typeof setTimeout>) => void = (t) => clearTimeout(t),
  ) {}

  add(x: number, y: number, dx: number, dy: number) {
    this.x = x;
    this.y = y;
    this.dx += dx;
    this.dy += dy;
    if (this.timer === null) this.timer = this.schedule(() => this.flush(), this.intervalMs);
  }

  flush() {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    const dx = Math.round(this.dx);
    const dy = Math.round(this.dy);
    if (!dx && !dy) return;
    this.dx -= dx;
    this.dy -= dy;
    this.send({ x: this.x, y: this.y, dx, dy });
  }

  dispose() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
}

export const isMacPlatform = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
