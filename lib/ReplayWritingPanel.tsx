'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Pencil, Play, Undo2, Plus, X, Check, Menu, Sparkles, Trash2, RefreshCw, FileDown, Paperclip } from 'lucide-react';
import { authFetch } from '@/lib/kloudSession';
import { resolveLiveDocBaseUrl } from '@/lib/livedoc/client';
import { saveWritingPdf } from '@/lib/livedoc/saveWritingPdf';
import { useI18n } from '@/lib/i18n';
import {
  DEFAULT_WRITING_LANGUAGE, DEFAULT_WRITING_VOICE, WRITING_DESCRIPTION_LIMIT, WRITING_LENGTHS, WRITING_NAME_LIMIT,
  WRITING_TYPES, WRITING_VOICES, availableWritingSuggestions, isWritingLength, isWritingVoice,
  type ReplayWriting, type WritingBrief, type WritingLanguage, type WritingSuggestion, type WritingType, type WritingVoice, type WritingLength,
} from '@/lib/replayWriting';
import { WritingLanguageSelect } from '@/lib/WritingLanguageSelect';
import type { MeetingPresentation } from '@/lib/meetingPresentation';
import s from '@/styles/Replay.module.css';

const improvementOptions = ['speakers', 'terms', 'review'] as const;
type ImprovementOption = (typeof improvementOptions)[number];

type Draft = Omit<WritingBrief, 'minutes'> & {
  id: string;
  voice: WritingVoice;
  language: WritingLanguage;
  minutes: WritingLength | 'auto';
  mode: 'new' | 'edit' | 'improve' | 'delete' | 'apply' | 'regenerate';
  sourceId?: string;
  checks: ImprovementOption[];
  type?: WritingType;
};

