import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Dev harness only: serves the desktop app's control bar (rc-bar.html, bundled with Electron). */
export async function GET() {
  if (process.env.NODE_ENV === 'production') return new Response('Not found', { status: 404 });
  const html = await readFile(path.join(process.cwd(), 'rc-bar.html'), 'utf8');
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
