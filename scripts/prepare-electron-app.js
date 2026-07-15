/**
 * 生成精简 Electron 工程目录 `.electron-app`，供 `electron-builder --project .electron-app` 使用。
 *
 * 根 package.json 的 production 依赖含 Next/LiveKit/Prisma 等；若以仓库根为 project，
 * electron-builder 会把近 1GB 依赖打进 asar，打包阶段长时间无输出像「卡住」。
 * 主进程只需 electron-updater 与 @nut-tree-fork/nut-js（传递依赖约 35MB）。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, '.electron-app');
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const ENTRY_DEPS = ['electron-updater', '@nut-tree-fork/nut-js'];

const SKIP_PACKAGE_NAMES = new Set([
  '@nut-tree-fork/libnut-darwin',
  '@nut-tree-fork/libnut-linux',
  '@nut-tree-fork/node-mac-permissions',
]);

const SHELL_FILES = [
  'main.js',
  'preload.js',
  'update-progress.html',
  'update-progress-preload.js',
  'update-ready.html',
  'update-ready-preload.js',
];

function packageJsonPath(name) {
  const parts = name.startsWith('@') ? name.split('/') : [name];
  const candidates = [path.join(root, 'node_modules', ...parts, 'package.json')];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  try {
    const resolved = require.resolve(`${name}/package.json`, { paths: [root] });
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  } catch {
    /* exports 可能禁止 package.json */
  }
  try {
    const mainPath = require.resolve(name, { paths: [root] });
    let dir = path.dirname(mainPath);
    for (let i = 0; i < 8; i += 1) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name === name) {
          return pkgPath;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  } catch {
    /* optional native missing */
  }
  return null;
}

function collectDeps(entryNames) {
  const seen = new Set();
  const queue = [...entryNames];
  while (queue.length > 0) {
    const name = queue.pop();
    if (!name || seen.has(name) || SKIP_PACKAGE_NAMES.has(name)) {
      continue;
    }
    seen.add(name);
    const pkgPath = packageJsonPath(name);
    if (!pkgPath) {
      if (name.startsWith('@nut-tree-fork/libnut-') || name.includes('mac-permissions')) {
        continue;
      }
      console.warn(`prepare-electron-app: 跳过未安装依赖 ${name}`);
      continue;
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const next = {
      ...(pkg.dependencies || {}),
      ...(pkg.optionalDependencies || {}),
    };
    for (const dep of Object.keys(next)) {
      if (!seen.has(dep) && !SKIP_PACKAGE_NAMES.has(dep)) {
        queue.push(dep);
      }
    }
  }
  return seen;
}

function rmDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function copyPackage(name) {
  const pkgPath = packageJsonPath(name);
  if (!pkgPath) {
    return;
  }
  const srcDir = path.dirname(pkgPath);
  const parts = name.startsWith('@') ? name.split('/') : [name];
  const destDir = path.join(outDir, 'node_modules', ...parts);
  rmDir(destDir);
  copyDir(srcDir, destDir);
}

function electronVersion() {
  const raw = rootPkg.devDependencies?.electron || rootPkg.dependencies?.electron || '';
  const m = String(raw).match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : '41.0.3';
}

console.log('prepare-electron-app: 收集主进程依赖…');
const deps = collectDeps(ENTRY_DEPS);
console.log(`prepare-electron-app: ${deps.size} 个包`);

rmDir(outDir);
fs.mkdirSync(outDir, { recursive: true });

for (const file of SHELL_FILES) {
  const src = path.join(root, file);
  if (!fs.existsSync(src)) {
    console.error(`prepare-electron-app: 缺少 ${file}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(outDir, file));
}

const slimDeps = {};
for (const name of ENTRY_DEPS) {
  const ver = rootPkg.dependencies?.[name] || rootPkg.devDependencies?.[name];
  if (!ver) {
    console.error(`prepare-electron-app: 根 package.json 缺少依赖 ${name}`);
    process.exit(1);
  }
  slimDeps[name] = ver;
}

const rootBuild = rootPkg.build || {};
const slimPkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  description: rootPkg.description,
  author: rootPkg.author,
  private: true,
  main: 'main.js',
  dependencies: slimDeps,
  build: {
    appId: rootBuild.appId,
    productName: rootBuild.productName,
    electronVersion: electronVersion(),
    protocols: rootBuild.protocols,
    directories: {
      output: '../dist',
    },
    npmRebuild: false,
    files: [
      'main.js',
      'preload.js',
      'update-progress.html',
      'update-progress-preload.js',
      'update-ready.html',
      'update-ready-preload.js',
      'package.json',
      '!node_modules/@nut-tree-fork/libnut-darwin/**',
      '!node_modules/@nut-tree-fork/libnut-linux/**',
      '!node_modules/@nut-tree-fork/node-mac-permissions/**',
    ],
    asarUnpack: rootBuild.asarUnpack || [
      '**/*.node',
      '**/node_modules/@nut-tree-fork/**',
    ],
    extraResources: [
      {
        from: '../.next',
        to: '.',
        filter: ['standalone', 'standalone/**/*'],
      },
    ],
    publish: rootBuild.publish,
    win: rootBuild.win,
    nsis: rootBuild.nsis,
    mac: rootBuild.mac,
  },
};

fs.writeFileSync(path.join(outDir, 'package.json'), `${JSON.stringify(slimPkg, null, 2)}\n`);

// 让 electron-builder 用 npm/traversal 解析本目录，而不是回退到仓库根的 pnpm 工作区
fs.writeFileSync(
  path.join(outDir, 'package-lock.json'),
  `${JSON.stringify(
    {
      name: slimPkg.name,
      version: slimPkg.version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: slimPkg.name,
          version: slimPkg.version,
          dependencies: slimDeps,
        },
      },
    },
    null,
    2,
  )}\n`,
);

for (const name of [...deps].sort()) {
  copyPackage(name);
}

let bytes = 0;
function measure(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      measure(p);
    } else {
      try {
        bytes += fs.statSync(p).size;
      } catch {
        /* ignore */
      }
    }
  }
}
measure(outDir);
console.log(
  `prepare-electron-app: 已写入 ${outDir}（约 ${(bytes / (1024 * 1024)).toFixed(1)} MB）`,
);
