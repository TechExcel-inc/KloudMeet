import type { MeetingPresentation } from '@/lib/meetingPresentation';
import { shotAt, type ShareShot } from '@/lib/shareShot';

export async function printReplayWriting(
  presentation: MeetingPresentation,
  title: string,
  shots: ShareShot[],
  labels: { screenshot: string; unavailable: string; review: string },
) {
  const frame = document.createElement('iframe');
  frame.title = title;
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;border:0';
  document.body.append(frame);

  try {
    const printWindow = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!printWindow || !doc) throw new Error('Print document unavailable');
    doc.title = title;
    doc.documentElement.lang = presentation.language || document.documentElement.lang;
    const style = doc.createElement('style');
    style.textContent = `
      @page { margin: 18mm; }
      body { color: #182230; font: 11pt/1.55 system-ui, sans-serif; overflow-wrap: anywhere; }
      h1 { font-size: 24pt; line-height: 1.2; margin: 0 0 8mm; padding-bottom: 4mm; border-bottom: 1pt solid #ccd4df; }
      h2 { font-size: 15pt; line-height: 1.3; margin: 0 0 2mm; }
      h1, h2 { break-after: avoid; }
      section { margin-bottom: 6mm; }
      p { white-space: pre-wrap; margin: 0 0 3mm; orphans: 3; widows: 3; }
      figure { break-inside: avoid; margin: 4mm 0 6mm; }
      img { display: block; max-width: 100%; max-height: 130mm; width: auto; height: auto; margin: auto; }
      figcaption { color: #475467; font-size: 9pt; margin-top: 2mm; }
    `;
    doc.head.append(style);

    function append(parent: HTMLElement, tag: string, text?: string) {
      const el = doc!.createElement(tag);
      if (text) el.textContent = text;
      parent.append(el);
      return el;
    }

    append(doc.body, 'h1', title);
    const images: Promise<void>[] = [];
    const included = new Set<string>();
    for (const slide of presentation.slides) {
      const section = append(doc.body, 'section');
      append(section, 'h2', slide.title);
      append(section, 'p', slide.narration);
      if (slide.startSec === null) continue;
      const start = slide.startSec * 1000;
      const end = (slide.endSec ?? slide.startSec) * 1000;
      const active = shotAt(shots, start);
      const relevant = shots.filter(shot => shot === active || (shot.startMs >= start && shot.startMs <= end));
      for (const shot of relevant) {
        if (included.has(shot.url)) continue;
        included.add(shot.url);
        const figure = append(section, 'figure');
        const seconds = Math.floor(shot.startMs / 1000);
        const timestamp = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        const image = doc.createElement('img');
        image.alt = '';
        figure.append(image);
        const caption = append(figure, 'figcaption', `${labels.screenshot} · ${timestamp}`);
        images.push(new Promise<void>(resolve => {
          const unavailable = () => {
            image.remove();
            caption.textContent = `${labels.unavailable} · ${timestamp}`;
          };
          const timeout = window.setTimeout(() => { unavailable(); resolve(); }, 10000);
          image.onload = () => { window.clearTimeout(timeout); resolve(); };
          image.onerror = () => { window.clearTimeout(timeout); unavailable(); resolve(); };
          image.src = new URL(shot.url, window.location.href).href;
        }));
      }
    }
    if (presentation.reviewTerms?.length) {
      const review = append(doc.body, 'section');
      append(review, 'h2', labels.review);
      const list = append(review, 'ul');
      for (const term of presentation.reviewTerms) append(list, 'li', term);
    }
    await Promise.all(images);
    await doc.fonts.ready;
    printWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
    printWindow.print();
  } catch (error) {
    frame.remove();
    throw error;
  }
}
