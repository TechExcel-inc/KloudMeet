'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from './i18n';
import { liveDocFileBadge } from './liveDocFileBadge';
import type {
  LiveDocAiPickerKind,
  LiveDocAiState,
  LiveDocAiTab,
  LiveDocAiTranscriptItem,
} from './liveDocAiProtocol';
import { authFetch } from './kloudSession';
import { roomAuthHeaders } from './roomAuth';
import type { LiveDocUploadQueue } from './useLiveDocUploadQueue';
import styles from '../styles/LiveDocAiPanel.module.css';

/** The design link shown on the meeting stage (Design mode); listed above the LiveDocs. */
export interface LiveDocDesignItem {
  /** Figma file name or the site's host */
  label: string;
  /** Already translated, e.g. "Figma design" or "Web page" */
  kindLabel: string;
  kind: 'figma' | 'web';
  setByName?: string;
  /** The stage is showing it right now */
  showing: boolean;
}

interface LiveDocAiBubblePos {
  top: number;
  left: number;
  width: number;
  height: number;
  arrowLeft: number;
}

interface LiveDocAiPanelProps {
  open: boolean;
  state: LiveDocAiState | null;
  connected: boolean;
  error: string;
  busy: boolean;
  bubblePos: LiveDocAiBubblePos | null;
  /** 当前是否已在 LiveDoc 主视图；否时切换文档需确认 */
  isLiveDocView: boolean;
  onClose: () => void;
  onClearError: () => void;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<void>;
  /** Files from this computer (picked or pasted): uploaded one by one, with the ones not added listed */
  uploads: LiveDocUploadQueue;
  onOpenDocument: (itemId: number) => void;
  /** LiveKit participant JWT，用于拉取本场聊天 */
  livekitToken?: string;
  /**
   * LiveDoc 只接受主持人 / 联席主持人（role 5）的 AI 操作；其他人只读：
   * 可看文档列表、摘要、转写，不显示上传、删除、切换、生成等操作。
   */
  canManage?: boolean;
  /** Bump `nonce` to switch the panel to `tab` (e.g. the recording sheet's Live transcript) */
  requestedTab?: { tab: LiveDocAiTab; nonce: number } | null;
  /** Design mode: the shared link, shown as a row above the documents */
  designItem?: LiveDocDesignItem | null;
  /** Switch the stage to the design (only for people who may switch views) */
  onShowDesign?: () => void;
  /** "Link" next to the upload options opens "Show a link" (only for people who may switch views) */
  onAddDesignLink?: () => void;
}

interface MeetingCaption {
  id: string;
  speakerName: string;
  content: string;
  offsetSeconds: number | null;
  captionTimeMs: number | null;
}

interface CaptionGroup {
  speaker: string;
  items: MeetingCaption[];
}

/** Speaker avatar tones (.tone0–5), the calm set of the replay page and the mini window */
const SPEAKER_TONES = 6;

const TRANSCRIPT_POLL_MS = 5000;
const COPY_NOTICE_MS = 1600;
const SUMMARY_CAPTION_LIMIT = 2000;
const SUMMARY_CHAT_LIMIT = 500;
const SUMMARY_SOURCE_TIMEOUT_MS = 15000;

const FILE_ACCEPT = [
  '.stl',
  '.sldprt',
  '.slddrw',
  '.dwg',
  '.zip',
  '.key',
  '.pages',
  '.numbers',
  '.mp3',
  '.m4a',
  'audio/wav',
  'audio/mp4a-latm',
  'audio/aac',
  'audio/3gpp',
  'audio/mpeg',
  'video/mp4',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.rar',
  '.rp',
  '.sketch',
  '.psd',
  '.js',
  '.txt',
  '.md',
  '.html',
  '.ico',
  '.xmind',
  '.xd',
  '.svg',
  '.ai',
  '.css',
  '.json',
].join(',');

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 只复制摘要条目，不含模板标题（如未配置多语言的 System Instruction） */
function formatSummaryClipboard(summary: LiveDocAiState['summary']): string {
  const blocks: string[] = [];
  for (const item of summary.roadmap) {
    const head = [item.title.trim(), item.time.trim()].filter(Boolean).join('  ');
    const body = item.summary.trim();
    const block = [head, body].filter(Boolean).join('\n');
    if (block) blocks.push(block);
  }
  return blocks.join('\n\n');
}

/** 按时间、说话人、字幕正文逐条拼接 */
function formatTranscriptClipboard(items: MeetingCaption[]): string {
  const lines: string[] = [];
  for (const item of items) {
    const time = item.offsetSeconds !== null ? fmtOffset(item.offsetSeconds) : '';
    const head = [time, item.speakerName.trim()].filter(Boolean).join('  ');
    const body = item.content.trim();
    const line = [head, body].filter(Boolean).join('  ');
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

function writeClipboard(text: string): Promise<boolean> {
  const clip = navigator.clipboard;
  if (clip?.writeText) {
    return clip.writeText(text).then(
      () => true,
      () => copyWithExec(text),
    );
  }
  return Promise.resolve(copyWithExec(text));
}

function copyWithExec(text: string): boolean {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand('copy');
  el.remove();
  return ok;
}

function formatKloudPasteImageName(mimeType: string, originalName?: string): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  let ext = '.png';
  if (originalName && originalName.includes('.')) {
    ext = originalName.slice(originalName.lastIndexOf('.'));
  } else if (mimeType === 'image/jpeg') {
    ext = '.jpg';
  } else if (mimeType === 'image/png') {
    ext = '.png';
  } else if (mimeType === 'image/gif') {
    ext = '.gif';
  } else if (mimeType === 'image/webp') {
    ext = '.webp';
  }
  return `Kloud-${stamp}${ext}`;
}

function isKloudPasteDocumentUrl(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return (
    lower.includes('/document/') ||
    lower.includes('/docview/') ||
    lower.includes('/livedoc/') ||
    lower.includes('/attachment/')
  );
}

function getActiveMeetingId(): number | null {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('activeMeetingId') : null;
    if (!raw) return null;
    const id = Number.parseInt(raw, 10);
    return Number.isNaN(id) ? null : id;
  } catch {
    return null;
  }
}

function getMeetingStartedAtMs(): number | null {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('activeMeetingStartedAt') : null;
    if (!raw) return null;
    const ms = new Date(raw).getTime();
    return Number.isNaN(ms) ? null : ms;
  } catch {
    return null;
  }
}

function roomNameFromPath(): string {
  if (typeof window === 'undefined') return '';
  const segments = window.location.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  return last ? decodeURIComponent(last) : '';
}

function fmtHms(secs: number): string {
  const n = Math.max(0, Math.floor(secs));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function offsetFromTimestamp(timestamp: number): number {
  const start = getMeetingStartedAtMs();
  if (start === null) return 0;
  return Math.max(0, Math.floor((timestamp - start) / 1000));
}

function takeLast<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  return items.slice(items.length - limit);
}

function parseTimeMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

function captionTimeMs(offsetSeconds: number | null, explicit: number | null): number {
  if (explicit !== null) return explicit;
  if (offsetSeconds !== null) {
    const start = getMeetingStartedAtMs();
    if (start !== null) return start + offsetSeconds * 1000;
  }
  return Date.now();
}

