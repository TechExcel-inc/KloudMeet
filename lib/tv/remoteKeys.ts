/**
 * TV remote keys → one small vocabulary the TV app works with.
 *
 * TV browsers and WebViews report the same physical button differently: Android TV sends
 * the arrow keys, Enter and Escape, webOS sends keyCode 461 for Back, Tizen 10009, and the four colour
 * buttons arrive as ColorF0Red… or keyCodes 403–406. A computer keyboard works too, so the
 * TV app can be used (and tested) on any screen.
 */

export type TvNavKey = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back';

export type TvKey =
  | TvNavKey
  | 'home'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'playPause'
  | 'channelUp'
  | 'channelDown'
  | 'menu'
  | 'digit';

export interface TvKeyPress {
  key: TvKey;
  /** 0–9 for `digit` */
  digit?: number;
}

/** The parts of a KeyboardEvent this needs (so tests can pass plain objects). */
export interface KeyLike {
  key?: string;
  code?: string;
  keyCode?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

const BY_KEY: Record<string, TvKey> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Up: 'up',
  Down: 'down',
  Left: 'left',
  Right: 'right',
  Enter: 'ok',
  Select: 'ok',
  Accept: 'ok',
  Escape: 'back',
  Esc: 'back',
  GoBack: 'back',
  BrowserBack: 'back',
  Backspace: 'back',
  BrowserHome: 'home',
  GoHome: 'home',
  ColorF0Red: 'red',
  ColorF1Green: 'green',
  ColorF2Yellow: 'yellow',
  ColorF3Blue: 'blue',
  MediaPlayPause: 'playPause',
  MediaPlay: 'playPause',
  MediaPause: 'playPause',
  ChannelUp: 'channelUp',
  ChannelDown: 'channelDown',
  PageUp: 'channelUp',
  PageDown: 'channelDown',
  ContextMenu: 'menu',
  Info: 'menu',
};

const BY_KEY_CODE: Record<number, TvKey> = {
  38: 'up',
  40: 'down',
  37: 'left',
  39: 'right',
  13: 'ok',
  23: 'ok', // Android DPAD_CENTER in some WebViews
  27: 'back',
  8: 'back',
  461: 'back', // LG webOS
  10009: 'back', // Samsung Tizen
  403: 'red',
  404: 'green',
  405: 'yellow',
  406: 'blue',
  179: 'playPause',
  415: 'playPause',
  19: 'playPause',
  427: 'channelUp',
  428: 'channelDown',
  33: 'channelUp',
  34: 'channelDown',
  93: 'menu',
  457: 'menu', // Info on webOS / Tizen
};

/** Maps a key event to a TV key, or null when it isn't one (or a modifier is held). */
export function normalizeRemoteKey(e: KeyLike): TvKeyPress | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  const key = e.key ?? '';
  if (/^[0-9]$/.test(key)) return { key: 'digit', digit: Number(key) };
  const byKey = BY_KEY[key];
  if (byKey) return { key: byKey };
  const code = e.keyCode ?? 0;
  if (code >= 48 && code <= 57) return { key: 'digit', digit: code - 48 };
  if (code >= 96 && code <= 105) return { key: 'digit', digit: code - 96 };
  const byCode = BY_KEY_CODE[code];
  return byCode ? { key: byCode } : null;
}

/**
 * webOS and Tizen only deliver the colour and media buttons to apps that ask for them.
 * Safe to call anywhere: it does nothing outside those platforms.
 */
export function registerTvPlatformKeys(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as {
    tizen?: { tvinputdevice?: { registerKey: (name: string) => void } };
  };
  const input = w.tizen?.tvinputdevice;
  if (!input) return;
  for (const name of [
    'ColorF0Red',
    'ColorF1Green',
    'ColorF2Yellow',
    'ColorF3Blue',
    'MediaPlayPause',
    'ChannelUp',
    'ChannelDown',
    'Info',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  ]) {
    try {
      input.registerKey(name);
    } catch {
      /* key not on this remote */
    }
  }
}
