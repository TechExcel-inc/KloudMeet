/**
 * Remote-control input policy, shared by the meeting page (what the controller may send) and
 * the desktop app (what the presenter's computer will execute). CommonJS so main.js can load it.
 *
 * Keys are an allowlist: typing, editing and navigation, plus a few everyday shortcuts.
 * Anything that leaves the app or touches the system (quit, close window, switch app,
 * lock screen, the Windows key, Spotlight, force quit…) is never sent and never executed.
 */

/** Keys that may be sent on their own (letters, digits and symbols travel as text). */
const NAMED_KEYS = [
  'Enter',
  'Backspace',
  'Delete',
  'Tab',
  'Escape',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'F2',
  'F5',
];

const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];

/**
 * With Cmd (Mac) / Ctrl (Windows): select all, copy, paste, cut, undo, redo, save, find,
 * bold, italic, underline, insert link. Not Q / W / N / T / H / M / P / Tab / Space.
 */
const PRIMARY_LETTERS = ['a', 'c', 'v', 'x', 'z', 'y', 's', 'f', 'b', 'i', 'u', 'k'];

const TEXT_MAX = 200;

/**
 * @typedef {'primary' | 'shift' | 'alt'} Mod
 * @typedef {{ key: string, mods?: Mod[] }} KeyCombo
 */

function normMods(mods) {
  const set = new Set(Array.isArray(mods) ? mods : []);
  return { primary: set.has('primary'), shift: set.has('shift'), alt: set.has('alt'), size: set.size };
}

/**
 * Whether a key combo may be sent / executed.
 * @param {KeyCombo} combo
 */
function isAllowedKey(combo) {
  if (!combo || typeof combo.key !== 'string') return false;
  const { key } = combo;
  const raw = Array.isArray(combo.mods) ? combo.mods : [];
  if (raw.some((m) => m !== 'primary' && m !== 'shift' && m !== 'alt')) return false;
  const m = normMods(raw);
  const isLetter = /^[a-z]$/.test(key);

  if (!m.primary && !m.alt) {
    if (!m.shift) return NAMED_KEYS.includes(key);
    // Shift+Delete is "delete permanently" in Windows Explorer.
    return NAV_KEYS.includes(key) || key === 'Tab' || key === 'Enter';
  }
  if (m.primary && !m.alt) {
    if (m.shift) return key === 'z' || key === 'v' || NAV_KEYS.includes(key);
    if (isLetter) return PRIMARY_LETTERS.includes(key);
    return NAV_KEYS.includes(key) || key === 'Backspace' || key === 'Enter';
  }
  if (m.alt && !m.primary) {
    return NAV_KEYS.includes(key) || key === 'Backspace';
  }
  return false;
}

/** Printable text only, at most TEXT_MAX characters per message. */
function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return Array.from(text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '')).slice(0, TEXT_MAX).join('');
}

/**
 * Browser wheel delta (pixels, positive = down / right) → nut-js scroll steps for this OS:
 * macOS scrolls in pixels, Windows in wheel units (120 per notch ≈ 100 px in a browser),
 * Linux in notches.
 * @returns {{ down: number, right: number }} signed step counts
 */
function wheelSteps(dx, dy, platform) {
  const clamp = (v, max) => Math.max(-max, Math.min(max, Number.isFinite(v) ? v : 0));
  const px = { x: clamp(dx, 2000), y: clamp(dy, 2000) };
  const conv = (v) => {
    if (v === 0) return 0;
    if (platform === 'darwin') return Math.round(v);
    if (platform === 'win32') return Math.round(v * 1.2);
    return Math.sign(v) * Math.max(1, Math.round(Math.abs(v) / 100));
  };
  return { down: conv(px.y), right: conv(px.x) };
}

/**
 * Map a policy key name to nut-js Key enum members for this OS.
 * @param {KeyCombo} combo
 * @param {string} platform process.platform
 * @param {Record<string, number>} Key nut-js Key enum
 * @returns {number[] | null} keys to press together (modifiers first), or null when not allowed
 */
