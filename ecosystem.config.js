/**
 * PM2：同时跑 Next standalone 和 Fun-ASR WebSocket 中继。
 *
 * 本地发布前：
 *   npm run build:deploy
 * 上传整个 `.next/standalone/` 到服务器（覆盖同目录），并带上本文件。
 * 百炼密钥从 standalone 目录里的 `.env.local` 或 `.env.production` 读取。
 *
 * 第一次换成双进程：
 *   pm2 delete sky-meet && pm2 start ecosystem.config.js && pm2 save
 * 以后：
 *   pm2 restart sky-meet
 *   pm2 restart funasr-relay
 */
const fs = require('fs');
const path = require('path');

const standalone = path.join(__dirname, '.next', 'standalone');

function readDashscopeKey() {
  for (const name of ['.env.production', '.env.local']) {
    const file = path.join(standalone, name);
    if (!fs.existsSync(file)) continue;
    const matched = fs.readFileSync(file, 'utf8').match(/^DASHSCOPE_API_KEY=(.*)$/m);
    if (matched && matched[1].trim()) return matched[1].trim();
  }
  return '';
}

module.exports = {
  apps: [
    {
      name: 'sky-meet',
      cwd: standalone,
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3201,
        HOSTNAME: '0.0.0.0',
      },
    },
    {
      name: 'funasr-relay',
      cwd: standalone,
      script: 'funasr-relay.cjs',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      env: {
        FUNASR_WS_PORT: 3202,
        DASHSCOPE_API_KEY: readDashscopeKey(),
      },
    },
  ],
};
