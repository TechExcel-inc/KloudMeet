import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { smartPlayNarration } from '@/lib/smartPlayNarration.server';

const { stored, sent, connections, voice } = vi.hoisted(() => ({
  stored: new Map<string, Buffer>(),
  sent: [] as Array<{ type: string; item?: { content: Array<{ text: string }> } }>,
  connections: { count: 0 },
  voice: { hold: false, finish: undefined as (() => void) | undefined },
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
        const finish = () => {
          this.emit('message', Buffer.from(JSON.stringify({
            type: 'response.output_audio.delta', delta: Buffer.alloc(48_000).toString('base64'),
          })));
          this.emit('message', Buffer.from(JSON.stringify({
            type: 'response.done', response: { status: 'completed' },
          })));
        };
        if (voice.hold) voice.finish = finish;
        else queueMicrotask(finish);
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
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  stored.clear();
  sent.length = 0;
  connections.count = 0;
  voice.hold = false;
  voice.finish = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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


it('acknowledges preparation immediately and polls without starting another synthesis', async () => {
  voice.hold = true;
  const tasks: Array<() => Promise<void>> = [];
  const options = { background: (task: () => Promise<void>) => tasks.push(task) };
  const start = () => smartPlayNarration(1, 'A longer section.', 'en', true, options);
  const poll = () => smartPlayNarration(1, 'A longer section.', 'en', true, { poll: true });
  await expect(poll()).resolves.toBe('failed');
  await expect(start()).resolves.toBe('preparing');
  await vi.waitFor(() => expect(voice.finish).toBeDefined());
  await expect(poll()).resolves.toBe('preparing');
  expect(connections.count).toBe(1);
  expect(tasks).toHaveLength(1);
  voice.finish!();
  await tasks[0]();
  await expect(poll()).resolves.toMatchObject({ seconds: 1 });
});


it('uses the dedicated speech endpoint and does not start a Realtime session when it succeeds', async () => {
  const speech = vi.fn(async () => new Response(new Uint8Array(96_000)));
  vi.stubGlobal('fetch', speech);
  await expect(smartPlayNarration(2, '桌面回放。 Replay controls.', 'zh', true)).resolves.toMatchObject({ seconds: 2 });
  expect(speech).toHaveBeenCalledWith('https://api.openai.com/v1/audio/speech', expect.objectContaining({
    method: 'POST',
    body: expect.stringContaining('"voice":"marin"'),
  }));
  expect(connections.count).toBe(0);
});
