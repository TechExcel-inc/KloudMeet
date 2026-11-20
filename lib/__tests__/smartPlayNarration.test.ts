import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { smartPlayNarration } from '@/lib/smartPlayNarration.server';

const { stored, sent, connections } = vi.hoisted(() => ({
  stored: new Map<string, Buffer>(),
  sent: [] as Array<{ type: string; item?: { content: Array<{ text: string }> } }>,
  connections: { count: 0 },
}));

vi.mock('ws', () => ({
  default: class extends EventEmitter {
    constructor() {
      super();
      connections.count++;
      queueMicrotask(() => this.emit('open'));
    }

    send(payload: string) {
      const command = JSON.parse(payload);
      sent.push(command);
      if (command.type === 'session.update') {
        queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' }))));
      } else if (command.type === 'response.create') {
        queueMicrotask(() => {
          this.emit('message', Buffer.from(JSON.stringify({
            type: 'response.output_audio.delta', delta: Buffer.alloc(48_000).toString('base64'),
          })));
          this.emit('message', Buffer.from(JSON.stringify({
            type: 'response.done', response: { status: 'completed' },
          })));
        });
      }
    }

    terminate() {}
  },
}));

vi.mock('@/lib/objectStore', () => ({
  storeClient: () => ({
    send: async (command: { constructor: { name: string }; input: { Key: string; Body: Buffer } }) => {
      const { Key, Body } = command.input;
      if (command.constructor.name === 'PutObjectCommand') {
        stored.set(Key, Body);
        return {};
      }
      const body = stored.get(Key);
      if (!body) throw { $metadata: { httpStatusCode: 404 } };
      return { ContentLength: body.length };
    },
  }),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: async () => 'https://example.test/clip.wav' }));

beforeEach(() => {
  vi.stubEnv('S3_BUCKET', 'test');
  vi.stubEnv('OPENAI_TTS_API_KEY', 'test');
  stored.clear();
  sent.length = 0;
  connections.count = 0;
});

afterEach(() => vi.unstubAllEnvs());

it('caches one narrated bilingual WAV for simultaneous requests and reuses it for viewers', async () => {
  const text = '大家好。 Welcome to the project recap.';
  const make = (canGenerate: boolean) => smartPlayNarration(1, text, 'zh', canGenerate);
  await expect(make(false)).resolves.toBe('sign-in');
  expect(connections.count).toBe(0);
  const [first, second] = await Promise.all([make(true), make(true)]);
  expect(first).toEqual({ url: 'https://example.test/clip.wav', seconds: 1 });
  expect(second).toEqual(first);
  await expect(make(false)).resolves.toEqual(first);
  expect(connections.count).toBe(1);
  const message = sent.find((event) => event.type === 'conversation.item.create');
  expect(JSON.parse(message!.item!.content[0].text)).toEqual({ text });
  expect([...stored.values()][0].subarray(0, 4).toString()).toBe('RIFF');
});
