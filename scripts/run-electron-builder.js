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

/**
 * macOS：npmmirror 上没有 dmg-builder 的 dmgbuild-bundle（404），
 * 而它走 @electron/get，会被 ELECTRON_MIRROR 改写地址。
 * 这里先临时用 GitHub 地址预下载到 electron-builder 缓存，
 * 之后打包直接命中缓存；Electron 本体仍走国内镜像。
 */
async function prefetchDmgBuilderBundle() {
  const fs = require('fs');
  const dmgUtilPath = require.resolve('dmg-builder/out/dmgUtil.js');
  const src = fs.readFileSync(dmgUtilPath, 'utf8');
  const releaseName = (src.match(/releaseName:\s*"(dmg-builder@[^"]+)"/) || [])[1];
  const checksums = {};
  for (const m of src.matchAll(/"(dmgbuild-bundle-[^"]+\.tar\.gz)":\s*"([0-9a-f]{64})"/g)) {
    checksums[m[1]] = m[2];
  }
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const filenameWithExt = Object.keys(checksums).find((f) =>
    f.startsWith(`dmgbuild-bundle-${arch}-`),
  );
  if (!releaseName || !filenameWithExt) {
    console.warn('[run-electron-builder] dmg-builder bundle info not found; skip prefetch');
    return;
  }

  const mirrorVars = [
    'ELECTRON_MIRROR',
    'NPM_CONFIG_ELECTRON_MIRROR',
    'npm_config_electron_mirror',
    'npm_package_config_electron_mirror',
  ];
  const saved = Object.fromEntries(mirrorVars.map((k) => [k, process.env[k]]));
  for (const k of mirrorVars) delete process.env[k];
  process.env.ELECTRON_MIRROR =
    'https://github.com/electron-userland/electron-builder-binaries/releases/download/';
  try {
    const { downloadArtifact } = require('app-builder-lib/out/binDownload');
    await downloadArtifact({ releaseName, filenameWithExt, checksums });
    console.log(`[run-electron-builder] dmg-builder bundle ready: ${filenameWithExt}`);
  } catch (err) {
    console.warn(`[run-electron-builder] dmg-builder prefetch failed: ${err.message}`);
  } finally {
    for (const k of mirrorVars) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

(async () => {
  if (args.includes('--mac') && process.platform === 'darwin') {
    await prefetchDmgBuilderBundle();
  }
  const result = runBuilder(args);
  process.exit(result.status == null ? 1 : result.status);
})();
