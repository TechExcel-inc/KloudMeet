import { describe, expect, it } from 'vitest';
import {
  decodeTvMessage,
  encodeTvMessage,
  formatPairCode,
  isPairCode,
  normalizeMeetingCode,
  parseTvCommand,
} from './protocol';

describe('protocol', () => {
  it('round-trips messages and drops malformed ones', () => {
    const msg = { t: 'cmd' as const, cmd: { type: 'mic' as const, on: true } };
    expect(decodeTvMessage(encodeTvMessage(msg))).toEqual(msg);
    expect(decodeTvMessage(new TextEncoder().encode('{"t":"cmd","cmd":{"type":"rm -rf"}}'))).toBeNull();
    expect(decodeTvMessage(new TextEncoder().encode('not json'))).toBeNull();
  });

  it('validates command fields', () => {
    expect(parseTvCommand({ type: 'volume', delta: 999 })).toEqual({ type: 'volume', delta: 100 });
    expect(parseTvCommand({ type: 'volume' })).toBeNull();
    expect(parseTvCommand({ type: 'mic', on: 'yes' })).toBeNull();
    expect(parseTvCommand({ type: 'leave', confirmed: 'true' })).toEqual({ type: 'leave' });
    expect(parseTvCommand({ type: 'join', code: 'https://meet.kloud.cn/rooms/abc-defg-hij?x=1' })).toEqual({
      type: 'join',
      code: 'abc-defg-hij',
    });
  });

  it('normalizes meeting codes without reformatting them', () => {
    expect(normalizeMeetingCode(' M5888 ')).toBe('m5888');
    expect(normalizeMeetingCode('abc defg hij')).toBe('abcdefghij');
    expect(normalizeMeetingCode('<script>')).toBeNull();
  });

  it('formats and checks pairing codes', () => {
    expect(formatPairCode('482913')).toBe('482 913');
    expect(isPairCode('482913')).toBe(true);
    expect(isPairCode('48291')).toBe(false);
    expect(isPairCode('48291a')).toBe(false);
  });
});