function toNutKeys(combo, platform, Key) {
  if (!isAllowedKey(combo)) return null;
  const m = normMods(combo.mods);
  const keys = [];
  if (m.primary) keys.push(platform === 'darwin' ? Key.LeftCmd : Key.LeftControl);
  if (m.shift) keys.push(Key.LeftShift);
  if (m.alt) keys.push(Key.LeftAlt);
  const names = {
    Enter: 'Return',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  };
  const name = /^[a-z]$/.test(combo.key) ? combo.key.toUpperCase() : names[combo.key] || combo.key;
  const main = Key[name];
  if (typeof main !== 'number') return null;
  keys.push(main);
  return keys;
}

/** Rolling-window limit: at most `max` events per `windowMs`. */
function createRateLimiter(max, windowMs, now = () => Date.now()) {
  const stamps = [];
  return () => {
    const t = now();
    while (stamps.length && t - stamps[0] >= windowMs) stamps.shift();
    if (stamps.length >= max) return false;
    stamps.push(t);
    return true;
  };
}

/** Readable label for a combo, e.g. "⌘Q" / "Ctrl+Q", used in "not sent" hints. */
function comboLabel(combo, isMac) {
  const m = normMods(combo.mods);
  const key = combo.key.length === 1 ? combo.key.toUpperCase() : combo.key.replace(/^Arrow/, '');
  if (isMac) return `${m.primary ? '⌘' : ''}${m.alt ? '⌥' : ''}${m.shift ? '⇧' : ''}${key}`;
  return [m.primary && 'Ctrl', m.alt && 'Alt', m.shift && 'Shift', key].filter(Boolean).join('+');
}

/** Presenter-side shortcut that ends control at once (registered only while controlled). */
const STOP_SHORTCUT = 'Control+Alt+S';

const POINTER_TYPES = ['mousemove', 'mousedown', 'mouseup', 'dblclick'];
const INPUT_TYPES = [...POINTER_TYPES, 'wheel', 'key', 'text'];

/**
 * Whether the desktop app may execute a remote event right now.
 * `session.protocol`: the meeting page reports control sessions; `session.active`: the
 * presenter has granted control; `session.pausedUntil`: the presenter is using their own mouse.
 * Pages from before sessions existed keep their old mouse-only behaviour.
 * @param {{ protocol: boolean, active: boolean, pausedUntil: number }} session
 * @param {unknown} data
 * @param {number} now
 */
function acceptRemoteInput(session, data, now) {
  if (!data || typeof data !== 'object' || !INPUT_TYPES.includes(data.type)) return false;
  const isPointer = POINTER_TYPES.includes(data.type);
  if (session.protocol ? !session.active : !isPointer) return false;
  // While the presenter moves their own mouse remote input waits (a button release still goes through).
  if (now < session.pausedUntil && data.type !== 'mouseup') return false;
  return true;
}

/** Which rate limiter an accepted event counts against. */
function limiterFor(type) {
  return POINTER_TYPES.includes(type) ? 'pointer' : type;
}

/**
 * 0–1 position within the shared picture → a pixel of the shared screen or window, always
 * inside it (x = 1 must not land on the next monitor). Absolute positions are only honoured
 * for pages from before sessions existed, and are clamped the same way.
 * @param {{ x?: unknown, y?: unknown, absX?: unknown, absY?: unknown }} data
 * @param {{ x: number, y: number, width: number, height: number }} bounds
 */
function toScreenPoint(data, bounds, allowAbsolute = false) {
  const w = Math.max(1, Math.round(bounds.width));
  const h = Math.max(1, Math.round(bounds.height));
  const inside = (v, origin, size) => Math.max(origin, Math.min(origin + size - 1, Math.round(v)));
  if (allowAbsolute && Number.isFinite(data.absX) && Number.isFinite(data.absY)) {
    return { x: inside(data.absX, bounds.x, w), y: inside(data.absY, bounds.y, h) };
  }
  const unit = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
  return { x: inside(bounds.x + unit(data.x) * w, bounds.x, w), y: inside(bounds.y + unit(data.y) * h, bounds.y, h) };
}

module.exports = {
  NAMED_KEYS,
  PRIMARY_LETTERS,
  TEXT_MAX,
  STOP_SHORTCUT,
  isAllowedKey,
  sanitizeText,
  wheelSteps,
  toNutKeys,
  createRateLimiter,
  comboLabel,
  acceptRemoteInput,
  limiterFor,
  toScreenPoint,
};
