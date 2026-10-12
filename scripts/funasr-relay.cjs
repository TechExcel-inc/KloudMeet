/**
 * Fun-ASR WebSocket relay.
 *
 * Browser --WebSocket/PCM--> this relay --WebSocket/PCM--> DashScope
 */
const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createServer } = require('node:https');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = Number(process.env.FUNASR_WS_PORT || 3202);
const PATH = '/ws/funasr';
const DASHSCOPE_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
const MAX_CLIENTS = 200;
const MAX_QUEUE_BYTES = 256000;
const LANGS = new Set(['zh', 'en', 'ja', 'ko']);
const used = new Map();

function sign(raw, key) {
  return createHmac('sha256', key).update(raw).digest('base64url');
}

function verify(raw, key) {
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const expected = Buffer.from(sign(parts[0], key));
  const actual = Buffer.from(parts[1]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (
      !payload ||
      typeof payload.exp !== 'number' ||
      typeof payload.nonce !== 'string' ||
      payload.exp < Date.now() ||
      used.has(payload.nonce)
    ) {
      return null;
    }
    used.set(payload.nonce, payload.exp);
    return payload;
  } catch {
    return null;
  }
}

function parseStart(raw) {
  try {
    const value = JSON.parse(raw.toString());
    if (!value || value.type !== 'start') return null;
    const lang = typeof value.lang === 'string'
      ? value.lang.trim().toLowerCase().split('-')[0]
      : '';
    return LANGS.has(lang) ? lang : '';
  } catch {
    return null;
  }
}

function parseDashscope(raw) {
  try {
    const value = JSON.parse(raw.toString());
    const event = value?.header?.event;
    const sentence = value?.payload?.output?.sentence;
    return {
      event: typeof event === 'string' ? event : '',
      error: value?.header?.error_message || value?.header?.error_code || '',
      text: typeof sentence?.text === 'string' ? sentence.text : '',
      final: sentence?.sentence_end === true,
      id: typeof sentence?.sentence_id === 'number' ? sentence.sentence_id : 0,
      heartbeat: sentence?.heartbeat === true,
    };
  } catch {
    return null;
  }
}

function send(socket, value) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function closePair(client, upstream, code = 1000, reason = '') {
  if (client.readyState === WebSocket.OPEN) client.close(code, reason);
  if (
    upstream &&
    (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)
  ) {
    upstream.close();
  }
}

function handle(client, key) {
  let upstream = null;
  let task = '';
  let ready = false;
  let started = false;
  let queued = [];
  let bytes = 0;

  const startTimer = setTimeout(() => closePair(client, upstream, 1008, 'start timeout'), 10000);

  client.on('message', (data, binary) => {
    if (!started) {
      if (binary) {
        closePair(client, upstream, 1008, 'start required');
        return;
      }
      const lang = parseStart(data);
      if (lang === null) {
        closePair(client, upstream, 1008, 'invalid start');
        return;
      }
      started = true;
      task = randomUUID();
      upstream = new WebSocket(DASHSCOPE_URL, {
        headers: { Authorization: `Bearer ${key}` },
      });

      upstream.on('open', () => {
        const parameters = {
          format: 'pcm',
          sample_rate: 16000,
          semantic_punctuation_enabled: true,
          heartbeat: true,
          max_sentence_silence: 800,
        };
        if (lang) parameters.language_hints = [lang];
        upstream.send(JSON.stringify({
          header: { action: 'run-task', task_id: task, streaming: 'duplex' },
          payload: {
            task_group: 'audio',
            task: 'asr',
            function: 'recognition',
            model: 'fun-asr-realtime',
            parameters,
            input: {},
          },
        }));
      });

      upstream.on('message', (frame, upstreamBinary) => {
        if (upstreamBinary) return;
        const event = parseDashscope(frame);
        if (!event) return;
        if (event.event === 'task-started') {
          clearTimeout(startTimer);
          ready = true;
          for (const chunk of queued) upstream.send(chunk);
          queued = [];
          bytes = 0;
          send(client, { type: 'ready' });
          return;
        }
        if (event.event === 'task-failed') {
          send(client, { type: 'error', message: event.error || 'fun-asr failed' });
          closePair(client, upstream, 1011, 'upstream failed');
          return;
        }
        if (event.event === 'task-finished') {
          send(client, { type: 'closed' });
          closePair(client, upstream);
          return;
        }
        if (
          event.event === 'result-generated' &&
          !event.heartbeat &&
          event.text.trim()
        ) {
          send(client, {
            type: event.final ? 'final' : 'partial',
            id: event.id,
            text: event.text,
          });
        }
      });

      upstream.on('error', (err) => {
        console.error('[funasr-relay] upstream', err);
        send(client, { type: 'error', message: 'Fun-ASR connection failed' });
      });
      upstream.on('close', () => {
        if (client.readyState === WebSocket.OPEN) client.close(1011, 'upstream closed');
      });
      return;
    }

    if (!binary) {
      let value;
      try {
        value = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (value?.type === 'finish') {
        if (upstream?.readyState === WebSocket.OPEN && task) {
          upstream.send(JSON.stringify({
            header: { action: 'finish-task', task_id: task, streaming: 'duplex' },
            payload: { input: {} },
          }));
        }
        setTimeout(() => closePair(client, upstream), 300);
      }
      return;
    }

    if (!upstream || upstream.readyState !== WebSocket.OPEN || !ready) {
      const chunk = Buffer.from(data);
      queued.push(chunk);
      bytes += chunk.byteLength;
      while (bytes > MAX_QUEUE_BYTES && queued.length > 1) {
        bytes -= queued.shift().byteLength;
      }
      return;
    }
    upstream.send(data, { binary: true });
  });

  client.on('close', () => {
    clearTimeout(startTimer);
    closePair(client, upstream);
  });
  client.on('error', (err) => {
    console.error('[funasr-relay] client', err);
    closePair(client, upstream);
  });
}

const key = process.env.DASHSCOPE_API_KEY || '';
if (!key) {
  console.error('[funasr-relay] DASHSCOPE_API_KEY is not configured');
}

const tls = process.env.FUNASR_WS_KEY && process.env.FUNASR_WS_CERT
  ? createServer({
      key: readFileSync(process.env.FUNASR_WS_KEY),
      cert: readFileSync(process.env.FUNASR_WS_CERT),
    })
  : null;
const server = new WebSocketServer({
  ...(tls ? { server: tls } : { port: PORT }),
  path: PATH,
  maxPayload: 128 * 1024,
});

server.on('connection', (client, req) => {
  if (!key) {
    client.close(1011, 'Fun-ASR is not configured');
    return;
  }
  if (server.clients.size > MAX_CLIENTS) {
    client.close(1013, 'server busy');
    return;
  }
  const url = new URL(req.url || PATH, `http://${req.headers.host || 'localhost'}`);
  if (!verify(url.searchParams.get('token') || '', key)) {
    client.close(1008, 'invalid token');
    return;
  }
  handle(client, key);
});

server.on('listening', () => {
  console.log(`[funasr-relay] ${tls ? 'wss' : 'ws'}://127.0.0.1:${PORT}${PATH}`);
});
server.on('error', (err) => {
  console.error('[funasr-relay]', err);
  process.exitCode = 1;
});

setInterval(() => {
  const now = Date.now();
  for (const [nonce, exp] of used) {
    if (exp < now) used.delete(nonce);
  }
}, 60000).unref();

if (tls) tls.listen(PORT);
