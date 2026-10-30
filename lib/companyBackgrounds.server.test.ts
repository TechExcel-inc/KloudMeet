import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/apiAuth', () => ({ forbidden: vi.fn(), isAuthError: vi.fn(), requireSession: vi.fn() }));

import { backgroundVersion, cleanBackgroundName, companyBackgroundUrl, isAcceptableJpeg } from './companyBackgrounds.server';

describe('company backgrounds (server)', () => {
  it('accepts JPEGs within the size limit only', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    expect(isAcceptableJpeg(jpeg, 100)).toBe(true);
    expect(isAcceptableJpeg(jpeg, 4)).toBe(false);
    expect(isAcceptableJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]), 100)).toBe(false);
  });

  it('cleans names', () => {
    expect(cleanBackgroundName('  Lobby\n ')).toBe('Lobby');
    expect(cleanBackgroundName('   ')).toBeNull();
    expect(cleanBackgroundName(42)).toBeNull();
    expect(cleanBackgroundName('x'.repeat(200))).toHaveLength(80);
  });

  it('gives each picture its own URL', () => {
    const a = backgroundVersion(new Uint8Array([1, 2, 3]));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(backgroundVersion(new Uint8Array([1, 2, 4]))).not.toBe(a);
    expect(companyBackgroundUrl(7, a, 'thumb')).toBe(`/api/company-backgrounds/7/${a}/thumb`);
  });
});
