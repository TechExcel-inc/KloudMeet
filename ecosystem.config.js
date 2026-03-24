/**
 * PM2 生产环境示例（部署到服务器后把 cwd 改成你的实际目录）
 *
 * 启动：pm2 start ecosystem.config.js
 * 保存：pm2 save
 * 开机自启：pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'sky-meet',
      cwd: __dirname,
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3201,
      },
    },
  ],
};
