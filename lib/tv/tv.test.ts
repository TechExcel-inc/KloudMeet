import { describe, expect, it } from 'vitest';
import { normalizeRemoteKey } from './remoteKeys';
import { pickNext, type NavRect } from './spatialNav';
import { parseVoiceCommand, spokenCodeToText } from './voiceCommands';
import {
  decodeTvMessage,
  encodeTvMessage,
  formatPairCode,
  isPairCode,
  normalizeMeetingCode,
  parseTvCommand,
} from './protocol';
import { encodeQr } from './qrCode';

describe('normalizeRemoteKey', () => {
  it('reads arrows, OK and Back from keys or TV key codes', () => {
    expect(normalizeRemoteKey({ key: 'ArrowLeft' })).toEqual({ key: 'left' });
    expect(normalizeRemoteKey({ key: 'Enter' })).toEqual({ key: 'ok' });
    expect(normalizeRemoteKey({ key: 'Unidentified', keyCode: 461 })).toEqual({ key: 'back' });
    expect(normalizeRemoteKey({ key: 'XF86Back', keyCode: 10009 })).toEqual({ key: 'back' });
    expect(normalizeRemoteKey({ key: 'GoBack' })).toEqual({ key: 'back' });
  });

  it('reads colour buttons and digits', () => {
    expect(normalizeRemoteKey({ key: 'ColorF0Red' })).toEqual({ key: 'red' });
    expect(normalizeRemoteKey({ key: 'Unidentified', keyCode: 406 })).toEqual({ key: 'blue' });
    expect(normalizeRemoteKey({ key: '7' })).toEqual({ key: 'digit', digit: 7 });
    expect(normalizeRemoteKey({ key: 'Unidentified', keyCode: 99 })).toEqual({ key: 'digit', digit: 3 });
  });

  it('ignores shortcuts and letters', () => {
    expect(normalizeRemoteKey({ key: 'ArrowLeft', metaKey: true })).toBeNull();
    expect(normalizeRemoteKey({ key: 'a', keyCode: 65 })).toBeNull();
  });
});

const box = (left: number, top: number, w = 100, h = 60): NavRect => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

describe('pickNext', () => {
  // A 3×2 keyboard-like grid
  const grid = [box(0, 0), box(110, 0), box(220, 0), box(0, 70), box(110, 70), box(220, 70)];

  it('moves within a row and a column', () => {
    expect(pickNext(grid[0], grid, 'right')).toBe(1);
    expect(pickNext(grid[1], grid, 'down')).toBe(4);
    expect(pickNext(grid[5], grid, 'up')).toBe(2);
    expect(pickNext(grid[4], grid, 'left')).toBe(3);
  });

  it('stays put at an edge (no wrap)', () => {
    expect(pickNext(grid[2], grid, 'right')).toBe(-1);
    expect(pickNext(grid[0], grid, 'up')).toBe(-1);
  });

  it('prefers the box in the same row over a nearer one off to the side', () => {
    const from = box(0, 100, 100, 100);
    const sameRowFar = box(400, 120, 100, 60);
    const offRowNear = box(120, 0, 100, 60);
    expect(pickNext(from, [offRowNear, sameRowFar], 'right')).toBe(1);
  });

  it('reaches a tall side panel from any row', () => {
    const cards = [box(0, 0, 600, 120), box(0, 140, 600, 120), box(0, 280, 600, 120)];
    const panel = box(700, 0, 400, 400);
    expect(pickNext(cards[2], [...cards, panel], 'right')).toBe(3);
  });

  it('ignores a neighbour that only looks lower because the focused item is lifted', () => {
    const lifted = { left: 0, top: -6, right: 136, bottom: 114 };
    const next = box(148, 0, 136, 120);
    expect(pickNext(lifted, [next], 'down')).toBe(-1);
    expect(pickNext(lifted, [next], 'right')).toBe(0);
  });

  it('picks the wide button below the middle of a row', () => {
    const keys = [box(0, 0), box(110, 0), box(220, 0)];
    const join = box(0, 70, 320, 60);
    expect(pickNext(keys[2], [...keys, join], 'down')).toBe(3);
  });
});

