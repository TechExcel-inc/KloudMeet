import { describe, expect, it } from 'vitest';
import {
  findMacInstaller,
  findWindowsInstaller,
  parseReleaseManifest,
} from '../desktopReleaseManifest';

const MAC = `version: 0.2.6
files:
  - url: Kloud Meet-0.2.6-arm64.zip
    sha512: abc==
    size: 192126045
  - url: Kloud Meet-0.2.6-arm64.dmg
    sha512: def==
    size: 195817184
path: Kloud Meet-0.2.6-arm64.zip
sha512: abc==
releaseDate: '2026-11-05T07:28:32.948Z'
`;

const WIN = `version: 0.2.6
files:
  - url: Kloud Meet-Setup-0.2.6.exe
    sha512: abc==
    size: 153685324
path: Kloud Meet-Setup-0.2.6.exe
sha512: abc==
releaseDate: '2026-10-28T03:49:12.612Z'
`;

describe('parseReleaseManifest', () => {
  it('reads version, date and each file with its own size', () => {
    const m = parseReleaseManifest(MAC);
    expect(m?.version).toBe('0.2.6');
    expect(m?.releaseDate).toBe('2026-11-05T07:28:32.948Z');
    expect(m?.files).toEqual([
      { url: 'Kloud Meet-0.2.6-arm64.zip', size: 192126045 },
      { url: 'Kloud Meet-0.2.6-arm64.dmg', size: 195817184 },
    ]);
  });

  it('rejects the HTML page the download server answers with when a manifest is missing', () => {
    expect(parseReleaseManifest('<!DOCTYPE html><html><title>Kloud</title></html>')).toBeNull();
  });
});

describe('findMacInstaller', () => {
  it('finds the dmg for the chip and never offers another chip', () => {
    const m = parseReleaseManifest(MAC)!;
    expect(findMacInstaller(m, 'arm64')?.url).toBe('Kloud Meet-0.2.6-arm64.dmg');
    expect(findMacInstaller(m, 'x64')).toBeNull();
  });

  it('falls back to the zip when no dmg is published', () => {
    const m = parseReleaseManifest(`version: 0.2.6
files:
  - url: Kloud Meet-0.2.6-arm64.zip
    size: 10
  - url: Kloud Meet-0.2.6-x64.zip
    size: 20
`)!;
    expect(findMacInstaller(m, 'arm64')).toEqual({ url: 'Kloud Meet-0.2.6-arm64.zip', size: 10 });
    expect(findMacInstaller(m, 'x64')?.url).toBe('Kloud Meet-0.2.6-x64.zip');
  });
});

describe('findWindowsInstaller', () => {
  it('finds the installer', () => {
    expect(findWindowsInstaller(parseReleaseManifest(WIN)!)).toEqual({
      url: 'Kloud Meet-Setup-0.2.6.exe',
      size: 153685324,
    });
  });
});
