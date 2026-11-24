import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { Recording, RecordingSection } from '@prisma/client';
import type { MeetingPresentation } from '@/lib/meetingPresentation';
import { storeClient } from '@/lib/objectStore';
import { shotAnchor, shotAt } from '@/lib/shareShot';

const execute = promisify(execFile);
const escape = (text: string) => text.replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]!));

async function chromiumPath() {
  if (process.env.LIVEDOC_PDF_CHROMIUM_PATH) return process.env.LIVEDOC_PDF_CHROMIUM_PATH;
  const paths = process.platform === 'win32'
    ? [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean).flatMap(root => [
        join(root!, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(root!, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ])
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/chromium', '/usr/bin/google-chrome'];
  for (const path of paths) {
    if (await access(path).then(() => true, () => false)) return path;
  }
  throw new Error('Chromium is unavailable for PDF generation');
}

type Shot = Pick<RecordingSection, 'storageKey' | 'startMs' | 'endMs'>;

export async function renderReplayWritingPdf(
  presentation: MeetingPresentation,
  title: string,
  recording: Pick<Recording, 'createdAt' | 'livedocStartedAt' | 'mediaStartedAt'>,
  sections: Shot[],
) {
  const executable = await chromiumPath();
  const offset = shotAnchor(recording).getTime() - (recording.mediaStartedAt ?? recording.createdAt).getTime();
  const shots = sections.flatMap(section => section.startMs === null ? [] : [{
    url: section.storageKey,
    startMs: section.startMs + offset,
    endMs: section.endMs === null ? null : section.endMs + offset,
  }]).sort((a, b) => a.startMs - b.startMs);
  const included = new Set<string>();
  const store = storeClient();
  const directory = await mkdtemp(join(tmpdir(), 'ai-write-pdf-'));
  try {
    const content = [];
    for (const slide of presentation.slides) {
      const figures: string[] = [];
      if (slide.startSec !== null) {
        const start = slide.startSec * 1000;
        const end = (slide.endSec ?? slide.startSec) * 1000;
        const active = shotAt(shots, start);
        for (const shot of shots.filter(shot => shot === active || (shot.startMs >= start && shot.startMs <= end))) {
          if (included.has(shot.url)) continue;
          included.add(shot.url);
          const image = await store.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: shot.url }), {
            abortSignal: AbortSignal.timeout(15000),
          });
          const bytes = await image.Body?.transformToByteArray();
          if (!bytes?.length) throw new Error('Could not read meeting screenshot');
          const seconds = Math.floor(Math.max(0, shot.startMs) / 1000);
          const timestamp = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
          figures.push(`<figure><img alt="" src="data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}"><figcaption>${timestamp}</figcaption></figure>`);
        }
      }
      content.push(`<section><h2>${escape(slide.title)}</h2><p>${escape(slide.narration)}</p>${figures.join('')}</section>`);
    }
    const review = presentation.reviewTerms?.length ? `<section><h2>${escape(presentation.language.startsWith('zh') ? '待核对的名称和术语' : 'Names and terms to review')}</h2><ul>${presentation.reviewTerms.map(term => `<li>${escape(term)}</li>`).join('')}</ul></section>` : '';
    const html = `<!doctype html><html lang="${escape(presentation.language)}"><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
      <title>${escape(title)}</title><style>
      @page { margin: 18mm }
      body { color: #182230; font: 11pt/1.55 "Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif; overflow-wrap: anywhere }
      h1 { font-size: 24pt; line-height: 1.2; margin: 0 0 8mm; padding-bottom: 4mm; border-bottom: 1pt solid #ccd4df }
      h2 { font-size: 15pt; line-height: 1.3; margin: 0 0 2mm }
      h1, h2 { break-after: avoid }
      section { margin-bottom: 6mm }
      p { white-space: pre-wrap; margin: 0 0 3mm; orphans: 3; widows: 3 }
      figure { break-inside: avoid; margin: 4mm 0 6mm }
      img { display: block; max-width: 100%; max-height: 130mm; width: auto; height: auto; margin: auto }
      figcaption { color: #475467; font-size: 9pt; margin-top: 2mm }
      </style><body><h1>${escape(title)}</h1>${content.join('')}${review}</body></html>`;
    const input = join(directory, 'write.html');
    const output = join(directory, 'write.pdf');
    await writeFile(input, html, { mode: 0o600 });
    await execute(executable, [
      '--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run',
      `--user-data-dir=${join(directory, 'profile')}`, '--no-pdf-header-footer',
      `--print-to-pdf=${output}`, pathToFileURL(input).href,
    ], { timeout: 60000, windowsHide: true });
    const bytes = await readFile(output);
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF output');
    return bytes;
  } finally {
    store.destroy();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
  }
}
