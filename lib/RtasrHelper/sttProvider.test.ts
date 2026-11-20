import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveSttProvider } from './sttProvider';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('resolveSttProvider', () => {
  it.each(['bailian', 'assemblyai'] as const)('keeps the server region provider %s', async (provider) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ provider })));
    await expect(resolveSttProvider()).resolves.toBe(provider);
  });

  it('uses AssemblyAI with the former international server response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ provider: 'openai' })));
    await expect(resolveSttProvider()).resolves.toBe('assemblyai');
  });

  it.each([
    ['Asia/Shanghai', 'bailian'],
    ['America/Los_Angeles', 'assemblyai'],
  ])('uses %s when the server cannot resolve the IP', async (timeZone, provider) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ provider: 'unknown' })));
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => ({
      locale: 'en-US',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone,
    }));
    await expect(resolveSttProvider()).resolves.toBe(provider);
  });
});
