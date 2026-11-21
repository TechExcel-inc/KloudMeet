'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Layers, Pencil, Play, Plus, X, Check } from 'lucide-react';
import { authFetch } from '@/lib/kloudSession';
import { useI18n } from '@/lib/i18n';
import {
  DEFAULT_WRITING_VOICE, WRITING_DESCRIPTION_LIMIT, WRITING_LENGTHS, WRITING_NAME_LIMIT,
  WRITING_VOICES, isWritingLength, isWritingVoice,
  type ReplayWriting, type WritingBrief, type WritingVoice, type WritingLength,
} from '@/lib/replayWriting';
import type { MeetingPresentation } from '@/lib/meetingPresentation';
import s from '@/styles/Replay.module.css';

type Draft = Omit<WritingBrief, 'minutes'> & {
  id: string;
  voice: WritingVoice;
  minutes: WritingLength | 'auto';
  editing: boolean;
};

export function ReplayWritingPanel({
  recordingKey, canManage, hasTranscript, activeWriting, onSmartPlay, onReturn, scriptHostRef, legacy, legacyFocus,
}: {
  recordingKey: string;
  canManage: boolean;
  hasTranscript: boolean;
  activeWriting?: string;
  onSmartPlay: (id: string, presentation: MeetingPresentation) => void;
  onReturn: () => void;
  scriptHostRef: (element: HTMLDivElement | null) => void;
  legacy?: ReactNode;
  legacyFocus?: number;
}) {
  const { t } = useI18n();
  const endpoint = `/api/recordings/${encodeURIComponent(recordingKey)}/writing`;
  const [writings, setWritings] = useState<ReplayWriting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const [suggestions, setSuggestions] = useState<WritingBrief[]>();
  const [selected, setSelected] = useState(activeWriting ?? (legacy && (legacyFocus || !canManage) ? 'legacy' : ''));
  const [draft, setDraft] = useState<Draft>();
  const [submitting, setSubmitting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLDetailsElement>(null);
  const draftOpen = Boolean(draft);

  useEffect(() => {
    const element = dialog.current;
    if (!draftOpen || !element) return;
    element.showModal();
    element.querySelector<HTMLElement>('textarea[required], input[required]')?.focus();
    return () => element.close();
  }, [draftOpen]);

  useEffect(() => {
    function closePicker(event: PointerEvent) {
      if (picker.current && event.target instanceof Node && !picker.current.contains(event.target)) {
        picker.current.open = false;
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
      setDraft(undefined);
      setSelected('legacy');
    }
  }, [legacyFocus]);

  const shouldSuggest = canCreate && !loading && !loadFailed && !hasSavedWrite && suggestions === undefined;
  useEffect(() => {
    if (!shouldSuggest) return;
    const controller = new AbortController();
    authFetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recommend: true }), signal: controller.signal,
    }).then(response => response.ok ? response.json() : null).then(result => {
      if (!controller.signal.aborted) setSuggestions(result?.suggestions ?? []);
    }).catch(() => {
      if (!controller.signal.aborted) setSuggestions([]);
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
    if (activeWriting && id !== activeWriting) onReturn();
    if (picker.current) picker.current.open = false;
    setSelected(id);
    setDraft(undefined);
    setRequestFailed(false);
  }

  function openDraft(brief?: WritingBrief, item?: ReplayWriting) {
    if (activeWriting) onReturn();
    setRequestFailed(false);
    setDraft({
      id: item?.id ?? crypto.randomUUID(),
      name: brief?.name ?? '',
      description: brief?.description ?? '',
      minutes: item?.presentation ? item.minutes : 'auto',
      voice: item?.voice ?? DEFAULT_WRITING_VOICE,
      editing: Boolean(item?.presentation),
    });
  }

  async function save(entry: Draft) {
    if (submitting) return;
    setSubmitting(true);
    setRequestFailed(false);
    try {
      const response = await authFetch(endpoint, {
        method: entry.editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.editing
          ? { id: entry.id, name: entry.name, description: entry.description, voice: entry.voice }
          : { id: entry.id, prompt: entry.description, minutes: entry.minutes, voice: entry.voice }),
      });
      if (!response.ok) throw new Error('Could not save AI Write');
      setWritings((await response.json()).writings);
      selectWrite(entry.id);
    } catch {
      setRequestFailed(true);
    } finally {
      setSubmitting(false);
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
            {WRITING_VOICES.map(voice => <option key={voice} value={voice}>{t(`replay.write.voice.${voice}`)}</option>)}
          </select>
          <ChevronDown aria-hidden="true" />
        </span>
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

  return (
    <div className={s.tabBody}>
      <div className={s.writingToolbar}>
        {writings.length || legacy ? (
          <details ref={picker} className={s.writingPicker} onKeyDown={event => {
            if (event.key === 'Escape' && event.currentTarget.open) {
              event.currentTarget.open = false;
              event.currentTarget.querySelector('summary')?.focus();
            }
          }}>
            <summary className={s.writingIconLabel}><Layers aria-hidden="true" />
              <span>{t('replay.write.savedWrites')}</span><ChevronDown aria-hidden="true" />
            </summary>
            <div className={s.writingMenu}>
              {writings.map(item => (
                <button key={item.id} type="button" aria-current={selected === item.id ? 'true' : undefined}
                  onClick={() => { selectWrite(item.id); picker.current?.querySelector('summary')?.focus(); }}>
                  <span><strong>{writeName(item)}</strong>
                    {item.description && <small>{item.description}</small>}
                  </span>
                  {selected === item.id && <Check aria-hidden="true" />}
                </button>
              ))}
              {legacy && <button type="button" aria-current={selected === 'legacy' ? 'true' : undefined}
                onClick={() => { selectWrite('legacy'); picker.current?.querySelector('summary')?.focus(); }}>
                <strong>{t('replay.write.meetingNotes')}</strong>
                {selected === 'legacy' && <Check aria-hidden="true" />}
              </button>}
            </div>
          </details>
        ) : <span className={s.muted}>{t('replay.write.noSaved')}</span>}
        {canCreate && <button type="button" className={s.writingNew + ' ' + s.writingIconLabel}
          onClick={() => openDraft()}><Plus aria-hidden="true" /><span>{t('replay.write.newButton')}</span></button>}
      </div>

      {draft && <dialog ref={dialog} className={s.writingDialog} aria-labelledby="ai-write-dialog-title"
        onCancel={event => {
          event.preventDefault();
          if (!submitting) selectWrite(selected);
        }}>
        <form onSubmit={event => {
          event.preventDefault();
          if (draft.editing ? draft.name.trim() : draft.description.trim()) void save(draft);
        }}>
          <div className={s.writingDialogHeader}>
            <h2 id="ai-write-dialog-title">{t(draft.editing ? 'replay.write.editTitle' : 'replay.write.newTitle')}</h2>
            <button type="button" className={s.tab} aria-label={t('replay.write.close')} disabled={submitting}
              onClick={() => selectWrite(selected)}><X aria-hidden="true" /></button>
          </div>
          <fieldset className={s.writingFields} disabled={submitting}>
            {draft.editing ? <>
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
          </fieldset>
          {requestFailed && <p className={s.writingDialogError} role="alert">
            {t(draft.editing ? 'replay.write.saveFailed' : 'replay.write.startFailed')}
          </p>}
          <div className={s.writingActions}>
            <button type="button" className={s.tab} disabled={submitting}
              onClick={() => selectWrite(selected)}>{t('replay.write.cancel')}</button>
            <button type="submit" className={s.primaryBtn}
              disabled={submitting || !(draft.editing ? draft.name.trim() : draft.description.trim())}>
              {t(submitting ? 'replay.write.saving' : draft.editing ? 'replay.write.save' : 'replay.write.generate')}
            </button>
          </div>
        </form>
      </dialog>}

      {selected === 'legacy' ? legacy : current?.presentation ? (
        <div className={s.scroll + ' ' + s.writingContent}>
          <div className={s.writingHeading}>
            <h2>{writeName(current)}</h2>
            {canManage && <button type="button" className={s.tab + ' ' + s.writingIconLabel}
              onClick={() => openDraft(current, current)}><Pencil aria-hidden="true" /><span>{t('replay.write.edit')}</span></button>}
          </div>
          {current.description && <p className={s.muted}>{current.description}</p>}
          <p className={s.muted}>{t('replay.write.voiceSelected', { voice: t(`replay.write.voice.${current.voice}`) })}</p>
          <button type="button" className={s.primaryBtn + ' ' + s.writingIconLabel} onClick={() => {
            if (presenting) onReturn();
            else if (current.presentation) onSmartPlay(current.id, current.presentation);
          }}>{!presenting && <Play aria-hidden="true" />}<span>{t(presenting ? 'replay.write.originalPlayback' : 'replay.write.smartPlay')}</span></button>
          {presenting ? (
            <div ref={scriptHostRef} className={s.smartScript} aria-label={t('replay.write.script')} />
          ) : current.presentation.slides.map((slide, index) => (
            <section key={index}><h3>{slide.title}</h3><p>{slide.narration}</p></section>
          ))}
          <p className={s.muted}>{t('replay.aiNote')}</p>
        </div>
      ) : current?.status === 'GENERATING' ? (
        <p className={s.writingNotice} role="status">{current.name ? t('replay.write.generating', { name: current.name }) : t('replay.write.writing')}</p>
      ) : (
        <div className={s.scroll + ' ' + s.writingContent}>
          {current?.status === 'FAILED' && <>
            <p role="alert">{t('replay.write.failed')}</p>
            {canCreate && <button type="button" className={s.tab}
              onClick={() => openDraft({ ...current, name: writeName(current) }, current)}>{t('replay.write.retry')}</button>}
          </>}
          {canCreate && !hasSavedWrite ? (
            <>
              <h2>{t('replay.write.suggestions')}</h2>
              {suggestions === undefined ? (
                <p className={s.muted} role="status">{t('replay.write.findingSuggestions')}</p>
              ) : suggestions.length ? (
                <>
                  <p className={s.muted}>{t('replay.write.suggestionHint')}</p>
                  <div className={s.writingSuggestions}>
                    {suggestions.map((suggestion, index) => (
                      <button key={index} type="button" onClick={() => openDraft(suggestion)}>
                        <strong>{suggestion.name}</strong><span>{suggestion.description}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : <p className={s.muted}>{t('replay.write.noSuggestions')}</p>}
            </>
          ) : !current && <p>{t(hasTranscript ? 'replay.write.emptyViewer' : 'replay.write.noTranscript')}</p>}
        </div>
      )}
    </div>
  );
}
