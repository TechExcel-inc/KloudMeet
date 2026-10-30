/**
 * The file-type label before a LiveDoc document's name: the coloured "PPT" / "PDF" / "DOC" badges of
 * the Kloud V3 documents table (Kloud-Web kloudsync/FileList.vue, v3TypeBadge), same groups and labels.
 */

export type LiveDocFileGroup =
  | 'ppt'
  | 'pdf'
  | 'doc'
  | 'xls'
  | 'video'
  | 'audio'
  | 'image'
  | 'board'
  | 'other';

export interface LiveDocFileBadge {
  group: LiveDocFileGroup;
  label: string;
}

const EXTENSION_GROUPS: Array<[LiveDocFileGroup, string[]]> = [
  ['ppt', ['ppt', 'pptx', 'pps', 'ppsx', 'key']],
  ['pdf', ['pdf']],
  ['doc', ['doc', 'docx', 'txt', 'rtf', 'md', 'pages', 'odt']],
  ['xls', ['xls', 'xlsx', 'csv', 'numbers', 'ods']],
  ['video', ['mp4', 'mov', 'avi', 'm4v', 'webm', 'wmv', 'flv', 'mkv']],
  ['audio', ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']],
  ['image', ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'heic']],
];

/** LiveDoc's older icon paths (util.checkDocumentType), for names without an extension */
const ICON_BADGES: Record<string, LiveDocFileBadge> = {
  'ppt.svg': { group: 'ppt', label: 'PPT' },
  'google.slides.png': { group: 'ppt', label: 'PPT' },
  'pdf.svg': { group: 'pdf', label: 'PDF' },
  'doc.svg': { group: 'doc', label: 'DOC' },
  'txt.svg': { group: 'doc', label: 'DOC' },
  'md.svg': { group: 'doc', label: 'MD' },
  'google.docs.png': { group: 'doc', label: 'DOC' },
  'xls.svg': { group: 'xls', label: 'XLS' },
  'google.sheets.png': { group: 'xls', label: 'XLS' },
  'video.svg': { group: 'video', label: 'MP4' },
  'audio.svg': { group: 'audio', label: 'MP3' },
  'audio-file.svg': { group: 'audio', label: 'MP3' },
  'img.svg': { group: 'image', label: 'IMG' },
};

/**
 * The meeting whiteboard (a blank LiveDoc page). kloud.cn files it as an HTML item under this name and
 * gives it this icon (Kloud-Web googlemeet/MainStage.vue, MEETING_WB_FILENAME / MEETING_WB_ICON_PATH).
 */
const WHITEBOARD_FILE_NAME = 'kloud-whiteboard.html';
const WHITEBOARD_ICON = 'meeting-whiteboard-icon.svg';

function iconFileName(icon: string | null | undefined): string {
  return (icon || '').split(/[?#]/)[0].split('/').pop() || '';
}

function extensionOf(name: string | null | undefined): string {
  const match = /\.([a-z0-9]+)$/i.exec((name || '').trim());
  return match ? match[1].toLowerCase() : '';
}

function badgeForExtension(ext: string): LiveDocFileBadge {
  const group = EXTENSION_GROUPS.find(([, extensions]) => extensions.includes(ext))?.[0] ?? 'other';
  if (group === 'ppt') return { group, label: 'PPT' };
  if (group === 'doc' && ext !== 'md') return { group, label: 'DOC' };
  if (group === 'xls') return { group, label: 'XLS' };
  return { group, label: ext.slice(0, 4).toUpperCase() };
}

/** A whiteboard is BOARD; else the first name with an extension decides; else the icon LiveDoc chose; else FILE */
export function liveDocFileBadge(
  names: Array<string | null | undefined>,
  icon?: string | null,
): LiveDocFileBadge {
  const iconName = iconFileName(icon);
  if (
    iconName === WHITEBOARD_ICON ||
    names.some((name) => (name || '').trim().toLowerCase() === WHITEBOARD_FILE_NAME)
  ) {
    return { group: 'board', label: 'BOARD' };
  }
  for (const name of names) {
    const ext = extensionOf(name);
    if (ext) return badgeForExtension(ext);
  }
  return ICON_BADGES[iconName] ?? { group: 'other', label: 'FILE' };
}
