/**
 * 给 Windows 未打包目录里的 KloudMeet.exe 写入图标/版本信息。
 * 用「复制 → rcedit 临时文件 → 覆盖回原 exe」；绝不先删原文件。
 *
 * 用法:
 *   node scripts/electron-fix-win-icon.js
 *   node scripts/electron-fix-win-icon.js D:\...\dist\win-unpacked\KloudMeet.exe
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function findRcedit() {
  const base = path.join(
    process.env.LOCALAPPDATA || '',
    'electron-builder',
    'Cache',
    'winCodeSign',
  );
  if (!fs.existsSync(base)) return null;
  const dirs = fs
    .readdirSync(base)
    .filter((d) => d.startsWith('winCodeSign-'))
    .sort()
    .reverse();
  for (const d of dirs) {
    const candidate = path.join(base, d, 'rcedit-x64.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findIcon(projectDir) {
  const candidates = [
    path.join(projectDir, 'build', 'icon.ico'),
    path.join(projectDir, '.electron-app', 'build', 'icon.ico'),
    path.join(projectDir, 'build', 'icon.png'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function readVersion(projectDir) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'),
    );
    if (pkg.version) return String(pkg.version);
  } catch {
    /* ignore */
  }
  return '0.2.5';
}

function buildArgs(targetExe, icon, version) {
  const args = [
    targetExe,
    '--set-version-string',
    'FileDescription',
    'Kloud Meet',
    '--set-version-string',
    'ProductName',
    'Kloud Meet',
    '--set-version-string',
    'LegalCopyright',
    `Copyright © ${new Date().getFullYear()} Kloud`,
    '--set-file-version',
    version,
    '--set-product-version',
    `${version}.0`,
    '--set-version-string',
    'InternalName',
    'KloudMeet',
    '--set-version-string',
    'CompanyName',
    'Kloud',
  ];
  if (icon) args.push('--set-icon', icon);
  return args;
}

/** 若原 exe 丢失，尝试从残留临时文件恢复 */
function recoverExeIfMissing(exe) {
  if (fs.existsSync(exe)) return true;
  const dir = path.dirname(exe);
  const base = path.basename(exe);
  let candidates = [];
  try {
    candidates = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith(`${base}.icon-tmp-`) && n.endsWith('.exe'))
      .map((n) => path.join(dir, n));
  } catch {
    return false;
  }
  if (!candidates.length) return false;
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  try {
    fs.copyFileSync(candidates[0], exe);
    console.warn(`[fix-win-icon] recovered exe from ${candidates[0]}`);
    return true;
  } catch (e) {
    console.warn(`[fix-win-icon] recover failed: ${e.message}`);
    return false;
  }
}

function safeUnlink(file) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} exe
 * @param {{ projectDir?: string, attempts?: number, initialDelayMs?: number }} [opts]
 * @returns {Promise<boolean>}
 */
async function fixWinExeIcon(exe, opts = {}) {
  const projectDir = opts.projectDir || path.join(__dirname, '..');
  const attempts = opts.attempts ?? 8;
  const initialDelayMs = opts.initialDelayMs ?? 1500;

  if (!recoverExeIfMissing(exe)) {
    console.warn(`[fix-win-icon] skip: missing ${exe}`);
    return false;
  }

  const rcedit = findRcedit();
  if (!rcedit) {
    console.warn('[fix-win-icon] skip: rcedit-x64.exe not found');
    return false;
  }

  const icon = findIcon(projectDir);
  const version = readVersion(projectDir);
  if (initialDelayMs > 0) await sleep(initialDelayMs);

  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (!recoverExeIfMissing(exe)) {
      lastErr = new Error(`missing ${exe}`);
      console.warn(`[fix-win-icon] attempt ${attempt} failed: ${lastErr.message}`);
      await sleep(1000 * attempt);
      continue;
    }

    const tmp = path.join(
      path.dirname(exe),
      `${path.basename(exe)}.icon-tmp-${process.pid}-${attempt}.exe`,
    );
    try {
      safeUnlink(tmp);
      fs.copyFileSync(exe, tmp);
      execFileSync(rcedit, buildArgs(tmp, icon, version), {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // 关键：覆盖写回原路径，绝不先删原 exe
      fs.copyFileSync(tmp, exe);
      safeUnlink(tmp);

      console.log(
        `[fix-win-icon] ok (attempt ${attempt})${icon ? ` icon=${icon}` : ''}`,
      );
      return true;
    } catch (e) {
      lastErr = e;
      const msg = e.stderr?.toString?.() || e.message || String(e);
      console.warn(`[fix-win-icon] attempt ${attempt} failed: ${msg.trim()}`);
      // 原 exe 还在就清临时文件；若原 exe 已丢则保留 tmp 供恢复
      if (fs.existsSync(exe)) {
        safeUnlink(tmp);
      }
      await sleep(1000 * attempt);
    }
  }

  console.warn(`[fix-win-icon] gave up: ${lastErr?.message || lastErr}`);
  return false;
}

async function main() {
  const projectDir = path.join(__dirname, '..');
  const exe =
    process.argv[2] ||
    path.join(projectDir, 'dist', 'win-unpacked', 'KloudMeet.exe');
  const ok = await fixWinExeIcon(exe, { projectDir, initialDelayMs: 500 });
  process.exit(ok ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { fixWinExeIcon, findRcedit, findIcon };