function toTranscriptItem(input: {
  id: string | number;
  userName: string;
  captionContent: string;
  offsetSeconds: number | null;
  captionTimeMs: number | null;
}): LiveDocAiTranscriptItem {
  const captionTime = captionTimeMs(input.offsetSeconds, input.captionTimeMs);
  const offset =
    input.offsetSeconds !== null
      ? input.offsetSeconds
      : Math.max(0, Math.floor((captionTime - (getMeetingStartedAtMs() ?? captionTime)) / 1000));
  return {
    id: input.id,
    userName: input.userName,
    captionContent: input.captionContent,
    captionTime,
    time: fmtHms(offset),
    pageNumber: 0,
    attachmentId: 0,
  };
}

function parseChatForSummary(value: unknown): LiveDocAiTranscriptItem | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.kind === 'livedoc') return null;
  const message = typeof row.message === 'string' ? row.message.trim() : '';
  if (!message) return null;
  const senderName =
    typeof row.senderName === 'string' && row.senderName.trim()
      ? row.senderName.trim()
      : 'Unknown';
  const timestamp =
    typeof row.timestamp === 'number' && Number.isFinite(row.timestamp) ? row.timestamp : 0;
  const id =
    typeof row.clientMessageId === 'string' && row.clientMessageId
      ? row.clientMessageId
      : `chat-${timestamp}`;
  return toTranscriptItem({
    id,
    userName: senderName,
    captionContent: message,
    offsetSeconds: timestamp ? offsetFromTimestamp(timestamp) : null,
    captionTimeMs: timestamp || null,
  });
}

