/**
 * Copies MediaPipe's vision wasm (camera backgrounds, lib/videoBackground.ts) from node_modules
 * into public/mediapipe/wasm, so the site serves it itself: the library's default jsDelivr URL
 * is slow or blocked for mainland visitors. Runs before `next dev` and `next build`; the files
 * are not committed (about 19 MB).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'public', 'mediapipe', 'wasm');
// Hoisted by npm/pnpm to the root; nested under the LiveKit package otherwise.
const src = [
  path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'),
  path.join(root, 'node_modules', '@livekit', 'track-processors', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'),
].find((dir) => fs.existsSync(dir));

if (!src) {
  // Don't fail the build: the camera still works, backgrounds just report that they couldn't start.
  console.warn('copy-mediapipe-wasm: @mediapipe/tasks-vision not found; camera backgrounds will not work');
  process.exit(0);
}
fs.mkdirSync(dest, { recursive: true });
let copied = 0;
for (const name of fs.readdirSync(src)) {
  const from = path.join(src, name);
  const to = path.join(dest, name);
  const same = fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size;
  if (same) continue;
  fs.copyFileSync(from, to);
  copied++;
}
if (copied) console.log('copy-mediapipe-wasm: copied ' + copied + ' file(s) to public/mediapipe/wasm');