describe('parseVoiceCommand', () => {
  const cmd = (text: string) => parseVoiceCommand(text)?.command ?? null;

  it('understands microphone commands without mixing up unmute', () => {
    expect(cmd('Mute')).toEqual({ type: 'mic', on: false });
    expect(cmd('unmute me')).toEqual({ type: 'mic', on: true });
    expect(cmd('Turn off my microphone.')).toEqual({ type: 'mic', on: false });
    expect(cmd('取消静音')).toEqual({ type: 'mic', on: true });
    expect(cmd('静音')).toEqual({ type: 'mic', on: false });
    expect(cmd('ミュート解除')).toEqual({ type: 'mic', on: true });
    expect(cmd('ミュートして')).toEqual({ type: 'mic', on: false });
    expect(cmd('음소거 해제')).toEqual({ type: 'mic', on: true });
    expect(cmd('음소거')).toEqual({ type: 'mic', on: false });
  });

  it('treats muting the sound as the TV speaker, not the microphone', () => {
    expect(cmd('mute the sound')).toEqual({ type: 'volume', muted: true });
    expect(cmd('Volume up')).toEqual({ type: 'volume', delta: 10 });
    expect(cmd('小声一点')).toEqual({ type: 'volume', delta: -10 });
    expect(cmd('set volume to 40')).toEqual({ type: 'volume', level: 40 });
  });

  it('understands camera, captions and hand', () => {
    expect(cmd('turn on the camera')).toEqual({ type: 'cam', on: true });
    expect(cmd('stop video')).toEqual({ type: 'cam', on: false });
    expect(cmd('关闭摄像头')).toEqual({ type: 'cam', on: false });
    expect(cmd('Turn on captions')).toEqual({ type: 'captions', on: true });
    expect(cmd('字幕をオフ')).toEqual({ type: 'captions', on: false });
    expect(cmd('raise my hand')).toEqual({ type: 'hand', on: true });
    expect(cmd('取消举手')).toEqual({ type: 'hand', on: false });
    expect(cmd('举手')).toEqual({ type: 'hand', on: true });
  });

  it('understands views, layouts and leaving', () => {
    expect(cmd('show the document')).toEqual({ type: 'view', view: 'liveDoc' });
    expect(cmd('看共享屏幕')).toEqual({ type: 'view', view: 'shareScreen' });
    expect(cmd('grid view')).toEqual({ type: 'layout', mode: 'tile' });
    expect(cmd('speaker view')).toEqual({ type: 'layout', mode: 'spotlight' });
    expect(cmd('Leave the meeting')).toEqual({ type: 'leave' });
    expect(cmd('hang up')).toEqual({ type: 'leave' });
    expect(cmd('end meeting for everyone')).toEqual({ type: 'endForAll' });
    expect(cmd('退出会议')).toEqual({ type: 'leave' });
    expect(cmd('yes')).toEqual({ type: 'confirm' });
    expect(cmd('取消')).toEqual({ type: 'cancel' });
  });

  it('joins meetings by code, personal ID or spoken digits', () => {
    expect(cmd('Join meeting abc-defg-hij')).toEqual({ type: 'join', code: 'abc-defg-hij' });
    expect(cmd('join M 5 8 8 8')).toEqual({ type: 'join', code: 'm5888' });
    expect(cmd('join m five eight eight eight')).toEqual({ type: 'join', code: 'm5888' });
    expect(cmd('加入会议幺二三四五')).toEqual({ type: 'join', code: '12345' });
    expect(cmd('abc-defg-hijに参加')).toEqual({ type: 'join', code: 'abc-defg-hij' });
    expect(cmd('abc-defg-hij에 참가')).toEqual({ type: 'join', code: 'abc-defg-hij' });
  });

  it('does not mistake other "open/start" commands for joining', () => {
    expect(cmd('start video')).toEqual({ type: 'cam', on: true });
    expect(cmd('open the chat')).toEqual({ type: 'panel', panel: 'chat' });
  });

  it('returns null for chatter', () => {
    expect(cmd('what a nice day')).toBeNull();
    expect(cmd('')).toBeNull();
  });

  it('spells spoken digits', () => {
    expect(spokenCodeToText('abc dash one two')).toBe('abc - 1 2');
  });
});

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

describe('encodeQr', () => {
  it('picks the smallest version that fits', () => {
    expect(encodeQr('HELLO').version).toBe(1);
    const url = 'https://meet.kloud.cn/tv/remote?c=482913&s=Zx81kQpLm2Vt7Rw0';
    const qr = encodeQr(url);
    expect(qr.version).toBe(4);
    expect(qr.size).toBe(33);
  });

  it('draws the three finder patterns and the dark module', () => {
    const qr = encodeQr('https://meet.kloud.cn/tv/remote?c=482913');
    const m = qr.modules;
    const n = qr.size;
    for (const [x, y] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ]) {
      expect(m[y][x]).toBe(true);
      expect(m[y + 1][x + 1]).toBe(false);
      expect(m[y + 3][x + 3]).toBe(true);
    }
    expect(m[n - 8][8]).toBe(true);
  });

  it('refuses text that is too long for version 10', () => {
    expect(() => encodeQr('x'.repeat(400))).toThrow();
  });
});