function fmtOffset(secs: number): string {
  if (secs < 0) return '--:--';
  if (secs === 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** A tone per speaker in order of appearance, as on the replay page, so neighbours differ */
function speakerTones(items: MeetingCaption[]): Map<string, number> {
  const tones = new Map<string, number>();
  for (const item of items) {
    if (!tones.has(item.speakerName)) tones.set(item.speakerName, tones.size % SPEAKER_TONES);
  }
  return tones;
}

function parseCaption(value: unknown): MeetingCaption | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const content = typeof item.content === 'string' ? item.content.trim() : '';
  if (!content) return null;
  const speakerName = typeof item.speakerName === 'string' && item.speakerName.trim()
    ? item.speakerName.trim()
    : 'Unknown';
  const offsetSeconds = typeof item.offsetSeconds === 'number' ? item.offsetSeconds : null;
  const id = item.id;
  return {
    id: id === undefined || id === null ? `${speakerName}-${content}` : String(id),
    speakerName,
    content,
    offsetSeconds,
    captionTimeMs: parseTimeMs(item.captionTime),
  };
}

function toTranscriptFromCaption(row: MeetingCaption): LiveDocAiTranscriptItem {
  return toTranscriptItem({
    id: row.id,
    userName: row.speakerName,
    captionContent: row.content,
    offsetSeconds: row.offsetSeconds,
    captionTimeMs: row.captionTimeMs,
  });
}

function sortByCaptionTime(items: LiveDocAiTranscriptItem[]): LiveDocAiTranscriptItem[] {
  return items.slice().sort((a, b) => {
    const ta = typeof a.captionTime === 'number' ? a.captionTime : 0;
    const tb = typeof b.captionTime === 'number' ? b.captionTime : 0;
    return ta - tb;
  });
}

/** fetchSummaryCaptions — 拉取本场字幕，失败则空数组（让 LiveDoc 走原总结）。 */
async function fetchSummaryCaptions(): Promise<LiveDocAiTranscriptItem[]> {
  const meetingId = getActiveMeetingId();
  if (!meetingId) return [];
  try {
    const res = await authFetch(`/api/transcripts/${meetingId}`, {
      headers: roomAuthHeaders(),
      signal: AbortSignal.timeout(SUMMARY_SOURCE_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const raw =
      data && typeof data === 'object' && Array.isArray((data as { captions?: unknown }).captions)
        ? (data as { captions: unknown[] }).captions
        : [];
    const captions: LiveDocAiTranscriptItem[] = [];
    raw.forEach((item) => {
      const parsed = parseCaption(item);
      if (parsed) captions.push(toTranscriptFromCaption(parsed));
    });
    return takeLast(captions, SUMMARY_CAPTION_LIMIT);
  } catch {
    return [];
  }
}

/** fetchSummaryChats — 拉取本场文字聊天，并转成与 list_with_voice 相同的 captions 项。 */
async function fetchSummaryChats(livekitToken: string): Promise<LiveDocAiTranscriptItem[]> {
  const roomName = roomNameFromPath();
  const token = livekitToken.trim();
  if (!roomName || !token) return [];
  try {
    const res = await fetch(`/api/meetings/${encodeURIComponent(roomName)}/chat-messages`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SUMMARY_SOURCE_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const raw =
      data && typeof data === 'object' && Array.isArray((data as { messages?: unknown }).messages)
        ? (data as { messages: unknown[] }).messages
        : [];
    const chats: LiveDocAiTranscriptItem[] = [];
    raw.forEach((item) => {
      const parsed = parseChatForSummary(item);
      if (parsed) chats.push(parsed);
    });
    return takeLast(chats, SUMMARY_CHAT_LIMIT);
  } catch {
    return [];
  }
}

function groupBySpeaker(items: MeetingCaption[]): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  items.forEach((item) => {
    const last = groups[groups.length - 1];
    if (!last || last.speaker !== item.speakerName) {
      groups.push({ speaker: item.speakerName, items: [item] });
      return;
    }
    last.items.push(item);
  });
  return groups;
}

function useMeetingCaptions(enabled: boolean): { items: MeetingCaption[]; loading: boolean } {
  const [items, setItems] = React.useState<MeetingCaption[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let first = true;
    let seq = 0;

    const load = async () => {
      const meetingId = getActiveMeetingId();
      if (!meetingId) {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
        return;
      }
      const requestId = ++seq;
      if (first) setLoading(true);
      try {
        const res = await authFetch(`/api/transcripts/${meetingId}`, { headers: roomAuthHeaders() });
        if (!res.ok) {
          if (!cancelled && first && requestId === seq) setItems([]);
          return;
        }
        const data: unknown = await res.json();
        const raw =
          data && typeof data === 'object' && Array.isArray((data as { captions?: unknown }).captions)
            ? (data as { captions: unknown[] }).captions
            : [];
        if (cancelled || requestId !== seq) return;
        setItems(raw.map(parseCaption).filter((row): row is MeetingCaption => row !== null));
      } catch {
        if (!cancelled && first && requestId === seq) setItems([]);
      } finally {
        if (!cancelled && requestId === seq) {
          setLoading(false);
          first = false;
        }
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, TRANSCRIPT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  return { items, loading };
}

export function LiveDocAiPanel({
  open,
  state,
  connected,
  error,
  busy,
  bubblePos,
  isLiveDocView,
  onClose,
  onClearError,
  onAction,
  uploads,
  onOpenDocument,
  livekitToken = '',
  canManage = true,
  requestedTab = null,
  designItem = null,
  onShowDesign,
  onAddDesignLink,
}: LiveDocAiPanelProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = React.useState<LiveDocAiTab>('file');
  const [documentSearch, setDocumentSearch] = React.useState('');
  const [transcriptSearch, setTranscriptSearch] = React.useState('');
  const [fileMenuItemId, setFileMenuItemId] = React.useState<number | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = React.useState(false);
  const [removeItemId, setRemoveItemId] = React.useState<number | null>(null);
  const [pendingOpenItemId, setPendingOpenItemId] = React.useState<number | null>(null);
  const [summaryMenuOpen, setSummaryMenuOpen] = React.useState(false);
  const [summaryOptionsOpen, setSummaryOptionsOpen] = React.useState(false);
  const [summaryDetailLevel, setSummaryDetailLevel] = React.useState<0 | 2>(2);
  const [summaryLanguage, setSummaryLanguage] = React.useState<'en' | 'cn'>('en');
  const [summaryPreparing, setSummaryPreparing] = React.useState(false);
  const [summaryCopied, setSummaryCopied] = React.useState(false);
  const [transcriptMenuOpen, setTranscriptMenuOpen] = React.useState(false);
  const [transcriptCopied, setTranscriptCopied] = React.useState(false);
  const summaryBusyRef = React.useRef(false);
  const summaryCopiedTimerRef = React.useRef<number | null>(null);
  const transcriptCopiedTimerRef = React.useRef<number | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const fileMenuBtnRefs = React.useRef<Map<number, HTMLButtonElement>>(new Map());
  const uploadMenuBtnRef = React.useRef<HTMLButtonElement>(null);
  const summaryMenuBtnRef = React.useRef<HTMLButtonElement>(null);
  const transcriptMenuBtnRef = React.useRef<HTMLButtonElement>(null);
  const activeFileMenuBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const transcriptBodyRef = React.useRef<HTMLDivElement>(null);
  const transcriptStickRef = React.useRef(true);
  const meetingCaptions = useMeetingCaptions(open && activeTab === 'transcript');

  const runAction = React.useCallback(
    (action: string, payload?: Record<string, unknown>) => {
      void onAction(action, payload).catch(() => undefined);
    },
    [onAction],
  );

  const { enqueue: enqueueUploads } = uploads;
  const uploadPasteImageBlob = React.useCallback(
    (blob: Blob, originalName?: string) => {
      if (!blob.size) return;
      const fileName = formatKloudPasteImageName(blob.type || 'image/png', originalName);
      enqueueUploads([new File([blob], fileName, { type: blob.type || '' })]);
    },
    [enqueueUploads],
  );

  React.useEffect(() => {
    if (!open) return;
    setActiveTab('file');
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // After the reset above: when the panel opens straight onto a tab (Recording → Live transcript),
  // both change in the same render and the requested tab has to win
  React.useEffect(() => {
    if (requestedTab) setActiveTab(requestedTab.tab);
  }, [requestedTab]);

  React.useEffect(() => {
    if (!open || busy) return;
    const handlePaste = (event: ClipboardEvent) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      let uploadedImage = false;
      for (let i = 0; i < clipboard.items.length; i += 1) {
        const item = clipboard.items[i];
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const blob = item.getAsFile();
        if (!blob || blob.size === 0) continue;
        event.preventDefault();
        uploadedImage = true;
        uploadPasteImageBlob(blob, blob.name);
        break;
      }

      const text = clipboard.getData('text') || clipboard.getData('Text') || '';
      if (!uploadedImage && isKloudPasteDocumentUrl(text)) {
        event.preventDefault();
        void onAction('document.uploadFromPasteUrl', { url: text.trim() }).catch(() => undefined);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [open, busy, uploadPasteImageBlob, onAction]);

  activeFileMenuBtnRef.current =
    fileMenuItemId === null ? null : fileMenuBtnRefs.current.get(fileMenuItemId) || null;

  React.useEffect(() => {
    if (!open) {
      setFileMenuItemId(null);
      setUploadMenuOpen(false);
      setRemoveItemId(null);
      setPendingOpenItemId(null);
      setSummaryMenuOpen(false);
      setSummaryOptionsOpen(false);
      setSummaryPreparing(false);
      setSummaryCopied(false);
      setTranscriptMenuOpen(false);
      setTranscriptCopied(false);
    }
    return () => {
      if (summaryCopiedTimerRef.current !== null) {
        window.clearTimeout(summaryCopiedTimerRef.current);
        summaryCopiedTimerRef.current = null;
      }
      if (transcriptCopiedTimerRef.current !== null) {
        window.clearTimeout(transcriptCopiedTimerRef.current);
        transcriptCopiedTimerRef.current = null;
      }
    };
  }, [open]);

  const requestOpenDocument = (itemId: number) => {
    if (!canManage) return;
    if (isLiveDocView) {
      onOpenDocument(itemId);
      return;
    }
    setPendingOpenItemId(itemId);
  };

  React.useLayoutEffect(() => {
    if (!open || activeTab !== 'transcript') return;
    const el = transcriptBodyRef.current;
    if (!el || !transcriptStickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [open, activeTab, meetingCaptions.items, transcriptSearch]);

  if (!open || typeof document === 'undefined') return null;

  const documents = state?.documents.items || [];
  // The bar follows LiveDoc's own upload (ours, or a chat file) and this panel's queue between files
  const liveUpload = state?.documents.upload;
  const uploadShowing = !!liveUpload?.active || uploads.active;
  const uploadName = liveUpload?.active ? liveUpload.fileName : uploads.currentName;
  const uploadPercent = liveUpload?.active ? liveUpload.percent : 0;
  const normalizedDocumentSearch = documentSearch.trim().toLowerCase();
  const filteredDocuments = normalizedDocumentSearch
    ? documents.filter((item) =>
        `${item.title} ${item.fileName}`.toLowerCase().includes(normalizedDocumentSearch),
      )
    : documents;

  const normalizedTranscriptSearch = transcriptSearch.trim().toLowerCase();
  const filteredCaptions = normalizedTranscriptSearch
    ? meetingCaptions.items.filter((item) =>
        `${item.speakerName} ${item.content}`.toLowerCase().includes(normalizedTranscriptSearch),
      )
    : meetingCaptions.items;
  const captionGroups = groupBySpeaker(filteredCaptions);
  // From every caption, not just the search hits, so a search doesn't recolour people
  const speakerToneByName = speakerTones(meetingCaptions.items);
  const addSources: Array<{ key: string; icon: GlyphName; label: string; onClick: () => void }> = [
    {
      key: 'local',
      icon: 'upload',
      label: t('liveDocAi.uploadFromLocal'),
      onClick: () => fileInputRef.current?.click(),
    },
    { key: 'space', icon: 'space', label: t('liveDocAi.uploadFromSpace'), onClick: () => openPicker('space') },
    {
      key: 'files',
      icon: 'files',
      label: t('liveDocAi.uploadFromFiles'),
      onClick: () => openPicker('favorite'),
    },
    {
      key: 'whiteboard',
      icon: 'whiteboard',
      label: t('liveDocAi.newWhiteboard'),
      onClick: () => runAction('document.addBlank'),
    },
    ...(onAddDesignLink
      ? [{ key: 'link', icon: 'link' as GlyphName, label: t('liveDocAi.linkSource'), onClick: onAddDesignLink }]
      : []),
  ];

  const handleLocalFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    enqueueUploads(files);
  };

  const copySummary = () => {
    setSummaryMenuOpen(false);
    const summary = state?.summary;
    if (!summary) return;
    const text = formatSummaryClipboard(summary);
    if (!text) return;
    void writeClipboard(text).then(
      (ok) => {
        if (!ok) return;
        setSummaryCopied(true);
        if (summaryCopiedTimerRef.current !== null) {
          window.clearTimeout(summaryCopiedTimerRef.current);
        }
        summaryCopiedTimerRef.current = window.setTimeout(() => {
          summaryCopiedTimerRef.current = null;
          setSummaryCopied(false);
        }, COPY_NOTICE_MS);
      },
      () => undefined,
    );
  };

  const copyTranscript = () => {
    setTranscriptMenuOpen(false);
    const text = formatTranscriptClipboard(meetingCaptions.items);
    if (!text) return;
    void writeClipboard(text).then(
      (ok) => {
        if (!ok) return;
        setTranscriptCopied(true);
        if (transcriptCopiedTimerRef.current !== null) {
          window.clearTimeout(transcriptCopiedTimerRef.current);
        }
        transcriptCopiedTimerRef.current = window.setTimeout(() => {
          transcriptCopiedTimerRef.current = null;
          setTranscriptCopied(false);
        }, COPY_NOTICE_MS);
      },
      () => undefined,
    );
  };

  const openPicker = (kind: LiveDocAiPickerKind) => {
    setUploadMenuOpen(false);
    runAction(kind === 'space' ? 'picker.openSpace' : 'picker.openFavorite');
  };

  const submitSummary = () => {
    if (summaryBusyRef.current) return;
    summaryBusyRef.current = true;
    setSummaryOptionsOpen(false);
    setSummaryMenuOpen(false);
    setSummaryPreparing(true);
    void (async () => {
      try {
        const [speech, chats] = await Promise.all([
          fetchSummaryCaptions(),
          fetchSummaryChats(livekitToken),
        ]);
        const captions = sortByCaptionTime([...speech, ...chats]);
        const payload: Record<string, unknown> = {
          detailLevel: summaryDetailLevel,
          language: summaryLanguage,
        };
        if (captions.length) {
          payload.captions = captions;
        }
        await onAction('summary.generate', payload);
      } catch {
        // LiveDoc bridge 已写入 error
      } finally {
        summaryBusyRef.current = false;
        setSummaryPreparing(false);
      }
    })();
  };

  if (!bubblePos) {
    return createPortal(
      <div className={styles.dismiss} role="presentation" onMouseDown={onClose} />,
      document.body,
    );
  }

  const panel = (
    <>
      <div className={styles.dismiss} role="presentation" onMouseDown={onClose} />
      <section
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-doc-ai-panel-title"
        style={
          bubblePos
            ? ({
                top: bubblePos.top,
                left: bubblePos.left,
                width: bubblePos.width,
                height: bubblePos.height,
                ['--live-doc-ai-arrow' as string]: `${bubblePos.arrowLeft}px`,
              } as React.CSSProperties)
            : undefined
        }
        onMouseDown={(event) => {
          event.stopPropagation();
          const target = event.target as HTMLElement;
          if (!target.closest(`.${styles.menuAnchor}`)) {
            setFileMenuItemId(null);
            setUploadMenuOpen(false);
            setSummaryMenuOpen(false);
            setTranscriptMenuOpen(false);
          }
        }}
      >
        <span className={styles.arrow} aria-hidden />
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <h2 id="live-doc-ai-panel-title" className={styles.title}>
              {t('toolbar.liveDocMenu')}
            </h2>
            <button
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label={t('common.close')}
            >
              <Glyph name="close" size={18} />
            </button>
          </div>
          <nav className={styles.tabs} aria-label={t('toolbar.liveDocMenu')}>
            {(
              [
                ['file', t('toolbar.liveDocPanelFile')],
                ['summary', t('toolbar.liveDocPanelSummary')],
                ['transcript', t('toolbar.liveDocPanelTranscript')],
              ] as Array<[LiveDocAiTab, string]>
            ).map(([tab, label]) => (
              <button
                type="button"
                key={tab}
                className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
                aria-pressed={activeTab === tab}
                onClick={() => setActiveTab(tab)}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>

        {error && (
          <div className={styles.error} role="alert">
            <Glyph name="alert" size={16} />
            <span>{error}</span>
            <button type="button" onClick={onClearError}>
              {t('common.close')}
            </button>
          </div>
        )}

        {!canManage && (
          <div className={styles.readOnlyNotice} role="note">
            <Glyph name="info" size={16} />
            <span>{t('liveDocAi.readOnlyNotice')}</span>
          </div>
        )}

        {activeTab === 'transcript' ? (
          <main className={styles.body}>
            <div className={styles.transcriptTab}>
              <div className={styles.transcriptToolbar}>
                <div className={styles.searchBox}>
                  <Glyph name="search" size={16} />
                  <input
                    value={transcriptSearch}
                    onChange={(event) => setTranscriptSearch(event.target.value)}
                    placeholder={t('liveDocAi.searchTranscript')}
                    aria-label={t('liveDocAi.searchTranscript')}
                  />
                </div>
                {transcriptCopied && (
                  <span className={styles.copyNotice} role="status">
                    {t('liveDocAi.copied')}
                  </span>
                )}
                <div className={styles.menuAnchor}>
                  <button
                    ref={transcriptMenuBtnRef}
                    type="button"
                    className={styles.moreButton}
                    aria-label={t('liveDocAi.more')}
                    aria-expanded={transcriptMenuOpen}
                    onClick={() => {
                      setFileMenuItemId(null);
                      setUploadMenuOpen(false);
                      setSummaryMenuOpen(false);
                      setTranscriptMenuOpen((value) => !value);
                    }}
                  >
                    <Glyph name="more" size={18} />
                  </button>
                </div>
              </div>
              <div
                ref={transcriptBodyRef}
                className={styles.transcriptBody}
                onScroll={() => {
                  const el = transcriptBodyRef.current;
                  if (!el) return;
                  transcriptStickRef.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 48;
                }}
              >
                {meetingCaptions.loading && !meetingCaptions.items.length && (
                  <div className={styles.loading} role="status">
                    <span className={styles.loadingSpinner} aria-hidden />
                    <span>{t('liveDocAi.loadingTranscript')}</span>
                  </div>
                )}
                {!meetingCaptions.loading && !captionGroups.length && (
                  <div className={styles.empty}>
                    <span className={styles.emptyIcon}>
                      <Glyph name="transcript" size={22} />
                    </span>
                    <span>{t('liveDocAi.noTranscript')}</span>
                  </div>
                )}
                {captionGroups.map((group, groupIndex) => (
                  <section
                    key={`${group.speaker}-${groupIndex}`}
                    className={styles.captionGroup}
                  >
                    <div className={styles.speakerRow}>
                      <span
                        className={`${styles.speakerAvatar} ${styles[`tone${speakerToneByName.get(group.speaker) ?? 0}`]}`}
                      >
                        {getInitials(group.speaker)}
                      </span>
                      <span className={styles.speakerLabel}>{group.speaker}</span>
                      {group.items[0].offsetSeconds !== null && (
                        <span className={styles.speakerTime}>
                          {fmtOffset(group.items[0].offsetSeconds)}
                        </span>
                      )}
                    </div>
                    {group.items.map((row, rowIndex) => (
                      <div key={`${row.id}-${rowIndex}`} className={styles.captionBubble}>
                        {row.content}
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            </div>
          </main>
        ) : !connected || !state ? (
          <>
            {activeTab === 'file' && designItem && (
              <div className={styles.designOnly}>
                <div className={styles.sectionLabel}>{t('liveDocAi.designSection')}</div>
                <DesignRow item={designItem} onShow={onShowDesign} />
              </div>
            )}
            <div className={styles.loading} role="status" aria-live="polite">
              {!error && <span className={styles.loadingSpinner} aria-hidden />}
              <span>{t('liveDocAi.connecting')}</span>
            </div>
            {activeTab === 'file' && onAddDesignLink && (
              <footer className={styles.documentFooter}>
                <div className={styles.footerEnd}>
                  <DesignLinkButton onClick={onAddDesignLink} />
                </div>
              </footer>
            )}
          </>
        ) : (
          <main className={styles.body}>
            {activeTab === 'file' && (
              <div className={styles.documentsTab}>
                {documents.length > 0 && (
                  <div className={styles.searchBox}>
                    <Glyph name="search" size={16} />
                    <input
                      value={documentSearch}
                      onChange={(event) => setDocumentSearch(event.target.value)}
                      placeholder={t('liveDocAi.searchDocuments')}
                      aria-label={t('liveDocAi.searchDocuments')}
                    />
                  </div>
                )}
                {designItem && (
                  <>
                    <div className={styles.sectionLabel}>{t('liveDocAi.designSection')}</div>
                    <DesignRow item={designItem} onShow={onShowDesign} />
                    <div className={styles.sectionLabel}>{t('toolbar.liveDoc')}</div>
                  </>
                )}
                <div className={styles.documentList}>
                  {/* First in the list: what went wrong is seen first and scrolls with the rest */}
                  {uploads.failures.length > 0 && (
                    <UploadFailures
                      failures={uploads.failures}
                      onRetry={uploads.retry}
                      onDismiss={uploads.dismissFailures}
                    />
                  )}
                  {!documents.length && canManage && (
                    <div className={styles.emptyStart}>
                      <span className={styles.emptyIcon}>
                        <Glyph name="files" size={22} />
                      </span>
                      <span className={styles.emptyTitle}>{t('liveDocAi.noDocuments')}</span>
                      <span className={styles.emptyHint}>{t('liveDocAi.emptyHint')}</span>
                      <div className={styles.sourceGrid}>
                        {addSources.map((source) => (
                          <button
                            key={source.key}
                            type="button"
                            className={styles.sourceCard}
                            disabled={busy}
                            onClick={source.onClick}
                            title={source.key === 'link' ? t('liveDocAi.addLinkTip') : undefined}
                          >
                            <span className={styles.sourceIcon}>
                              <Glyph name={source.icon} size={18} />
                            </span>
                            <span>{source.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {!documents.length && !canManage && (
                    <div className={styles.empty}>
                      <span className={styles.emptyIcon}>
                        <Glyph name="files" size={22} />
                      </span>
                      <span>{t('liveDocAi.noDocuments')}</span>
                    </div>
                  )}
                  {documents.length > 0 && !filteredDocuments.length && (
                    <div className={styles.empty}>{t('liveDocAi.noDocuments')}</div>
                  )}
                  {filteredDocuments.map((item) => (
                    <div
                      key={item.itemId}
                      className={`${styles.documentRow} ${item.isCurrent ? styles.documentRowActive : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => requestOpenDocument(item.itemId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          requestOpenDocument(item.itemId);
                        }
                      }}
                    >
                      <FileTypeBadge names={[item.fileName, item.title]} icon={item.fileImg} />
                      <span className={styles.documentName}>{item.title}</span>
                      {(item.isCurrent || canManage) && (
                        <span className={item.isCurrent ? styles.viewing : styles.viewAction}>
                          {item.isCurrent
                            ? t('liveDocAi.currentlyViewing')
                            : t('liveDocAi.viewLiveDoc')}
                        </span>
                      )}
                      {canManage && (
                      <div className={styles.menuAnchor}>
                        <button
                          ref={(node) => {
                            if (node) fileMenuBtnRefs.current.set(item.itemId, node);
                            else fileMenuBtnRefs.current.delete(item.itemId);
                          }}
                          type="button"
                          className={styles.moreButton}
                          aria-label={t('liveDocAi.more')}
                          onClick={(event) => {
                            event.stopPropagation();
                            setUploadMenuOpen(false);
                            setSummaryMenuOpen(false);
                            setFileMenuItemId((current) =>
                              current === item.itemId ? null : item.itemId,
                            );
                          }}
                        >
                          <Glyph name="more" size={18} />
                        </button>
                      </div>
                      )}
                    </div>
                  ))}
                </div>

                {(canManage || onAddDesignLink || uploadShowing) && (
                <footer className={styles.documentFooter}>
                  {uploadShowing && (
                    <div className={styles.uploadProgress} role="status">
                      <div className={styles.uploadProgressText}>
                        <span>
                          {uploads.active && uploads.total > 1 && (
                            <span className={styles.uploadCount}>
                              {t('liveDocAi.uploadCount', {
                                position: uploads.position,
                                total: uploads.total,
                              })}
                            </span>
                          )}
                          {uploadName || t('liveDocAi.uploading')}
                        </span>
                        {liveUpload?.active && <span>{uploadPercent}%</span>}
                      </div>
                      <div className={styles.uploadProgressTrack}>
                        <div
                          className={styles.uploadProgressFill}
                          style={{ width: `${uploadPercent}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {canManage && (
                  <div className={styles.footerActions}>
                    <label
                      className={`${styles.annotation}${
                        !state.documents.annotation.canToggle || busy ? ` ${styles.annotationDisabled}` : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        role="switch"
                        className={styles.switch}
                        checked={state.documents.annotation.enabled}
                        disabled={!state.documents.annotation.canToggle || busy}
                        onChange={(event) =>
                          runAction('annotation.set', { enabled: event.target.checked })
                        }
                      />
                      {t('liveDocAi.enableAnnotation')}
                    </label>
                    <input
                      ref={fileInputRef}
                      className={styles.hiddenInput}
                      type="file"
                      accept={FILE_ACCEPT}
                      multiple
                      onChange={handleLocalFile}
                    />
                    {/* With no documents yet the sources sit in the list as cards; then they move here */}
                    {documents.length > 0 && (
                      <div className={styles.menuAnchor}>
                        <button
                          ref={uploadMenuBtnRef}
                          type="button"
                          className={styles.addButton}
                          disabled={busy}
                          aria-expanded={uploadMenuOpen}
                          aria-haspopup="menu"
                          onClick={() => {
                            setFileMenuItemId(null);
                            setSummaryMenuOpen(false);
                            setUploadMenuOpen((value) => !value);
                          }}
                        >
                          <Glyph name="plus" size={16} />
                          {t('liveDocAi.add')}
                        </button>
                      </div>
                    )}
                  </div>
                  )}
                  {/* A presenter who can't manage LiveDocs can still show a design link */}
                  {!canManage && onAddDesignLink && (
                    <div className={styles.footerEnd}>
                      <DesignLinkButton onClick={onAddDesignLink} disabled={busy} />
                    </div>
                  )}
                </footer>
                )}
              </div>
            )}

            {activeTab === 'summary' && (
              <div className={styles.summaryTab}>
                <div className={styles.summaryHeader}>
                  <h3>{state.summary.templateTitle || t('toolbar.liveDocPanelSummary')}</h3>
                  {summaryCopied && (
                    <span className={styles.copyNotice} role="status">
                      {t('liveDocAi.copied')}
                    </span>
                  )}
                  <div className={styles.menuAnchor}>
                    <button
                      ref={summaryMenuBtnRef}
                      type="button"
                      className={styles.moreButton}
                      aria-label={t('liveDocAi.more')}
                      aria-expanded={summaryMenuOpen}
                      onClick={() => {
                        setFileMenuItemId(null);
                        setUploadMenuOpen(false);
                        setSummaryMenuOpen((value) => !value);
                      }}
                    >
                      <Glyph name="more" size={18} />
                    </button>
                  </div>
                </div>
                <div className={styles.summaryContent}>
                  {state.summary.phase === 'error' && !summaryPreparing ? (
                    <div className={styles.empty}>
                      <span className={`${styles.emptyIcon} ${styles.emptyIconError}`}>
                        <Glyph name="alert" size={22} />
                      </span>
                      <span>{state.summary.error || t('liveDocAi.summaryError')}</span>
                    </div>
                  ) : summaryPreparing || state.summary.phase === 'loading' ? (
                    <div className={styles.loading} role="status" aria-live="polite">
                      <span className={styles.emptyIcon}>
                        <Glyph name="sparkle" size={22} />
                      </span>
                      <span>
                        {t('liveDocAi.summaryGenerating', {
                          percent: Math.round(state.summary.progress * 100),
                        })}
                      </span>
                      <span className={styles.summaryProgress}>
                        <span style={{ width: `${Math.round(state.summary.progress * 100)}%` }} />
                      </span>
                    </div>
                  ) : state.summary.roadmap.length ? (
                    state.summary.roadmap.map((item, index) => (
                      <article
                        key={`${item.time}-${index}`}
                        className={`${styles.summaryItem} ${item.isActive ? styles.summaryItemActive : ''}`}
                      >
                        <div>
                          <h4>{item.title}</h4>
                          <span>{item.time}</span>
                        </div>
                        <p>{item.summary}</p>
                      </article>
                    ))
                  ) : (
                    <div className={styles.empty}>
                      <span className={styles.emptyIcon}>
                        <Glyph name="sparkle" size={22} />
                      </span>
                      <span>{t('liveDocAi.noSummary')}</span>
                      {canManage && (
                        <button
                          type="button"
                          className={styles.primaryButton}
                          onClick={() => setSummaryOptionsOpen(true)}
                        >
                          {t('liveDocAi.generateNow')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </main>
        )}

        {removeItemId !== null && (
          <div className={styles.nestedOverlay}>
            <div className={styles.confirmDialog}>
              <h3>{t('liveDocAi.removeTitle')}</h3>
              <p>{t('liveDocAi.removeConfirm')}</p>
              <div>
                <button type="button" onClick={() => setRemoveItemId(null)}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => {
                    runAction('document.remove', { itemId: removeItemId });
                    setRemoveItemId(null);
                  }}
                >
                  {t('liveDocAi.remove')}
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingOpenItemId !== null && (
          <div className={styles.nestedOverlay}>
            <div
              className={styles.switchConfirmDialog}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="live-doc-switch-title"
              aria-describedby="live-doc-switch-desc"
            >
              <div className={styles.switchConfirmIcon} aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 id="live-doc-switch-title">{t('liveDocAi.switchToLiveDocTitle')}</h3>
              {(() => {
                const pendingDoc = documents.find((item) => item.itemId === pendingOpenItemId);
                return pendingDoc ? (
                  <p className={styles.switchConfirmDocName}>{pendingDoc.title}</p>
                ) : null;
              })()}
              <p id="live-doc-switch-desc" className={styles.switchConfirmBody}>
                {t('liveDocAi.switchToLiveDocConfirm')}
              </p>
              <div className={styles.switchConfirmActions}>
                <button type="button" onClick={() => setPendingOpenItemId(null)}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className={styles.switchConfirmPrimary}
                  onClick={() => {
                    const itemId = pendingOpenItemId;
                    setPendingOpenItemId(null);
                    onOpenDocument(itemId);
                  }}
                >
                  {t('liveDocAi.switchToLiveDocAction')}
                </button>
              </div>
            </div>
          </div>
        )}

        {summaryOptionsOpen && (
          <div className={styles.nestedOverlay}>
            <div className={styles.optionDialog}>
              <h3>{t('liveDocAi.meetingSummary')}</h3>
              <label>{t('liveDocAi.wordCount')}</label>
              <div className={styles.optionGroup}>
                <button
                  type="button"
                  className={summaryDetailLevel === 0 ? styles.optionActive : ''}
                  onClick={() => setSummaryDetailLevel(0)}
                >
                  {t('liveDocAi.brief')}
                </button>
                <button
                  type="button"
                  className={summaryDetailLevel === 2 ? styles.optionActive : ''}
                  onClick={() => setSummaryDetailLevel(2)}
                >
                  {t('liveDocAi.detail')}
                </button>
              </div>
              <label htmlFor="summary-language">{t('liveDocAi.language')}</label>
              <select
                id="summary-language"
                value={summaryLanguage}
                onChange={(event) => setSummaryLanguage(event.target.value as 'en' | 'cn')}
              >
                <option value="en">{t('liveDocAi.langEnglish')}</option>
                <option value="cn">{t('liveDocAi.langChinese')}</option>
              </select>
              <div className={styles.dialogActions}>
                <button type="button" onClick={() => setSummaryOptionsOpen(false)}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={summaryPreparing || busy}
                  onClick={submitSummary}
                >
                  {t('liveDocAi.submit')}
                </button>
              </div>
            </div>
          </div>
        )}

        {state?.picker.open && state.picker.kind && (
          <PickerDialog state={state} busy={busy} onAction={runAction} />
        )}
      </section>

      {fileMenuItemId !== null && (
        <FloatingMenu
          anchorRef={activeFileMenuBtnRef}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={styles.danger}
            onClick={() => {
              setRemoveItemId(fileMenuItemId);
              setFileMenuItemId(null);
            }}
          >
            {t('liveDocAi.remove')}
          </button>
        </FloatingMenu>
      )}

      {uploadMenuOpen && (
        <FloatingMenu
          anchorRef={uploadMenuBtnRef}
          className={styles.sourceMenu}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {addSources.map((source) => (
            <button
              key={source.key}
              type="button"
              title={source.key === 'link' ? t('liveDocAi.addLinkTip') : undefined}
              onClick={() => {
                setUploadMenuOpen(false);
                source.onClick();
              }}
            >
              <Glyph name={source.icon} size={18} />
              {source.label}
            </button>
          ))}
        </FloatingMenu>
      )}

      {summaryMenuOpen && (
        <FloatingMenu
          anchorRef={summaryMenuBtnRef}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setSummaryMenuOpen(false);
                setSummaryOptionsOpen(true);
              }}
            >
              {t('liveDocAi.regenerateSummary')}
            </button>
          )}
          <button type="button" onClick={copySummary}>
            {t('liveDocAi.copy')}
          </button>
        </FloatingMenu>
      )}

      {transcriptMenuOpen && (
        <FloatingMenu
          anchorRef={transcriptMenuBtnRef}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={copyTranscript}>
            {t('liveDocAi.copy')}
          </button>
        </FloatingMenu>
      )}
    </>
  );

  return createPortal(panel, document.body);
}

function FloatingMenu({
  anchorRef,
  className,
  children,
  onMouseDown,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  className?: string;
  children: React.ReactNode;
  onMouseDown?: (event: React.MouseEvent) => void;
}) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  React.useLayoutEffect(() => {
    const update = () => {
      const el = anchorRef.current;
      const menu = menuRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = menu?.offsetWidth || 190;
      const height = menu?.offsetHeight || 120;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      let top = rect.top - height - 6;
      if (top < 8) top = Math.min(rect.bottom + 6, window.innerHeight - height - 8);
      setPos({ top, left });
    };
    update();
    requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, children]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={menuRef}
      className={`${styles.dropdown} ${styles.dropdownFloating} ${className || ''}`}
      style={pos ? { top: pos.top, left: pos.left, visibility: 'visible' } : { visibility: 'hidden' }}
      onMouseDown={onMouseDown}
    >
      {children}
    </div>,
    document.body,
  );
}

function PickerSelect({
  label,
  value,
  options,
  placeholder,
  searchPlaceholder,
  onChange,
}: {
  label: string;
  value: number;
  options: Array<{ id: number; name: string }>;
  placeholder: string;
  searchPlaceholder: string;
  onChange: (id: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const rootRef = React.useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const selected = options.find((item) => item.id === value);
  const normalized = filter.trim().toLowerCase();
  const filtered = normalized
    ? options.filter((item) => item.name.toLowerCase().includes(normalized))
    : options;

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: Event) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
        setFilter('');
      }
    };
    // 捕获阶段：父级 dialog 的 stopPropagation 不会挡住收起逻辑
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('touchstart', handlePointerDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('touchstart', handlePointerDown, true);
    };
  }, [open]);

  return (
    <div className={styles.pickerSelectRoot} ref={rootRef}>
      <button
        type="button"
        className={`${styles.pickerSelectTrigger} ${open ? styles.pickerSelectTriggerOpen : ''}`}
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selected ? styles.pickerSelectValue : styles.pickerSelectPlaceholder}>
          {selected?.name || placeholder}
        </span>
        <span className={styles.pickerSelectChevron} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className={styles.pickerSelectMenu} role="listbox">
          <div className={styles.pickerSelectSearch}>
            <input
              value={filter}
              placeholder={searchPlaceholder}
              autoFocus
              onChange={(event) => setFilter(event.target.value)}
              onClick={(event) => event.stopPropagation()}
            />
          </div>
          <div className={styles.pickerSelectOptions}>
            {!filtered.length && (
              <div className={styles.pickerSelectEmpty}>{t('liveDocAi.noData')}</div>
            )}
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={item.id === value}
                className={`${styles.pickerSelectOption} ${item.id === value ? styles.pickerSelectOptionActive : ''}`}
                onClick={() => {
                  onChange(item.id);
                  setOpen(false);
                  setFilter('');
                }}
              >
                <span>{item.name}</span>
                {item.id === value ? <span aria-hidden>✓</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PickerDialog({
  state,
  busy,
  onAction,
}: {
  state: LiveDocAiState;
  busy: boolean;
  onAction: (action: string, payload?: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const picker = state.picker;
  const totalPages = Math.max(1, Math.ceil(picker.total / 15));
  const selectedCount = picker.items.filter((item) => item.selected).length;
  const [searchDraft, setSearchDraft] = React.useState(picker.search);
  const pickerTitle =
    picker.kind === 'space' ? t('liveDocAi.uploadFromSpace') : t('liveDocAi.uploadFromFiles');

  React.useEffect(() => {
    setSearchDraft(picker.search);
  }, [picker.search, picker.kind, picker.open]);

  React.useEffect(() => {
    if (searchDraft === picker.search) return;
    const timer = window.setTimeout(() => {
      onAction('picker.search', { search: searchDraft });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [searchDraft, picker.search, onAction]);

  return createPortal(
    <div className={styles.pickerOverlay} role="presentation">
      <div
        className={styles.pickerDialog}
        role="dialog"
        aria-modal="true"
        aria-label={pickerTitle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.pickerHeader}>
          <h3>{pickerTitle}</h3>
          <div className={styles.pickerHeaderActions}>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={busy || selectedCount === 0}
              onClick={() => onAction('picker.confirm')}
            >
              {t('liveDocAi.ok')}
            </button>
            <button type="button" onClick={() => onAction('picker.cancel')}>
              {t('common.cancel')}
            </button>
          </div>
        </div>

        <div className={styles.pickerToolbar}>
          {picker.kind === 'space' && (
            <div className={styles.pickerFilters}>
              <PickerSelect
                label={t('liveDocAi.team')}
                value={picker.selectedTeamId}
                options={picker.teams}
                placeholder={t('liveDocAi.selectTeam')}
                searchPlaceholder={t('liveDocAi.searchTeam')}
                onChange={(teamId) => onAction('picker.selectTeam', { teamId })}
              />
              <PickerSelect
                label={t('liveDocAi.space')}
                value={picker.selectedSpaceId}
                options={picker.spaces}
                placeholder={t('liveDocAi.selectSpace')}
                searchPlaceholder={t('liveDocAi.searchSpace')}
                onChange={(spaceId) => onAction('picker.selectSpace', { spaceId })}
              />
            </div>
          )}
          <div className={styles.searchBox}>
            <Glyph name="search" size={16} />
            <input
              value={searchDraft}
              placeholder={t('liveDocAi.searchFiles')}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onAction('picker.search', { search: searchDraft });
                }
              }}
            />
          </div>
        </div>

        <div className={styles.pickerList}>
          {picker.loading && <div className={styles.empty}>{t('liveDocAi.loading')}</div>}
          {!picker.loading && !picker.items.length && (
            <div className={styles.empty}>{t('liveDocAi.noFiles')}</div>
          )}
          {picker.items.map((item) => (
            <label
              key={item.id}
              className={`${styles.pickerItem} ${item.selected ? styles.pickerItemSelected : ''}`}
            >
              <input
                type="checkbox"
                checked={item.selected}
                onChange={() => onAction('picker.toggleItem', { itemId: item.id })}
              />
              <FileTypeBadge names={[item.fileName, item.title]} icon={item.fileType} />
              <span className={styles.pickerItemTitle}>{item.title}</span>
              <span className={styles.pickerItemDate}>{item.date}</span>
            </label>
          ))}
        </div>

        <div className={styles.pickerFooter}>
          <span>
            {t('liveDocAi.totalFiles', { total: picker.total })}
            {selectedCount > 0
              ? ` · ${t('liveDocAi.selectedCount', { count: selectedCount })}`
              : ''}
          </span>
          <div className={styles.pagination}>
            <button
              type="button"
              disabled={picker.page <= 1 || busy}
              onClick={() => onAction('picker.page', { page: picker.page - 1 })}
            >
              ‹
            </button>
            <span>
              {picker.page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={picker.page >= totalPages || busy}
              onClick={() => onAction('picker.page', { page: picker.page + 1 })}
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The shared design in the Documents tab: click shows it on the stage (for those who may switch views). */
function DesignRow({ item, onShow }: { item: LiveDocDesignItem; onShow?: () => void }) {
  const { t } = useI18n();
  const sub = item.setByName
    ? `${item.kindLabel} · ${t('liveDocAi.designSharedBy', { name: item.setByName })}`
    : item.kindLabel;
  const body = (
    <>
      <span className={item.kind === 'figma' ? styles.designThumbFigma : styles.designThumbWeb} aria-hidden="true">
        {item.kind === 'figma' ? (
          'F'
        ) : (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a14 14 0 014 9 14 14 0 01-4 9 14 14 0 01-4-9 14 14 0 014-9z" />
          </svg>
        )}
      </span>
      <span className={styles.designText}>
        <span className={styles.documentName}>{item.label}</span>
        <span className={styles.designSub}>{sub}</span>
      </span>
      {item.showing ? (
        <span className={styles.designLive}>{t('liveDocAi.designShowing')}</span>
      ) : (
        onShow && <span className={styles.viewAction}>{t('liveDocAi.viewLiveDoc')}</span>
      )}
    </>
  );
  if (!onShow) {
    return <div className={`${styles.documentRow} ${styles.designRow}`}>{body}</div>;
  }
  return (
    <div
      className={`${styles.documentRow} ${styles.designRow} ${item.showing ? styles.documentRowActive : ''}`}
      role="button"
      tabIndex={0}
      onClick={onShow}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onShow();
        }
      }}
    >
      {body}
    </div>
  );
}

/** "Link" with the upload options: show a Figma or web link to everyone (Design mode). */
function DesignLinkButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={styles.addButton}
      disabled={disabled}
      onClick={onClick}
      title={t('liveDocAi.addLinkTip')}
    >
      <Glyph name="link" size={16} />
      {t('liveDocAi.addLink')}
    </button>
  );
}

/** Files from this computer that LiveDoc did not add, each with why; Retry where trying again can help */
function UploadFailures({
  failures,
  onRetry,
  onDismiss,
}: {
  failures: LiveDocUploadQueue['failures'];
  onRetry: (id: string) => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.uploadIssues} role="alert">
      <div className={styles.uploadIssuesHeader}>
        <Glyph name="alert" size={16} />
        <span>
          {failures.length === 1
            ? t('liveDocAi.uploadFailedOne')
            : t('liveDocAi.uploadFailedMany', { count: failures.length })}
        </span>
        <button
          type="button"
          className={styles.uploadIssuesDismiss}
          aria-label={t('common.close')}
          title={t('common.close')}
          onClick={onDismiss}
        >
          <Glyph name="close" size={16} />
        </button>
      </div>
      <ul className={styles.uploadIssueList}>
        {failures.map((failure) => (
          <li key={failure.id} className={styles.uploadIssue}>
            <span className={styles.uploadIssueText}>
              <span className={styles.uploadIssueName} title={failure.name}>
                {failure.name}
              </span>
              <span className={styles.uploadIssueReason}>
                {t(`liveDocAi.uploadFail.${failure.reason}`)}
              </span>
            </span>
            {failure.retryable && (
              <button
                type="button"
                className={styles.uploadIssueRetry}
                onClick={() => onRetry(failure.id)}
              >
                {t('liveDocAi.retry')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "PPT", "PDF", "DOC"… in the type's colour, as in the Kloud V3 documents table; a whiteboard is a pen stroke */
function FileTypeBadge({
  names,
  icon,
}: {
  names: Array<string | null | undefined>;
  icon?: string | null;
}) {
  const badge = liveDocFileBadge(names, icon);
  return (
    <span className={`${styles.typeBadge} ${styles[`type_${badge.group}`]}`} aria-hidden>
      {badge.group === 'board' ? (
        // A pen stroke instead of letters, as kloud.cn draws it (meeting-whiteboard-badge.svg)
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path
            d="M2.5 11c1.3-2.9 2.6-4.3 3.7-4.3 1.6 0 .7 3.8 2.3 3.8 1.1 0 1.9-1.8 2.7-3.6"
            fill="none"
            stroke="#e6e8ee"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M2.5 13.5h11" stroke="#8b8fa3" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ) : (
        badge.label
      )}
    </span>
  );
}

type GlyphName =
  | 'search'
  | 'more'
  | 'close'
  | 'plus'
  | 'upload'
  | 'space'
  | 'files'
  | 'whiteboard'
  | 'link'
  | 'sparkle'
  | 'transcript'
  | 'info'
  | 'alert';

/** Line icons of the panel, 24-unit grid, drawn in the current text colour */
function Glyph({ name, size = 18 }: { name: GlyphName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className: styles.glyph,
  };
  switch (name) {
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4 4" />
        </svg>
      );
    case 'more':
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <circle cx="6" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="18" cy="12" r="1.7" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common} strokeWidth={2}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common} strokeWidth={2}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'upload':
      return (
        <svg {...common}>
          <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
          <path d="M5 14.5V18a2 2 0 002 2h10a2 2 0 002-2v-3.5" />
        </svg>
      );
    case 'space':
      return (
        <svg {...common}>
          <path d="M3.5 7.5a2 2 0 012-2h3.8l2 2h7.2a2 2 0 012 2v7.5a2 2 0 01-2 2h-13a2 2 0 01-2-2z" />
        </svg>
      );
    case 'files':
      return (
        <svg {...common}>
          <path d="M8 3.5h6l4.5 4.5V18.5a2 2 0 01-2 2H8a2 2 0 01-2-2v-13a2 2 0 012-2z" />
          <path d="M14 3.5V8h4.5M9.5 12.5h5M9.5 16h5" />
        </svg>
      );
    case 'whiteboard':
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
          <path d="M12 16.5V20M8.5 20h7M7.5 12.5l3-3 2 2 4-4" />
        </svg>
      );
    case 'link':
      return (
        <svg {...common}>
          <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg {...common}>
          <path d="M11 4l1.6 4.4L17 10l-4.4 1.6L11 16l-1.6-4.4L5 10l4.4-1.6z" />
          <path d="M18 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
        </svg>
      );
    case 'transcript':
      return (
        <svg {...common}>
          <path d="M5 6.5h14M5 10.5h14M5 14.5h9" />
          <path d="M16.5 15.5v3l2.5-1.5" />
        </svg>
      );
    case 'info':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 11v5M12 7.8v.2" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V13M12 16.2v.2" />
        </svg>
      );
  }
}