export function ReplayWritingPanel({
  recordingKey, canManage, hasTranscript, activeWriting, onSmartPlay, onReturn, onSelectionChange, scriptHostRef, playbackHostRef, legacy, legacyFocus,
}: {
  recordingKey: string;
  canManage: boolean;
  hasTranscript: boolean;
  activeWriting?: string;
  onSmartPlay: (id: string, presentation: MeetingPresentation) => void;
  onReturn: () => void;
  onSelectionChange: (id: string | null, presentation: MeetingPresentation | null) => void;
  scriptHostRef: (element: HTMLDivElement | null) => void;
  playbackHostRef: (element: HTMLDivElement | null) => void;
  legacy?: ReactNode;
  legacyFocus?: number;
}) {
  const { t } = useI18n();
  const endpoint = `/api/recordings/${encodeURIComponent(recordingKey)}/writing`;
  const [writings, setWritings] = useState<ReplayWriting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const [suggestions, setSuggestions] = useState<WritingSuggestion[]>();
  const [suggestionFailed, setSuggestionFailed] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState(false);
  const [selected, setSelected] = useState(activeWriting ?? (legacy && (legacyFocus || !canManage) ? 'legacy' : ''));
  const [draft, setDraft] = useState<Draft>();
  const [chooser, setChooser] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLDetailsElement>(null);
  const actions = useRef<HTMLDetailsElement>(null);
  const dialogMode = draft?.mode ?? (chooser ? 'chooser' : null);
  const dialogOpen = dialogMode !== null;

  useEffect(() => {
    const element = dialog.current;
    if (!dialogOpen || !element) return;
    element.showModal();
    return () => element.close();
  }, [dialogOpen]);

  useEffect(() => {
    if (dialogMode) dialog.current?.querySelector<HTMLElement>('textarea[required], input[required], input[type=checkbox]:enabled, [data-cancel]')?.focus();
  }, [dialogMode]);

  useEffect(() => {
    function closePicker(event: PointerEvent) {
      for (const menu of [picker.current, actions.current]) {
        if (menu && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
      }
    }
    document.addEventListener('pointerdown', closePicker);
    return () => document.removeEventListener('pointerdown', closePicker);
  }, []);

  const pending = writings.some(item => item.status === 'GENERATING');
  const hasSavedWrite = writings.some(item => item.status !== 'FAILED');
  const canCreate = canManage && hasTranscript;
  const current = writings.find(item => item.id === selected);
  const presenting = Boolean(current && activeWriting === current.id);

  const selectedPresentation = current?.presentation ?? null;
  useEffect(() => {
    onSelectionChange(selectedPresentation ? selected : null, selectedPresentation);
  }, [onSelectionChange, selected, selectedPresentation]);

  const load = useCallback(async (signal: AbortSignal) => {
    const response = await authFetch(endpoint, { cache: 'no-store', signal });
    if (!response.ok) throw new Error('Could not load AI Writes');
    const { writings: saved }: { writings: ReplayWriting[] } = await response.json();
    if (!signal.aborted) setWritings(saved);
    return saved;
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(entries => {
      if (controller.signal.aborted) return;
      const first = entries.find(item => item.status === 'READY') ?? entries[0];
      if (first) setSelected(value => value || first.id);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadFailed(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (legacyFocus) {
      setChooser(false);
      setDraft(undefined);
      setSelected('legacy');
    }
  }, [legacyFocus]);

  const shouldSuggest = canCreate && !loading && !loadFailed && (chooser || !hasSavedWrite) && suggestions === undefined && !suggestionFailed;
  const availableSuggestions = availableWritingSuggestions(suggestions ?? [], writings);
  useEffect(() => {
    if (!shouldSuggest) return;
    const controller = new AbortController();
    authFetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recommend: true }), signal: controller.signal,
    }).then(response => {
      if (!response.ok) throw new Error('Could not analyze meeting');
      return response.json();
    }).then(result => {
      if (!controller.signal.aborted) setSuggestions(result?.suggestions ?? []);
    }).catch(() => {
      if (!controller.signal.aborted) setSuggestionFailed(true);
    });
    return () => controller.abort();
  }, [endpoint, shouldSuggest]);

  useEffect(() => {
    if (!pending || submitting) return;
    const controller = new AbortController();
    let timer: number;
    async function poll() {
      await load(controller.signal).catch(() => undefined);
      if (!controller.signal.aborted) timer = window.setTimeout(poll, 3500);
    }
    timer = window.setTimeout(poll, 3500);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [load, pending, submitting]);

  function selectWrite(id: string) {
    if (picker.current) picker.current.open = false;
    setSelected(id);
    setChooser(false);
    setPdfError(false);
    setDraft(undefined);
    setRequestFailed(false);
  }

  function closeActions() {
    if (actions.current) {
      actions.current.open = false;
      actions.current.querySelector('summary')?.focus();
    }
  }

  function openDraft(brief?: WritingBrief & { id?: string }, item?: ReplayWriting, mode: Draft['mode'] = item?.presentation ? 'edit' : 'new', checks: ImprovementOption[] = [], type?: WritingType) {
    closeActions();
    if (activeWriting) onReturn();
    setRequestFailed(false);
    setChooser(false);
    setDraft({
      id: mode === 'improve' && item?.presentation ? crypto.randomUUID() : item?.id ?? brief?.id ?? crypto.randomUUID(),
      name: brief?.name ?? '',
      description: mode === 'improve' && item?.presentation
        ? checks.map(check => t(`replay.write.improvement.${check}.prompt`)).join('\n\n')
        : brief?.description ?? '',
      minutes: brief?.minutes ?? 'auto',
      voice: item?.voice ?? DEFAULT_WRITING_VOICE,
      language: item?.language ?? DEFAULT_WRITING_LANGUAGE,
      mode,
      checks,
      type,
      sourceId: mode === 'improve' ? (item?.presentation ? item.id : item?.sourceId) : undefined,
    });
  }

  function cancelDialog() {
    if (draft && chooser) {
      setDraft(undefined);
      setRequestFailed(false);
    } else {
      selectWrite(selected);
    }
  }

  function regenerate(item: ReplayWriting) {
    openDraft({ ...item, name: writeName(item), description: item.prompt ?? item.description }, item, 'regenerate');
  }

  async function save(entry: Draft) {
    if (submitting) return;
    setSubmitting(true);
    setRequestFailed(false);
    try {
      const editing = entry.mode === 'edit';
      const deleting = entry.mode === 'delete';
      const applying = entry.mode === 'apply';
      const response = await authFetch(endpoint, {
        method: deleting ? 'DELETE' : editing || applying ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(applying ? { id: entry.id, applyRepair: true } : deleting ? { id: entry.id } : editing
          ? { id: entry.id, name: entry.name, description: entry.description, voice: entry.voice, language: entry.language }
          : { id: entry.id, name: entry.name, description: entry.description, prompt: entry.description, minutes: entry.minutes,
              voice: entry.voice, language: entry.language, type: entry.type, sourceId: entry.sourceId, regenerate: entry.mode === 'regenerate' }),
      });
      if (!response.ok) throw new Error('Could not save AI Write');
      const { writings: saved, selectedId }: { writings: ReplayWriting[]; selectedId?: string } = await response.json();
      setWritings(saved);
      selectWrite(deleting ? (saved.find(item => item.status === 'READY') ?? saved[0])?.id ?? (legacy && !canCreate ? 'legacy' : '') : selectedId ?? entry.id);
    } catch {
      setRequestFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  function suggestionList() {
    return <>
      {suggestionFailed ? <div role="alert">
        <p>{t('replay.write.analysisFailed')}</p>
        <button type="button" className={s.tab} onClick={() => setSuggestionFailed(false)}>{t('replay.write.retry')}</button>
      </div> : suggestions === undefined ? (
        <div className={s.writingAnalysis} role="status">
          <span className={s.writingSpinner} aria-hidden="true" />
          <div><strong>{t('replay.write.analyzing')}</strong><p>{t('replay.write.analysisDetail')}</p></div>
        </div>
      ) : availableSuggestions.length ? <>
        <p className={s.muted}>{t('replay.write.chooseSuggestion')}</p>
        {WRITING_TYPES.map(type => {
          const group = availableSuggestions.filter(suggestion => (suggestion.type ?? 'recap') === type);
          return group.length > 0 && <section key={type}>
            <h3>{t(`replay.write.type.${type}`)}</h3>
            <div className={s.writingSuggestions}>
              {group.map(suggestion => (
                <button key={suggestion.id} type="button"
                  onClick={() => openDraft(suggestion, undefined, 'new', [], suggestion.type)}>
                  <strong>{suggestion.name}</strong><span>{suggestion.description}</span>
                </button>
              ))}
            </div>
          </section>;
        })}
      </> : <p className={s.muted}>{t('replay.write.noSuggestions')}</p>}
      {(suggestions !== undefined || suggestionFailed) &&
        <button type="button" className={s.tab} onClick={() => openDraft()}>{t('replay.write.customPrompt')}</button>}
    </>;
  }

  async function generatePdf(item: ReplayWriting) {
    if (pdfBusy) return;
    setPdfBusy(true);
    setPdfError(false);
    try {
      const query = new URLSearchParams({ write: item.id });
      let response = await authFetch(`${endpoint}/pdf?${query}`, { method: 'POST' });
      if (!response.ok) throw new Error('Could not generate PDF');
      if (response.headers.get('Content-Type')?.startsWith('application/pdf')) {
        const revision = response.headers.get('X-Writing-Revision');
        const meetingId = Number(response.headers.get('X-LiveDoc-Meeting'));
        const name = decodeURIComponent(response.headers.get('X-Pdf-Name') ?? 'AI Write.pdf');
        const attachmentId = await saveWritingPdf(meetingId, name, await response.arrayBuffer());
        query.set('link', '1');
        response = await authFetch(`${endpoint}/pdf?${query}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attachmentId, revision }),
        });
        if (!response.ok) throw new Error('Could not link the LiveDoc attachment');
      }
      const { pdf } = await response.json();
      setWritings(items => items.map(entry => entry.id === item.id ? { ...entry, pdf } : entry));
    } catch {
      setPdfError(true);
    } finally {
      setPdfBusy(false);
    }
  }

  function voiceField() {
    if (!draft) return null;
    return (
      <label>{t('replay.write.voice')}
        <span className={s.writingSelect}>
          <select value={draft.voice} onChange={event => {
            const voice = event.target.value;
            if (isWritingVoice(voice)) setDraft({ ...draft, voice });
          }}>
            {WRITING_VOICES.map(voice => <option key={voice} value={voice}>{t(`replay.write.voice.${voice}`)} · {t(`replay.write.voiceStyle.${voice}`)}</option>)}
          </select>
          <ChevronDown aria-hidden="true" />
        </span>
        <small className={s.muted}>{t(`replay.write.voiceStyle.${draft.voice}`)}</small>
      </label>
    );
  }

  if (loading) return <p className={s.writingNotice} role="status">{t('replay.loading')}</p>;
  if (loadFailed) return (
    <div className={s.tabBody}>
      <p className={s.writingNotice} role="alert">{t('replay.write.loadFailed')}</p>
      {legacy}
    </div>
  );

  const writeName = (item: ReplayWriting) => item.name || t(item.id.startsWith('legacy-') ? 'replay.write.legacyName' : 'replay.write.newTitle', { n: item.minutes });

  const repairOriginal = draft?.mode === 'apply' ? writings.find(item => item.id === current?.sourceId) : undefined;
  const repairSpeakers = draft?.mode === 'apply'
    ? [...new Map(current?.presentation?.slides.flatMap(slide =>
      slide.attribution ? [[slide.attribution.key, slide.attribution.name] as const] : [])).values()]
    : [];
  const validDraft = draft && (draft.mode === 'delete' || draft.mode === 'apply' ||
    (draft.mode === 'edit' ? draft.name.trim() : draft.description.trim()));
  const editLanguageChanged = draft?.mode === 'edit' && draft.language !== (current?.language ?? DEFAULT_WRITING_LANGUAGE);
  return (
    <div className={s.tabBody}>
      {hasSavedWrite && <div className={s.writingToolbar}>
        {writings.length || legacy ? (
          <details ref={picker} className={s.writingPicker + ' ' + s.writingSavedPicker} onKeyDown={event => {
            if (event.key === 'Escape' && event.currentTarget.open) {
              event.currentTarget.open = false;
              event.currentTarget.querySelector('summary')?.focus();
            }
          }}>
            <summary className={s.writingSavedTrigger}>
              <span>
                <span className={s.writingPickerLabel}>{t('replay.write.select')}</span>
                <span className={s.writingPickerTitle}>
                  {current ? writeName(current) : t(selected === 'legacy' ? 'replay.write.meetingNotes' : 'replay.write.selectPlaceholder')}
                </span>
              </span>
              <ChevronDown aria-hidden="true" />
            </summary>
            <div className={s.writingMenu}>
              {writings.map(item => (
                <button key={item.id} type="button" aria-current={selected === item.id ? 'true' : undefined}
                  onClick={() => { selectWrite(item.id); picker.current?.querySelector('summary')?.focus(); }}>
                  <span>{writeName(item)}</span>
                  {item.pdf && <Paperclip role="img" aria-label={t('replay.write.pdfAttachment')} />}
                  {selected === item.id && <Check aria-hidden="true" />}
                </button>
              ))}
              {legacy && <button type="button" aria-current={selected === 'legacy' ? 'true' : undefined}
                onClick={() => { selectWrite('legacy'); picker.current?.querySelector('summary')?.focus(); }}>
                <span>{t('replay.write.meetingNotes')}</span>
                {selected === 'legacy' && <Check aria-hidden="true" />}
              </button>}
            </div>
          </details>
        ) : <span className={s.muted}>{t('replay.write.noSaved')}</span>}
        {(canManage || presenting || current?.presentation) && <details ref={actions} className={s.writingPicker + ' ' + s.writingActionPicker}
          onKeyDown={event => {
            if (event.key === 'Escape' && event.currentTarget.open) {
              event.currentTarget.open = false;
              event.currentTarget.querySelector('summary')?.focus();
            }
          }}>
          <summary className={s.writingNew + ' ' + s.writingIconLabel} aria-label={t('replay.write.actions')}>
            <Menu aria-hidden="true" />
          </summary>
          <div className={s.writingMenu + ' ' + s.writingActionMenu}>
            {presenting && <button type="button" onClick={() => {
              if (actions.current) {
                actions.current.open = false;
                actions.current.querySelector('summary')?.focus();
              }
              onReturn();
            }}><Undo2 aria-hidden="true" /><span>{t('replay.write.originalPlayback')}</span></button>}
            {canManage && current?.presentation && !current.pdf && <button type="button" disabled={pdfBusy} onClick={() => {
              closeActions();
              void generatePdf(current);
            }}><FileDown aria-hidden="true" /><span>{t('replay.write.savePdfToLiveDoc')}</span></button>}
            {canManage && <>
              <button type="button" disabled={!current?.presentation}
                onClick={() => current && openDraft(current, current, 'edit')}><Pencil aria-hidden="true" /><span>{t('replay.write.edit')}</span></button>
              <button type="button" disabled={!canCreate} onClick={() => { closeActions(); setChooser(true); }}>
                <Plus aria-hidden="true" /><span>{t('replay.write.newButton')}</span></button>
              <button type="button" disabled={!current?.presentation || !canCreate}
                onClick={() => current && openDraft(current, current, 'improve')}><Sparkles aria-hidden="true" /><span>{t('replay.write.improve')}</span></button>
              <button type="button" disabled={!current?.presentation || !canCreate}
                onClick={() => current && openDraft(current, current, 'improve', ['speakers', 'review'])}>
                <Sparkles aria-hidden="true" /><span>{t('replay.write.repairSpeakers')}</span>
              </button>
              {current?.canApplyRepair && <button type="button"
                disabled={!writings.some(item => item.id === current.sourceId && item.presentation)}
                onClick={() => openDraft(current, current, 'apply')}>
                <Check aria-hidden="true" /><span>{t('replay.write.applyRepair')}</span>
              </button>}
              <button type="button" disabled={!current || current.status === 'GENERATING'}
                className={s.writingDanger} onClick={() => current && openDraft({ ...current, name: writeName(current) }, current, 'delete')}>
                <Trash2 aria-hidden="true" /><span>{t('replay.write.delete')}</span></button>
            </>}
          </div>
        </details>}
      </div>}
      {pdfBusy && <p className={s.writingNotice} role="status">{t('replay.write.pdfWorking')}</p>}
      {pdfError && <p className={s.writingNotice} role="alert">{t('replay.write.pdfTransferFailed')}</p>}

      {dialogOpen && <dialog ref={dialog} className={s.writingDialog} aria-labelledby="ai-write-dialog-title"
        onCancel={event => {
          event.preventDefault();
          if (!submitting) cancelDialog();
        }}>
        {chooser && !draft ? <div className={s.writingChooser}>
          <div className={s.writingDialogHeader}>
            <h2 id="ai-write-dialog-title">{t('replay.write.newTitle')}</h2>
            <button type="button" className={s.tab} data-cancel aria-label={t('replay.write.close')}
              onClick={() => setChooser(false)}><X aria-hidden="true" /></button>
          </div>
          {suggestions !== undefined && <h3>{t('replay.write.suggestions')}</h3>}
          {suggestionList()}
          {writings.length > 0 && <>
            <h3>{t('replay.write.savedWrites')}</h3>
            <div className={s.writingChooserSaved}>
              {writings.map(item => (
                <div key={item.id} className={s.writingChooserRow}>
                  <button type="button" className={s.tab} onClick={() => selectWrite(item.id)}>{writeName(item)}</button>
                  {item.status === 'GENERATING' ? <small>{t('replay.write.writing')}</small> : !item.sourceId && (
                    <button type="button" className={s.tab} onClick={() => regenerate(item)}>
                      <RefreshCw aria-hidden="true" />{t(item.status === 'FAILED' ? 'replay.write.retry' : 'replay.write.regenerate')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>}
        </div> : draft && <form onSubmit={event => {
          event.preventDefault();
          if (validDraft) void save(draft);
        }}>
          <div className={s.writingDialogHeader}>
            <h2 id="ai-write-dialog-title">{t(draft.mode === 'apply' ? 'replay.write.applyRepair' : draft.mode === 'improve' ? 'replay.write.improve' : draft.mode === 'delete' ? 'replay.write.deleteTitle' : draft.mode === 'edit' ? 'replay.write.editTitle' : draft.mode === 'regenerate' ? 'replay.write.regenerate' : 'replay.write.newTitle')}</h2>
            <button type="button" className={s.tab} aria-label={t('replay.write.close')} disabled={submitting}
              onClick={cancelDialog}><X aria-hidden="true" /></button>
          </div>
          <fieldset className={s.writingFields} disabled={submitting}>
            {draft.mode === 'apply' ? <>
              <p className={s.writingDeleteNote}>{t('replay.write.applyRepairConfirm', {
                name: repairOriginal ? writeName(repairOriginal) : '',
              })}</p>
              {repairSpeakers.length > 0 && <p className={s.muted}>
                {t('replay.write.repairSpeakerCount', { n: repairSpeakers.length })}{' '}{repairSpeakers.join(', ')}
              </p>}
              <details open>
                <summary>{t('replay.write.reviewRepairedPassages')}</summary>
                <ol className={s.writingRepairPreview}>
                  {current?.presentation?.slides.map((slide, index) => (
                    <li key={index}><strong>{slide.title}</strong><p>{slide.narration}</p></li>
                  ))}
                </ol>
              </details>
              {repairOriginal?.presentation && <details>
                <summary>{t('replay.write.reviewOriginalPassages')}</summary>
                <ol className={s.writingRepairPreview}>
                  {repairOriginal.presentation.slides.map((slide, index) => (
                    <li key={index}><strong>{slide.title}</strong><p>{slide.narration}</p></li>
                  ))}
                </ol>
              </details>}
              {Boolean(current?.presentation?.reviewTerms?.length) && <div>
                <strong>{t('replay.write.reviewTerms')}</strong>
                <ul>{current?.presentation?.reviewTerms?.map(term => <li key={term}>{term}</li>)}</ul>
              </div>}
            </> : draft.mode === 'delete' ? <p className={s.writingDeleteNote}>
              {t('replay.write.deleteConfirm', { name: draft.name })}
            </p> : draft.mode === 'improve' ? <>
              <p className={s.muted}>{t('replay.write.improveCopy')}</p>
              <div className={s.writingChecks}>
                {improvementOptions.map(option => (
                  <label key={option}>
                    <input type="checkbox" checked={draft.checks.includes(option)} onChange={event => {
                      const instruction = t(`replay.write.improvement.${option}.prompt`);
                      const checked = event.target.checked;
                      const paragraphs = draft.description.trim()
                        .split(/\n[ \t]*\n/).filter(paragraph => paragraph && paragraph !== instruction);
                      const description = (checked ? [...paragraphs, instruction] : paragraphs).join('\n\n');
                      if (description.length > WRITING_DESCRIPTION_LIMIT) return;
                      setDraft({ ...draft, description, checks: checked ? [...draft.checks, option] :
                        draft.checks.filter(check => check !== option) });
                    }} />
                    <span>{t(`replay.write.improvement.${option}`)}</span>
                  </label>
                ))}
                <label className={s.writingComingSoon}>
                  <input type="checkbox" disabled />
                  <span>{t('replay.write.improvement.shared')}</span>
                </label>
              </div>
              <label>{t('replay.write.improvementPrompt')}
                <textarea rows={5} maxLength={WRITING_DESCRIPTION_LIMIT} value={draft.description}
                  placeholder={t('replay.write.improvementHint')}
                  onChange={event => setDraft({ ...draft, description: event.target.value })} />
              </label>
            </> : draft.mode === 'edit' ? <>
              <label>{t('replay.write.name')}
                <input required maxLength={WRITING_NAME_LIMIT} value={draft.name}
                  onChange={event => setDraft({ ...draft, name: event.target.value })} />
              </label>
              <label>{t('replay.write.description')}
                <textarea rows={2} maxLength={WRITING_DESCRIPTION_LIMIT} value={draft.description}
                  onChange={event => setDraft({ ...draft, description: event.target.value })} />
              </label>
              {voiceField()}
            </> : <>
              <label>{t('replay.write.prompt')}
                <textarea required rows={4} maxLength={WRITING_DESCRIPTION_LIMIT} value={draft.description}
                  placeholder={t('replay.write.promptExample')}
                  onChange={event => setDraft({ ...draft, description: event.target.value })} />
              </label>
              <details className={s.writingOptions}>
                <summary>{t('replay.write.playbackSettings')}</summary>
                <div className={s.writingSettings}>
                  <label>{t('replay.write.length')}
                    <span className={s.writingSelect}>
                      <select value={draft.minutes} onChange={event => {
                        const minutes = event.target.value === 'auto' ? 'auto' : Number(event.target.value);
                        if (minutes === 'auto' || isWritingLength(minutes)) setDraft({ ...draft, minutes });
                      }}>
                        <option value="auto">{t('replay.write.autoLength')}</option>
                        {WRITING_LENGTHS.map(minutes => <option key={minutes} value={minutes}>{t('replay.minutes', { n: minutes })}</option>)}
                      </select>
                      <ChevronDown aria-hidden="true" />
                    </span>
                  </label>
                  {voiceField()}
                </div>
              </details>
            </>}
            {draft.mode !== 'delete' && draft.mode !== 'apply' && (
              <label>{t('replay.write.language')}
                <span className={s.writingSelect}>
                  <WritingLanguageSelect value={draft.language} onChange={language => setDraft({ ...draft, language })} />
                  <ChevronDown aria-hidden="true" />
                </span>
              </label>
            )}
          </fieldset>
          {requestFailed && <p className={s.writingDialogError} role="alert">
            {t(draft.mode === 'apply' ? 'replay.write.applyRepairFailed' : draft.mode === 'delete' ? 'replay.write.deleteFailed' : draft.mode === 'edit' ? 'replay.write.saveFailed' : 'replay.write.startFailed')}
          </p>}
          <div className={s.writingActions}>
            <button type="button" className={s.tab} data-cancel disabled={submitting}
              onClick={cancelDialog}>{t('replay.write.cancel')}</button>
            <button type="submit" className={draft.mode === 'delete' ? s.writingDeleteButton : s.primaryBtn}
              disabled={submitting || !validDraft}>
              {t(submitting ? 'replay.write.saving' : draft.mode === 'apply' ? 'replay.write.applyRepair' : draft.mode === 'delete' ? 'replay.write.delete' : draft.mode === 'regenerate' || editLanguageChanged ? 'replay.write.regenerate' : draft.mode === 'edit' ? 'replay.write.save' : draft.mode === 'improve' ? 'replay.write.createImproved' : 'replay.write.generate')}
            </button>
          </div>
        </form>}
      </dialog>}

      {selected === 'legacy' ? <>
        {!hasSavedWrite && canCreate && <button type="button" className={s.tab} onClick={() => selectWrite('')}>
          {t('replay.write.suggestions')}
        </button>}
        {legacy}
      </> : current?.presentation ? (
        <div className={s.scroll + ' ' + s.writingContent}>
          <div className={s.writingHeading}>
            <h2>{writeName(current)}</h2>
          </div>
          {current.description && <p className={s.muted}>{current.description}</p>}
          <p className={s.muted}>{t('replay.write.voiceSelected', { voice: t(`replay.write.voice.${current.voice}`) })}</p>
          {current.pdf && <div className={s.writingPdfAttachment}>
            <a className={s.tab + ' ' + s.writingIconLabel}
              href={`${resolveLiveDocBaseUrl()}/attachment/${current.pdf.attachmentId}`}
              target="_blank" rel="noopener noreferrer">
              <Paperclip aria-hidden="true" /><span>{current.pdf.name}</span>
            </a>
          </div>}
          {presenting ? <div ref={playbackHostRef} /> : (
            <button type="button" className={s.primaryBtn + ' ' + s.writingIconLabel} onClick={() => {
              if (current.presentation) onSmartPlay(current.id, current.presentation);
            }}><Play aria-hidden="true" /><span>{t('replay.write.aiPlay')}</span></button>
          )}
          {presenting ? (
            <div ref={scriptHostRef} className={s.smartScript} aria-label={t('replay.write.script')} />
          ) : current.presentation.slides.map((slide, index) => (
            <section key={index}><h3>{slide.title}</h3><p>{slide.narration}</p></section>
          ))}
          {!presenting && Boolean(current.presentation.reviewTerms?.length) && (
            <section className={s.writingReview}>
              <h3>{t('replay.write.reviewTerms')}</h3>
              <ul>{current.presentation.reviewTerms?.map(term => <li key={term}>{term}</li>)}</ul>
            </section>
          )}
          <p className={s.muted}>{t('replay.aiNote')}</p>
        </div>
      ) : current?.status === 'GENERATING' ? (
        <p className={s.writingNotice} role="status">{current.name ? t('replay.write.generating', { name: current.name }) : t('replay.write.writing')}</p>
      ) : (
        <div className={s.scroll + ' ' + s.writingContent}>
          {current?.status === 'FAILED' && <>
            <p role="alert">{t('replay.write.failed')}</p>
            {canCreate && <button type="button" className={s.tab}
              onClick={() => openDraft({ ...current, name: writeName(current) }, current, current.sourceId ? 'improve' : 'new')}>{t('replay.write.retry')}</button>}
          </>}
          {canCreate && !hasSavedWrite ? (
            <>
              {suggestions !== undefined && <h2>{t('replay.write.suggestions')}</h2>}
              {suggestionList()}
              {legacy && <button type="button" className={s.tab} onClick={() => selectWrite('legacy')}>
                {t('replay.write.meetingNotes')}
              </button>}
            </>
          ) : !current && (legacy ?? <p>{t(hasTranscript ? 'replay.write.emptyViewer' : 'replay.write.noTranscript')}</p>)}
        </div>
      )}
    </div>
  );
}
