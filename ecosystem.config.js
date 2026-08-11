/**
 * PM2：跑 Next standalone（部署更轻，不必同步整份 node_modules）
 *
 * 本地发布前：
 *   npm run build:deploy
 * 上传整个 `.next/standalone/` 到服务器（覆盖同目录），并带上本文件。
 * 环境变量：把 `.env.local` / `.env.production` 放进 standalone 目录，
 * 或写在下面的 env 里。
 *
 * 启动：pm2 start ecosystem.config.js
 * 更新后：pm2 delete sky-meet && pm2 start ecosystem.config.js && pm2 save
 */
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'sky-meet',
      cwd: path.join(__dirname, '.next', 'standalone'),
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
  ],
};
