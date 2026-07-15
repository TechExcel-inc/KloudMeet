/**
 * 确保 Electron 二进制已下载；国内默认走 npmmirror，避免 electron:dist 卡在静默下载。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const electronDir = path.join(root, 'node_modules', 'electron');
const pathTxt = path.join(electronDir, 'path.txt');
const distDir = path.join(electronDir, 'dist');
const installJs = path.join(electronDir, 'install.js');

if (!process.env.ELECTRON_MIRROR) {
  process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
}
if (!process.env.ELECTRON_BUILDER_BINARIES_MIRROR) {
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
    'https://npmmirror.com/mirrors/electron-builder-binaries/';
}

function electronReady() {
  if (!fs.existsSync(installJs)) {
    console.error('ensure-electron: 未找到 node_modules/electron，请先 npm/pnpm install');
    process.exit(1);
  }
  if (fs.existsSync(pathTxt)) {
    const rel = fs.readFileSync(pathTxt, 'utf8').trim();
    const exe = path.isAbsolute(rel) ? rel : path.join(electronDir, 'dist', rel);
    if (fs.existsSync(exe)) {
      return true;
    }
  }
  if (fs.existsSync(distDir)) {
    const names = fs.readdirSync(distDir);
    if (names.some((n) => n === 'electron.exe' || n === 'Electron.app' || n === 'electron')) {
      return true;
    }
  }
  return false;
}

if (electronReady()) {
  console.log('ensure-electron: Electron 二进制已就绪');
  console.log(`ensure-electron: ELECTRON_MIRROR=${process.env.ELECTRON_MIRROR}`);
  process.exit(0);
}

console.log('ensure-electron: 正在下载 Electron 二进制…');
console.log(`ensure-electron: ELECTRON_MIRROR=${process.env.ELECTRON_MIRROR}`);

const result = spawnSync(process.execPath, [installJs], {
  cwd: electronDir,
  env: process.env,
  stdio: 'inherit',
});

if (result.status !== 0) {
  console.error(
    'ensure-electron: 下载失败。可手动设置镜像后重试：\n' +
      '  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/\n' +
      '  node node_modules/electron/install.js',
  );
  process.exit(result.status || 1);
}

if (!electronReady()) {
  console.error('ensure-electron: install.js 已执行但仍未找到 Electron 可执行文件');
  process.exit(1);
}

console.log('ensure-electron: 下载完成');
