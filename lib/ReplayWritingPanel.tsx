'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { authFetch } from '@/lib/kloudSession';
import { useI18n } from '@/lib/i18n';
import {
  DEFAULT_WRITING_VOICE, WRITING_DESCRIPTION_LIMIT, WRITING_LENGTHS, WRITING_NAME_LIMIT,
  WRITING_SECTION_LIMIT, WRITING_VOICES, isWritingLength, isWritingVoice,
  type ReplayWriting, type WritingBrief, type WritingVoice,
} from '@/lib/replayWriting';
import type { MeetingPresentation, PresentationSlide } from '@/lib/meetingPresentation';
import s from '@/styles/Replay.module.css';

type Draft = WritingBrief & {
  id: string;
  voice: WritingVoice;
  sections?: Pick<PresentationSlide, 'title' | 'narration'>[];
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
      minutes: brief?.minutes ?? 3,
      voice: item?.voice ?? DEFAULT_WRITING_VOICE,
      sections: item?.presentation?.slides.map(({ title, narration }) => ({ title, narration })),
    });
  }

  async function save(entry: Draft) {
    if (submitting) return;
    setSubmitting(true);
    setRequestFailed(false);
    try {
      const response = await authFetch(endpoint, {
        method: entry.sections ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
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

  if (loading) return <p className={s.writingNotice} role="status">{t('replay.loading')}</p>;
  if (loadFailed) return (
    <div className={s.tabBody}>
      <p className={s.writingNotice} role="alert">{t('replay.write.loadFailed')}</p>
      {legacy}
    </div>
  );

  const writeName = (item: ReplayWriting) => item.name || t('replay.write.legacyName', { n: item.minutes });

  return (
    <div className={s.tabBody}>
      <div className={s.writingToolbar}>
        <label>
          {t('replay.write.select')}
          <select value={draft && !draft.sections ? '' : selected} disabled={submitting || (!writings.length && !legacy)}
            title={current && writeName(current)} onChange={event => selectWrite(event.target.value)}>
            <option value="" disabled={Boolean(writings.length || legacy)}>
              {t(writings.length || legacy ? 'replay.write.selectPlaceholder' : 'replay.write.noSaved')}
            </option>
            {writings.map(item => <option key={item.id} value={item.id}>{writeName(item)}</option>)}
            {legacy && <option value="legacy">{t('replay.write.meetingNotes')}</option>}
          </select>
        </label>
        {canCreate && <button type="button" className={s.tab} disabled={submitting}
          onClick={() => openDraft()}>{t('replay.write.add')}</button>}
      </div>

      {draft ? (
        <form className={s.scroll + ' ' + s.writingContent} onSubmit={event => {
          event.preventDefault();
          if (draft.name.trim() && (draft.sections || draft.description.trim())) void save(draft);
        }}>
          <h2>{t(draft.sections ? 'replay.write.editTitle' : 'replay.write.newTitle')}</h2>
          <fieldset className={s.writingFields} disabled={submitting}>
            <label>{t('replay.write.name')}
              <input required maxLength={WRITING_NAME_LIMIT} value={draft.name}
                onChange={event => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label>{t('replay.write.description')}
              <textarea required={!draft.sections} rows={2} maxLength={WRITING_DESCRIPTION_LIMIT}
                placeholder={t('replay.write.descriptionHint')} value={draft.description}
                onChange={event => setDraft({ ...draft, description: event.target.value })} />
            </label>
            {draft.sections && <div className={s.writingFields}>
              <h3>{t('replay.write.content')}</h3>
              {draft.sections.map((section, index) => (
                <div key={index} className={s.writingFields}>
                  <label>{t('replay.write.sectionTitle', { n: index + 1 })}
                    <input required maxLength={140} value={section.title} onChange={event => {
                      const title = event.target.value;
                      setDraft({ ...draft, sections: draft.sections?.map((part, i) => i === index ? { ...part, title } : part) });
                    }} />
                  </label>
                  <label>{t('replay.write.sectionText', { n: index + 1 })}
                    <textarea required rows={4} maxLength={WRITING_SECTION_LIMIT} value={section.narration}
                      onChange={event => {
                        const narration = event.target.value;
                        setDraft({ ...draft, sections: draft.sections?.map((part, i) => i === index ? { ...part, narration } : part) });
                      }} />
                  </label>
                </div>
              ))}
            </div>}
            <div className={s.writingSettings}>
              {!draft.sections && <label>{t('replay.write.length')}
                <select value={draft.minutes} onChange={event => {
                  const minutes = Number(event.target.value);
                  if (isWritingLength(minutes)) setDraft({ ...draft, minutes });
                }}>
                  {WRITING_LENGTHS.map(minutes => <option key={minutes} value={minutes}>{t('replay.minutes', { n: minutes })}</option>)}
                </select>
              </label>}
              <label>{t('replay.write.voice')}
                <select value={draft.voice} onChange={event => {
                  const voice = event.target.value;
                  if (isWritingVoice(voice)) setDraft({ ...draft, voice });
                }}>
                  {WRITING_VOICES.map(voice => <option key={voice} value={voice}>{t(`replay.write.voice.${voice}`)}</option>)}
                </select>
              </label>
              <label>{t('replay.write.writer')}
                <select defaultValue="kloud">
                  <option value="kloud">AI Write</option>
                  <option value="ead" disabled>{t('replay.write.eadSoon')}</option>
                </select>
              </label>
            </div>
            <div className={s.writingActions}>
              <button type="button" className={s.tab} onClick={() => selectWrite(selected)}>{t('replay.write.cancel')}</button>
              <button type="submit" className={s.primaryBtn}
                disabled={!draft.name.trim() || (!draft.sections && !draft.description.trim()) ||
                  draft.sections?.some(section => !section.title.trim() || !section.narration.trim())}>
                {t(submitting ? 'replay.write.saving' : draft.sections ? 'replay.write.save' : 'replay.write.generate')}
              </button>
            </div>
          </fieldset>
        </form>
      ) : selected === 'legacy' ? legacy : current?.presentation ? (
        <div className={s.scroll + ' ' + s.writingContent}>
          <div className={s.writingHeading}>
            <h2>{writeName(current)}</h2>
            {canManage && <button type="button" className={s.tab}
              onClick={() => openDraft(current, current)}>{t('replay.write.edit')}</button>}
          </div>
          {current.description && <p className={s.muted}>{current.description}</p>}
          <p className={s.muted}>{t('replay.write.voiceSelected', { voice: t(`replay.write.voice.${current.voice}`) })}</p>
          <button type="button" className={s.primaryBtn} onClick={() => {
            if (presenting) onReturn();
            else if (current.presentation) onSmartPlay(current.id, current.presentation);
          }}>{t(presenting ? 'replay.write.originalPlayback' : 'replay.write.smartPlay')}</button>
          {presenting ? (
            <div ref={scriptHostRef} className={s.smartScript} aria-label={t('replay.write.script')} />
          ) : current.presentation.slides.map((slide, index) => (
            <section key={index}><h3>{slide.title}</h3><p>{slide.narration}</p></section>
          ))}
          <p className={s.muted}>{t('replay.aiNote')}</p>
        </div>
      ) : current?.status === 'GENERATING' ? (
        <p className={s.writingNotice} role="status">{t('replay.write.generating', { name: writeName(current) })}</p>
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
      {requestFailed && <p className={s.writingNotice} role="alert">
        {t(draft?.sections ? 'replay.write.saveFailed' : 'replay.write.startFailed')}
      </p>}
    </div>
  );
}
