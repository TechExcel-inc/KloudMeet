const FILE_TYPE_ICON_BASE = '/images/file-types';

/** Dev `util.checkDocumentType` 返回的相对路径前缀 */
const DEV_RELATIVE_PREFIXES = [
  '../../../static/assets/images/',
  '../../static/assets/images/',
  '/static/assets/images/',
  'static/assets/images/',
];

const KNOWN_ICONS = new Set([
  'no.svg',
  'video.svg',
  'audio.svg',
  'audio-file.svg',
  'img.svg',
  'doc.svg',
  'xls.svg',
  'ppt.svg',
  'pdf.svg',
  'txt.svg',
  'md.svg',
  'js.svg',
  'zip.svg',
  'html.svg',
  'svg.svg',
  'xmind.svg',
  'xd.svg',
  'sketch.svg',
  'rp.svg',
  'ps.svg',
  'ICO.svg',
  'ai.svg',
  'google.docs.png',
  'google.sheets.png',
  'google.slides.png',
]);

function iconUrl(fileName: string): string {
  return `${FILE_TYPE_ICON_BASE}/${fileName}`;
}

/**
 * 将 Dev iframe 传来的 FileImg / checkDocumentType 路径，转为 SkyMeet 可访问的本地图标地址。
 * 远程 http(s) 缩略图原样返回；未知相对路径回退到 no.svg。
 */
export function resolveLiveDocFileImg(value?: string | null): string {
  const raw = (value || '').trim();
  if (!raw) return iconUrl('no.svg');

  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) {
    return raw;
  }

  for (const prefix of DEV_RELATIVE_PREFIXES) {
    if (raw.startsWith(prefix)) {
      const fileName = raw.slice(prefix.length).split('?')[0].split('#')[0];
      if (KNOWN_ICONS.has(fileName)) return iconUrl(fileName);
      // css.svg 等缺失资源回退
      return iconUrl('no.svg');
    }
  }

  // 已是 SkyMeet public 路径
  if (raw.startsWith(`${FILE_TYPE_ICON_BASE}/`)) {
    return raw;
  }

  // 仅文件名（如 pdf.svg / pdf）
  const bare = raw.replace(/^\.\//, '');
  if (KNOWN_ICONS.has(bare)) return iconUrl(bare);
  if (KNOWN_ICONS.has(`${bare}.svg`)) return iconUrl(`${bare}.svg`);

  return iconUrl('no.svg');
}

/** 按文件名推断类型图标（无 FileImg 时使用） */
export function resolveLiveDocFileImgByName(fileName?: string | null): string {
  const name = (fileName || '').trim();
  if (!name) return iconUrl('no.svg');

  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
  const map: Record<string, string> = {
    mp4: 'video.svg',
    mp3: 'audio.svg',
    wav: 'audio.svg',
    aac: 'audio.svg',
    jpg: 'img.svg',
    jpeg: 'img.svg',
    jpe: 'img.svg',
    png: 'img.svg',
    doc: 'doc.svg',
    docx: 'doc.svg',
    xls: 'xls.svg',
    xlsx: 'xls.svg',
    ppt: 'ppt.svg',
    pptx: 'ppt.svg',
    pdf: 'pdf.svg',
    txt: 'txt.svg',
    md: 'md.svg',
    js: 'js.svg',
    zip: 'zip.svg',
    rar: 'zip.svg',
    html: 'html.svg',
    svg: 'svg.svg',
    xmind: 'xmind.svg',
    xd: 'xd.svg',
    sketch: 'sketch.svg',
    rp: 'rp.svg',
    ps: 'ps.svg',
    psd: 'ps.svg',
    ico: 'ICO.svg',
    ai: 'ai.svg',
  };
  return iconUrl(map[ext] || 'no.svg');
}
