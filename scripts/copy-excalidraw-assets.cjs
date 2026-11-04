/**
 * Copies Excalidraw's fonts (Excalidraw boards, lib/whiteboard/) from node_modules into
 * public/excalidraw-assets, so the site serves them itself instead of the library's public CDN
 * fallback, which is slow or blocked for mainland visitors. Runs before `next dev` and
 * `next build`; the files are not committed (about 13 MB).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod', 'fonts');
const dest = path.join(root, 'public', 'excalidraw-assets', 'fonts');

if (!fs.existsSync(src)) {
  // Don't fail the build: boards still draw, text just falls back to the CDN fonts.
  console.warn('copy-excalidraw-assets: @excalidraw/excalidraw fonts not found');
  process.exit(0);
}
let copied = 0;
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(a, b);
      continue;
    }
    if (fs.existsSync(b) && fs.statSync(b).size === fs.statSync(a).size) continue;
    fs.copyFileSync(a, b);
    copied++;
  }
};
copyDir(src, dest);
if (copied) console.log('copy-excalidraw-assets: copied ' + copied + ' file(s) to public/excalidraw-assets');
