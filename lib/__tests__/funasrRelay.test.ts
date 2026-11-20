import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { issueFunAsrTicket } from '@/lib/funAsrToken';

/**
 * The real relay (scripts/funasr-relay.cjs) between a client and a stand-in for DashScope.
 * AI Taking Notes depends on two things the relay does: passing on each sentence's times, and
 * waiting for the recognizer's last sentence after "finish".
 */

const KEY = 'test-dashscope-key';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

interface Upstream {
  socket: WebSocket;
  /** JSON control messages the relay sent to "DashScope" */
  actions: Array<{ header: { action: string; task_id: string }; payload: { model?: string; parameters?: Record<string, unknown> } }>;
  audioBytes: number;
  authorization: string;
}

describe('funasr relay', () => {
  let relay: ChildProcess;
  let dashscope: WebSocketServer;
  let relayPort: number;
  const upstreams: Upstream[] = [];

  beforeAll(async () => {
    dashscope = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => dashscope.once('listening', () => resolve()));
    const address = dashscope.address();
    const dashscopePort = typeof address === 'object' && address ? address.port : 0;
    dashscope.on('connection', (socket, request) => {
      const upstream: Upstream = { socket, actions: [], audioBytes: 0, authorization: String(request.headers.authorization) };
      upstreams.push(upstream);
      socket.on('message', (data, binary) => {
        if (binary) {
          upstream.audioBytes += (data as Buffer).byteLength;
          return;
        }
        const message = JSON.parse(data.toString());
        upstream.actions.push(message);
        const task_id = message.header.task_id;
        if (message.header.action === 'run-task') {
          socket.send(JSON.stringify({ header: { event: 'task-started', task_id } }));
        }
        if (message.header.action === 'finish-task') {
          // The recognizer answers with the sentence in progress, a moment later, then ends the task.
          setTimeout(() => {
            socket.send(JSON.stringify({
              header: { event: 'result-generated', task_id },
              payload: { output: { sentence: { sentence_id: 2, text: 'the last words', begin_time: 5000, end_time: 6200, sentence_end: true } } },
            }));
            socket.send(JSON.stringify({ header: { event: 'task-finished', task_id } }));
          }, 600);
        }
      });
    });

    relayPort = await freePort();
    relay = spawn(process.execPath, [path.resolve(process.cwd(), 'scripts/funasr-relay.cjs')], {
      env: {
        ...process.env,
        FUNASR_WS_PORT: String(relayPort),
        FUNASR_WS_KEY: '',
        FUNASR_WS_CERT: '',
        DASHSCOPE_WS_URL: `ws://127.0.0.1:${dashscopePort}`,
        DASHSCOPE_API_KEY: KEY,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('relay did not start')), 10000);
      relay.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('[funasr-relay]')) {
          clearTimeout(timer);
          resolve();
        }
      });
      relay.once('exit', (code) => reject(new Error(`relay exited (${code})`)));
    });
  }, 20000);

  afterAll(async () => {
    relay?.kill();
    for (const upstream of upstreams) upstream.socket.terminate();
    await new Promise<void>((resolve) => dashscope.close(() => resolve()));
  });

  /** A client connected to the relay, collecting what the relay tells it. */
  async function connect(token: string) {
    const socket = new WebSocket(`ws://127.0.0.1:${relayPort}/ws/funasr?token=${encodeURIComponent(token)}`);
    const lines: Array<Record<string, unknown>> = [];
    let closeCode: number | null = null;
    socket.on('message', (data) => lines.push(JSON.parse(data.toString())));
    socket.on('close', (code) => {
      closeCode = code;
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    const until = async (done: () => boolean, ms = 5000) => {
      const end = Date.now() + ms;
      while (!done()) {
        if (Date.now() > end) throw new Error(`timed out; got ${JSON.stringify(lines)} close=${closeCode}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    return { socket, lines, until, closed: () => closeCode };
  }

  it('refuses a connection without a valid one-time ticket', async () => {
    const bad = await connect('not-a-ticket');
    await bad.until(() => bad.closed() !== null);
    expect(bad.closed()).toBe(1008);

    const ticket = issueFunAsrTicket(KEY);
    const first = await connect(ticket);
    first.socket.send(JSON.stringify({ type: 'start', lang: '' }));
    await first.until(() => first.lines.some((line) => line.type === 'ready'));
    const reused = await connect(ticket);
    await reused.until(() => reused.closed() !== null);
    expect(reused.closed()).toBe(1008);
    first.socket.close();
  });

  it('passes audio up and each sentence back with its times; after finish it waits for the last sentence', async () => {
    const before = upstreams.length;
    const client = await connect(issueFunAsrTicket(KEY));
    client.socket.send(JSON.stringify({ type: 'start', lang: '' }));
    await client.until(() => client.lines.some((line) => line.type === 'ready'));
    const upstream = upstreams[before];
    expect(upstream.authorization).toBe(`Bearer ${KEY}`);
    const run = upstream.actions[0];
    expect(run.header.action).toBe('run-task');
    expect(run.payload.model).toBe('fun-asr-realtime');
    // No language given: the recognizer detects it (meetings mix Chinese and English).
    expect(run.payload.parameters).toMatchObject({ format: 'pcm', sample_rate: 16000 });
    expect(run.payload.parameters).not.toHaveProperty('language_hints');

    client.socket.send(Buffer.alloc(8192));
    client.socket.send(Buffer.alloc(8192));
    const task_id = run.header.task_id;
    const result = (sentence: object) =>
      upstream.socket.send(JSON.stringify({ header: { event: 'result-generated', task_id }, payload: { output: { sentence } } }));
    result({ sentence_id: 1, text: 'hello', begin_time: 170, end_time: null, sentence_end: false });
    result({ sentence_id: 0, text: '', heartbeat: true });
    result({ sentence_id: 1, text: 'hello everyone', begin_time: 170, end_time: 920, sentence_end: true });
    await client.until(() => client.lines.some((line) => line.type === 'final'));
    expect(upstream.audioBytes).toBe(16384);
    expect(client.lines.filter((line) => line.type !== 'ready')).toEqual([
      { type: 'partial', id: 1, text: 'hello', begin: 170, end: null },
      { type: 'final', id: 1, text: 'hello everyone', begin: 170, end: 920 },
    ]);

    client.socket.send(JSON.stringify({ type: 'finish' }));
    await client.until(() => client.closed() !== null);
    expect(upstream.actions.map((action) => action.header.action)).toEqual(['run-task', 'finish-task']);
    expect(client.lines.slice(-2)).toEqual([
      { type: 'final', id: 2, text: 'the last words', begin: 5000, end: 6200 },
      { type: 'closed' },
    ]);
  }, 15000);

  it('passes a language hint when one is given', async () => {
    const before = upstreams.length;
    const client = await connect(issueFunAsrTicket(KEY));
    client.socket.send(JSON.stringify({ type: 'start', lang: 'zh-CN' }));
    await client.until(() => client.lines.some((line) => line.type === 'ready'));
    expect(upstreams[before].actions[0].payload.parameters).toMatchObject({ language_hints: ['zh'] });
    client.socket.close();
  });
});
