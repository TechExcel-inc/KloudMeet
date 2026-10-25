/**
 * After `next build` with output: 'standalone', copy static assets Next expects
 * next to server.js. See: https://nextjs.org/docs/app/building-your-application/deploying#nodejs-server
 *
 * electron-builder: extraResources must use from ".next" + filter "standalone/**" (not from
 * ".next/standalone" alone). app-builder-lib/createFilter drops any root path "node_modules",
 * which would remove the entire Next standalone server deps (Cannot find module 'next').
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const standalone = path.join(root, '.next', 'standalone');
const serverJs = path.join(standalone, 'server.js');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    return;
  }
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

if (!fs.existsSync(serverJs)) {
  console.error('Missing .next/standalone/server.js. Run: npm run build');
  process.exit(1);
}

const staticSrc = path.join(root, '.next', 'static');
const staticDest = path.join(standalone, '.next', 'static');
const publicSrc = path.join(root, 'public');
const publicDest = path.join(standalone, 'public');

copyDir(staticSrc, staticDest);
copyDir(publicSrc, publicDest);

for (const file of ['run-next-with-funasr.cjs', 'funasr-relay.cjs']) {
  fs.copyFileSync(path.join(root, 'scripts', file), path.join(standalone, file));
}
// funasr-relay.cjs requires 'ws', which Next's file tracing does not pick up. Without it the
// relay crashes at start and the desktop app reports a startup failure, so stop here instead.
const wsSrc = path.join(root, 'node_modules', 'ws');
if (!fs.existsSync(path.join(wsSrc, 'package.json'))) {
  console.error("Missing node_modules/ws (needed by funasr-relay.cjs). Run the package install, then build again.");
  process.exit(1);
}
copyDir(wsSrc, path.join(standalone, 'node_modules', 'ws'));

const envProd = path.join(root, '.env.production');
const envProdDest = path.join(standalone, '.env.production');
if (fs.existsSync(envProd)) {
  fs.copyFileSync(envProd, envProdDest);
  console.log('standalone: copied .env.production');
}

const envLocal = path.join(root, '.env.local');
const envLocalDest = path.join(standalone, '.env.local');
if (fs.existsSync(envLocal)) {
  fs.copyFileSync(envLocal, envLocalDest);
  console.log(
    'standalone: copied .env.local (secrets end up in the installer; for release use CI secrets + .env.production)',
  );
}

console.log('standalone: copied static assets and Fun-ASR relay into .next/standalone');
