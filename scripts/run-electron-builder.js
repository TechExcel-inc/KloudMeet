/**
 * 带国内镜像启动 electron-builder。
 * Windows：二阶段打包 —— dir → 写 exe 图标 → 再 nsis
 *（避免打包瞬间 exe 被锁导致 rcedit 失败）。
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

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const cli = require.resolve('electron-builder/cli.js');

function runBuilder(builderArgs) {
  return spawnSync(process.execPath, [cli, ...builderArgs], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
}

const isWin = args.includes('--win');
const alreadyPrepackaged = args.includes('--prepackaged');

if (isWin && !alreadyPrepackaged) {
  console.log('[run-electron-builder] Win two-phase: dir → fix icon → nsis');

  const phase1 = runBuilder([...args, '--config.win.target=dir']);
  if (phase1.status !== 0) {
    process.exit(phase1.status == null ? 1 : phase1.status);
  }

  const fix = spawnSync(
    process.execPath,
    [path.join(__dirname, 'electron-fix-win-icon.js')],
    { cwd: root, env: process.env, stdio: 'inherit' },
  );
  if (fix.status !== 0) {
    console.warn(
      '[run-electron-builder] icon fix failed; NSIS will use current exe resources',
    );
  }

  const projectIdx = args.indexOf('--project');
  const projectArgs =
    projectIdx >= 0 && args[projectIdx + 1]
      ? ['--project', args[projectIdx + 1]]
      : [];

  const phase2 = runBuilder([
    ...projectArgs,
    '--win',
    'nsis',
    '--prepackaged',
    path.join(root, 'dist', 'win-unpacked'),
  ]);
  process.exit(phase2.status == null ? 1 : phase2.status);
}

const result = runBuilder(args);
process.exit(result.status == null ? 1 : result.status);
