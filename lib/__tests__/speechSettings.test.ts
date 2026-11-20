import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assemblyAiKey, saveAssemblyAiSettings, speechSettingsStatus } from '@/lib/speechSettings.server';

const { rows } = vi.hoisted(() => ({ rows: new Map<string, string>() }));

vi.mock('@/lib/db', () => ({
  prisma: {
    systemSetting: {
      findMany: async () => Array.from(rows, ([key, value]) => ({ key, value })),
    },
    $executeRaw: (_sql: TemplateStringsArray, key: string, value: string) => ({ key, value }),
    $transaction: async (updates: Array<{ key: string; value: string }>) => {
      for (const { key, value } of updates) rows.set(key, value);
    },
  },
}));

beforeEach(() => {
  rows.clear();
  vi.stubEnv('SPEECH_SETTINGS_SECRET', 'stable-test-encryption-secret');
  vi.stubEnv('ASSEMBLYAI_API_KEY', 'environment-key');
  vi.stubEnv('DASHSCOPE_API_KEY', 'ali-environment-key');
});

afterEach(() => vi.unstubAllEnvs());

describe('AssemblyAI speech settings', () => {
  it('uses the environment key before staff saves an override', async () => {
    await expect(assemblyAiKey()).resolves.toBe('environment-key');
    await expect(speechSettingsStatus()).resolves.toEqual({
      assemblyActive: true, assemblyConfigured: true, aliConfigured: true,
    });
  });

  it('persists an encrypted override and preserves it when the key field is blank', async () => {
    await saveAssemblyAiSettings(true, 'new-app-key');
    const stored = rows.get('assemblyai_stt_credential');
    expect(stored).toBeTruthy();
    expect(stored).not.toContain('new-app-key');
    await expect(assemblyAiKey()).resolves.toBe('new-app-key');

    await saveAssemblyAiSettings(false, '');
    expect(rows.get('assemblyai_stt_credential')).toBe(stored);
    await expect(assemblyAiKey()).resolves.toBeUndefined();
    await expect(assemblyAiKey({ existingJob: true })).resolves.toBe('new-app-key');
    await expect(speechSettingsStatus()).resolves.toEqual({
      assemblyActive: false, assemblyConfigured: true, aliConfigured: true,
    });
  });
});
