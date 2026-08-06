'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useI18n } from './i18n';
import { resolveLiveDocFileImg, resolveLiveDocFileImgByName } from './liveDocFileTypeIcon';
import type {
  LiveDocAiPickerKind,
  LiveDocAiState,
  LiveDocAiTab,
  LiveDocAiTranscriptItem,
} from './liveDocAiProtocol';
import styles from '../styles/LiveDocAiPanel.module.css';

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
  onClose: () => void;
  onClearError: () => void;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<void>;
  onOpenDocument: (itemId: number) => void;
}

interface TranscriptGroup {
  elapsed: string;
  items: LiveDocAiTranscriptItem[];
}

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

function toTimestamp(value: number | string): number {
  if (typeof value === 'number') return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(remainingSeconds).padStart(2, '0');
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}

function groupTranscript(items: LiveDocAiTranscriptItem[]): TranscriptGroup[] {
  if (!items.length) return [];
  const firstTimestamp = toTimestamp(items[0].captionTime);
  let groupStart = firstTimestamp;
  const groups: TranscriptGroup[] = [{ elapsed: '', items: [] }];

  items.forEach((item) => {
    const timestamp = toTimestamp(item.captionTime);
    if (groups[groups.length - 1].items.length && timestamp - groupStart > 5 * 60 * 1000) {
      groups.push({ elapsed: formatElapsed(timestamp - firstTimestamp), items: [] });
      groupStart = timestamp;
    }
    groups[groups.length - 1].items.push(item);
  });
  return groups;
}

