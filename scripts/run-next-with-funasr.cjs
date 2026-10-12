/**
 * Start Next.js and the Fun-ASR WebSocket relay as sibling processes.
 *
 * Development:
 *   node scripts/run-next-with-funasr.cjs dev -p 3201 --turbopack
 * Production:
 *   node scripts/run-next-with-funasr.cjs start -p 3201 -H 0.0.0.0
 * Standalone:
 *   node run-next-with-funasr.cjs standalone
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const mode = process.argv[2] || 'start';
const args = process.argv.slice(3);
const dev = mode === 'dev';
const root = mode === 'standalone' ? __dirname : path.join(__dirname, '..');

require('@next/env').loadEnvConfig(root, dev);

const relayEnv = { ...process.env };
const keyIndex = args.indexOf('--experimental-https-key');
const certIndex = args.indexOf('--experimental-https-cert');
if (keyIndex >= 0 && args[keyIndex + 1] && certIndex >= 0 && args[certIndex + 1]) {
  relayEnv.FUNASR_WS_KEY = path.resolve(root, args[keyIndex + 1]);
  relayEnv.FUNASR_WS_CERT = path.resolve(root, args[certIndex + 1]);
}

const relay = spawn(process.execPath, [path.join(__dirname, 'funasr-relay.cjs')], {
  cwd: root,
  env: relayEnv,
  stdio: 'inherit',
});

const next = mode === 'standalone'
  ? spawn(process.execPath, [path.join(root, 'server.js')], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    })
  : spawn(process.execPath, [require.resolve('next/dist/bin/next'), mode, ...args], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });

let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  relay.kill();
  next.kill();
  setTimeout(() => process.exit(code), 300);
}

relay.on('exit', (code) => {
  if (!stopping) stop(code || 1);
});
next.on('exit', (code) => {
  if (!stopping) stop(code || 0);
});

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
