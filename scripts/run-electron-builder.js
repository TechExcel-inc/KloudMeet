/**
 * 带国内镜像启动 electron-builder（Windows 下 npm script 无法把 ensure 里的 env 传到后续命令）。
 */
const { spawnSync } = require('child_process');
const path = require('path');

if (!process.env.ELECTRON_MIRROR) {
  process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
}
if (!process.env.ELECTRON_BUILDER_BINARIES_MIRROR) {
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
    'https://npmmirror.com/mirrors/electron-builder-binaries/';
}

const args = process.argv.slice(2);
const cli = require.resolve('electron-builder/cli.js');
const result = spawnSync(process.execPath, [cli, ...args], {
  cwd: path.join(__dirname, '..'),
  env: process.env,
  stdio: 'inherit',
});

process.exit(result.status == null ? 1 : result.status);