export function LiveDocAiPanel({
  open,
  state,
  connected,
  error,
  busy,
  bubblePos,
  onClose,
  onClearError,
  onAction,
  onOpenDocument,
}: LiveDocAiPanelProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = React.useState<LiveDocAiTab>('file');
  const [documentSearch, setDocumentSearch] = React.useState('');
  const [transcriptSearch, setTranscriptSearch] = React.useState('');
  const [fileMenuItemId, setFileMenuItemId] = React.useState<number | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = React.useState(false);
  const [removeItemId, setRemoveItemId] = React.useState<number | null>(null);
  const [summaryMenuOpen, setSummaryMenuOpen] = React.useState(false);
  const [summaryOptionsOpen, setSummaryOptionsOpen] = React.useState(false);
  const [summaryDetailLevel, setSummaryDetailLevel] = React.useState<0 | 2>(2);
  const [summaryLanguage, setSummaryLanguage] = React.useState<'en' | 'cn'>('en');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const fileMenuBtnRefs = React.useRef<Map<number, HTMLButtonElement>>(new Map());
  const uploadMenuBtnRef = React.useRef<HTMLButtonElement>(null);
  const summaryMenuBtnRef = React.useRef<HTMLButtonElement>(null);
  const activeFileMenuBtnRef = React.useRef<HTMLButtonElement | null>(null);

  const runAction = React.useCallback(
    (action: string, payload?: Record<string, unknown>) => {
      void onAction(action, payload).catch(() => undefined);
    },
    [onAction],
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

  activeFileMenuBtnRef.current =
    fileMenuItemId === null ? null : fileMenuBtnRefs.current.get(fileMenuItemId) || null;

  React.useEffect(() => {
    if (!open) {
      setFileMenuItemId(null);
      setUploadMenuOpen(false);
      setRemoveItemId(null);
      setSummaryMenuOpen(false);
      setSummaryOptionsOpen(false);
    }
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const documents = state?.documents.items || [];
  const normalizedDocumentSearch = documentSearch.trim().toLowerCase();
  const filteredDocuments = normalizedDocumentSearch
    ? documents.filter((item) =>
        `${item.title} ${item.fileName}`.toLowerCase().includes(normalizedDocumentSearch),
      )
    : documents;

  const captions = state?.transcript.items || [];
  const normalizedTranscriptSearch = transcriptSearch.trim().toLowerCase();
  const filteredCaptions = normalizedTranscriptSearch
    ? captions.filter((item) =>
        item.captionContent.toLowerCase().includes(normalizedTranscriptSearch),
      )
    : captions;
  const transcriptGroups = groupTranscript(filteredCaptions);

  const handleLocalFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const fileBuffer = await file.arrayBuffer();
    runAction('document.uploadLocal', {
      fileName: file.name,
      fileType: file.type || '',
      fileSize: file.size,
      fileBuffer,
    });
  };

  const openPicker = (kind: LiveDocAiPickerKind) => {
    setUploadMenuOpen(false);
    runAction(kind === 'space' ? 'picker.openSpace' : 'picker.openFavorite');
  };

  const submitSummary = () => {
    setSummaryOptionsOpen(false);
    setSummaryMenuOpen(false);
    runAction('summary.generate', {
      detailLevel: summaryDetailLevel,
      language: summaryLanguage,
    });
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
          }
        }}
      >
        <span className={styles.arrow} aria-hidden />
        <header className={styles.header}>
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
                onClick={() => setActiveTab(tab)}
              >
                {label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {error && (
          <div className={styles.error} role="alert">
            <span>{error}</span>
            <button type="button" onClick={onClearError}>
              {t('common.close')}
            </button>
          </div>
        )}

        {!connected || !state ? (
          <div className={styles.loading} role="status" aria-live="polite">
            {!error && <span className={styles.loadingSpinner} aria-hidden />}
            <span>{t('liveDocAi.connecting')}</span>
          </div>
        ) : (
          <main className={styles.body}>
            {activeTab === 'file' && (
              <div className={styles.documentsTab}>
                <div className={styles.searchBox}>
                  <span aria-hidden>⌕</span>
                  <input
                    value={documentSearch}
                    onChange={(event) => setDocumentSearch(event.target.value)}
                    placeholder={t('liveDocAi.searchDocuments')}
                  />
                </div>
                <div className={styles.documentList}>
                  {!filteredDocuments.length && (
                    <div className={styles.empty}>{t('liveDocAi.noDocuments')}</div>
                  )}
                  {filteredDocuments.map((item) => (
                    <div
                      key={item.itemId}
                      className={`${styles.documentRow} ${item.isCurrent ? styles.documentRowActive : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenDocument(item.itemId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') onOpenDocument(item.itemId);
                      }}
                    >
                      <span className={styles.thumbnail}>
                        <Image
                          src={
                            item.fileImg
                              ? resolveLiveDocFileImg(item.fileImg)
                              : resolveLiveDocFileImgByName(item.fileName || item.title)
                          }
                          alt=""
                          width={30}
                          height={30}
                          unoptimized
                        />
                      </span>
                      <span className={styles.documentName}>{item.title}</span>
                      <span className={item.isCurrent ? styles.viewing : styles.viewAction}>
                        {item.isCurrent
                          ? t('liveDocAi.currentlyViewing')
                          : t('liveDocAi.viewLiveDoc')}
                      </span>
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
                          •••
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <footer className={styles.documentFooter}>
                  {state.documents.upload.active && (
                    <div className={styles.uploadProgress}>
                      <div
                        className={styles.uploadProgressFill}
                        style={{ width: `${state.documents.upload.percent}%` }}
                      />
                      <span>
                        {state.documents.upload.fileName || t('liveDocAi.uploading')}{' '}
                        {state.documents.upload.percent}%
                      </span>
                    </div>
                  )}
                  <div className={styles.footerActions}>
                    <label className={styles.annotation}>
                      <input
                        type="checkbox"
                        checked={state.documents.annotation.enabled}
                        disabled={!state.documents.annotation.canToggle || busy}
                        onChange={(event) =>
                          runAction('annotation.set', { enabled: event.target.checked })
                        }
                      />
                      {t('liveDocAi.enableAnnotation')}
                    </label>
                    <div className={styles.uploadActions}>
                      <input
                        ref={fileInputRef}
                        className={styles.hiddenInput}
                        type="file"
                        accept={FILE_ACCEPT}
                        onChange={handleLocalFile}
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {t('liveDocAi.uploadFromLocal')}
                      </button>
                      <button type="button" disabled={busy} onClick={() => openPicker('space')}>
                        {t('liveDocAi.uploadFromSpace')}
                      </button>
                      <div className={styles.menuAnchor}>
                        <button
                          ref={uploadMenuBtnRef}
                          type="button"
                          className={styles.compactButton}
                          disabled={busy}
                          onClick={() => {
                            setFileMenuItemId(null);
                            setSummaryMenuOpen(false);
                            setUploadMenuOpen((value) => !value);
                          }}
                          aria-label={t('liveDocAi.moreUploadOptions')}
                        >
                          •••
                        </button>
                      </div>
                    </div>
                  </div>
                </footer>
              </div>
            )}

            {activeTab === 'summary' && (
              <div className={styles.summaryTab}>
                <div className={styles.summaryHeader}>
                  <h3>{state.summary.templateTitle || t('toolbar.liveDocPanelSummary')}</h3>
                  <div className={styles.menuAnchor}>
                    <button
                      ref={summaryMenuBtnRef}
                      type="button"
                      className={styles.moreButton}
                      onClick={() => {
                        setFileMenuItemId(null);
                        setUploadMenuOpen(false);
                        setSummaryMenuOpen((value) => !value);
                      }}
                    >
                      •••
                    </button>
                  </div>
                </div>
                <div className={styles.summaryContent}>
                  {state.summary.phase === 'error' ? (
                    <div className={styles.empty}>
                      {state.summary.error || t('liveDocAi.summaryError')}
                    </div>
                  ) : state.summary.phase === 'loading' ? (
                    <div className={styles.empty}>
                      {t('liveDocAi.summaryGenerating', {
                        percent: Math.round(state.summary.progress * 100),
                      })}
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
                      <span>{t('liveDocAi.noSummary')}</span>
                      <button type="button" onClick={() => setSummaryOptionsOpen(true)}>
                        {t('liveDocAi.generateNow')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'transcript' && (
              <div className={styles.transcriptTab}>
                <div className={styles.searchBox}>
                  <span aria-hidden>⌕</span>
                  <input
                    value={transcriptSearch}
                    onChange={(event) => setTranscriptSearch(event.target.value)}
                    placeholder={t('liveDocAi.searchTranscript')}
                  />
                  <button type="button" className={styles.moreButton} aria-label={t('liveDocAi.more')}>
                    •••
                  </button>
                </div>
                <div className={styles.transcriptBody}>
                  {state.transcript.error && (
                    <div className={styles.empty}>{state.transcript.error}</div>
                  )}
                  {state.transcript.loading && (
                    <div className={styles.empty}>{t('liveDocAi.loadingTranscript')}</div>
                  )}
                  {!state.transcript.error &&
                    !state.transcript.loading &&
                    !transcriptGroups.length && (
                      <div className={styles.empty}>{t('liveDocAi.noTranscript')}</div>
                    )}
                  {transcriptGroups.map((group, groupIndex) => (
                    <section
                      key={`${group.elapsed}-${groupIndex}`}
                      className={styles.transcriptGroup}
                    >
                      {groupIndex > 0 && <div className={styles.timeDivider}>{group.elapsed}</div>}
                      {group.items.map((message, index) => {
                        const isSelf = message.userName === state.transcript.selfUserName;
                        const showSpeaker =
                          index === 0 || message.userName !== group.items[index - 1].userName;
                        return (
                          <div
                            key={`${message.id}-${index}`}
                            className={isSelf ? styles.messageSelfWrap : styles.messageWrap}
                          >
                            {showSpeaker && (
                              <div className={isSelf ? styles.speakerSelf : styles.speaker}>
                                {message.userName}
                              </div>
                            )}
                            <div className={isSelf ? styles.messageSelf : styles.message}>
                              {message.captionContent}
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  ))}
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
                <button type="button" className={styles.primaryButton} onClick={submitSummary}>
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
          <button type="button" onClick={() => setFileMenuItemId(null)}>
            {t('liveDocAi.aiPresentation')}
          </button>
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
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setUploadMenuOpen(false);
              runAction('document.addBlank');
            }}
          >
            {t('liveDocAi.uploadBlankPage')}
          </button>
          <button
            type="button"
            onClick={() => {
              setUploadMenuOpen(false);
              openPicker('favorite');
            }}
          >
            {t('liveDocAi.uploadFromFiles')}
          </button>
        </FloatingMenu>
      )}

      {summaryMenuOpen && (
        <FloatingMenu
          anchorRef={summaryMenuBtnRef}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setSummaryMenuOpen(false);
              setSummaryOptionsOpen(true);
            }}
          >
            {t('liveDocAi.regenerateSummary')}
          </button>
          <button type="button" onClick={() => setSummaryMenuOpen(false)}>
            {t('liveDocAi.copy')}
          </button>
          <button type="button" onClick={() => setSummaryMenuOpen(false)}>
            {t('liveDocAi.summaryDocument')}
          </button>
          <button type="button" onClick={() => setSummaryMenuOpen(false)}>
            {t('liveDocAi.aiInstruction')}
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
            <span aria-hidden>⌕</span>
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
              <span className={styles.pickerItemIcon} aria-hidden>
                <Image
                  src={
                    item.fileType
                      ? resolveLiveDocFileImg(item.fileType)
                      : resolveLiveDocFileImgByName(item.fileName || item.title)
                  }
                  alt=""
                  width={20}
                  height={20}
                  unoptimized
                />
              </span>
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
