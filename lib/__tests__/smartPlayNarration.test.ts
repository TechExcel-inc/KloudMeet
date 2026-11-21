import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareSmartPlayVoice, smartPlayNarration } from '@/lib/smartPlayNarration.server';

const { clips } = vi.hoisted(() => ({ clips: new Map<string, number>() }));

vi.mock('@/lib/objectStore', () => ({
  storeClient: () => ({
    send: async (command: { constructor: { name: string }; input: { Key: string; Body?: Buffer } }) => {
      const { Key, Body } = command.input;
      if (command.constructor.name === 'PutObjectCommand' && Body) {
        clips.set(Key, Body.length);
        return {};
      }
      const ContentLength = clips.get(Key);
      if (ContentLength !== undefined) return { ContentLength };
      throw Object.assign(new Error('Missing clip'), { $metadata: { httpStatusCode: 404 } });
    },
  }),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: async (_client: unknown, command: { input: { Key: string } }) => command.input.Key,
}));

describe('Smart Play voice changes', () => {
  beforeEach(() => {
    clips.clear();
    vi.stubEnv('S3_BUCKET', 'test-speech');
    vi.stubEnv('OPENAI_TTS_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('prepares new clips per voice and reuses them when switching back', async () => {
    const speech = vi.fn(async () => new Response(new Uint8Array(48)));
    vi.stubGlobal('fetch', speech);
    const presentation = { language: 'en', slides: [{ narration: 'First section.' }, { narration: 'Second section.' }] };

    await prepareSmartPlayVoice(1, presentation, 'marin');
    const original = await smartPlayNarration(1, 'First section.', 'en', true, { voice: 'marin' });
    expect(speech).toHaveBeenCalledTimes(2);

    await prepareSmartPlayVoice(1, presentation, 'cedar');
    const changed = await smartPlayNarration(1, 'First section.', 'en', true, { voice: 'cedar' });
    expect(speech).toHaveBeenCalledTimes(4);
    expect(changed).not.toEqual(original);

    await prepareSmartPlayVoice(1, presentation, 'marin');
    expect(await smartPlayNarration(1, 'First section.', 'en', true, { voice: 'marin' })).toEqual(original);
    expect(speech).toHaveBeenCalledTimes(4);
  });
});
