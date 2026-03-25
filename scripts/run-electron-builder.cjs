/**
 * electron-builder 只要发现根目录存在 pnpm-lock.yaml 就会调用 pnpm；
 * 本机只用 npm 时会失败。打包期间临时移走该文件，结束后自动还原。
 * 仓库与日常开发仍可保留 pnpm-lock.yaml。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const lockPath = path.join(root, 'pnpm-lock.yaml');
const hiddenPath = path.join(root, 'pnpm-lock.yaml.__eb_hide__');

let didHide = false;

function hidePnpmLock() {
  if (fs.existsSync(lockPath)) {
    fs.renameSync(lockPath, hiddenPath);
    didHide = true;
  }
}

function restorePnpmLock() {
  if (didHide && fs.existsSync(hiddenPath)) {
    fs.renameSync(hiddenPath, lockPath);
    didHide = false;
  }
}

hidePnpmLock();

const ebCli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
const extraArgs = process.argv.slice(2);
const args = [ebCli, ...extraArgs];

const result = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

restorePnpmLock();

process.exit(result.status === null ? 1 : result.status);
