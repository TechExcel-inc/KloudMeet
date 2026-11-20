'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { authFetch } from '@/lib/kloudSession';
import { useI18n } from '@/lib/i18n';
import { isWritingLength, WRITING_LENGTHS, type ReplayWriting, type WritingLength } from '@/lib/replayWriting';
import { PresentationPlayer, type PlayerMemory } from '@/lib/notesReplay/PresentationPlayer';
import type { MeetingPresentation } from '@/lib/meetingPresentation';
import type { ShareShot } from '@/lib/shareShot';
import s from '@/styles/Replay.module.css';
import playerStyles from '@/styles/NotesReplayStage.module.css';

function SmartPlay({
  presentation, shots, onClose, onPause, onJump,
}: {
  presentation: MeetingPresentation;
  shots: ShareShot[];
  onClose: () => void;
  onPause: () => void;
  onJump: (seconds: number) => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const memory = useRef<PlayerMemory | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog ref={dialog} className={s.smartPlayDialog} aria-label={t('replay.write.smartPlay')}
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className={playerStyles.stage}>
        <PresentationPlayer presentation={presentation} writingShots={shots}
          meetingTitle={presentation.title} meetingMeta="" meetingSeconds={presentation.meetingSeconds}
          memory={memory} modeSwitch={<button type="button" className={playerStyles.ghostBtn} onClick={onClose}>{t('settings.close')}</button>}
          canManage={false} regenerating={false} onRegenerate={onClose} onTakeOver={onPause}
          onJump={(seconds) => { onClose(); onJump(seconds); }}
          onTimeline={onClose} speakerColor={() => 'inherit'} />
      </div>
    </dialog>
  );
}

export function ReplayWritingPanel({
  recordingKey, canManage, hasTranscript, shots, onPause, onSeek, legacy, legacyFocus,
}: {
  recordingKey: string;
  canManage: boolean;
  hasTranscript: boolean;
  shots: ShareShot[];
  onPause: () => void;
  onSeek: (seconds: number) => void;
  legacy?: ReactNode;
  legacyFocus?: number;
}) {
  const { t } = useI18n();
  const endpoint = `/api/recordings/${encodeURIComponent(recordingKey)}/writing`;
  const [writings, setWritings] = useState<ReplayWriting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const [recommended, setRecommended] = useState<WritingLength>();
  const [selected, setSelected] = useState<WritingLength | 'new' | 'legacy'>(legacy && (legacyFocus || !canManage) ? 'legacy' : 'new');
  const [choice, setChoice] = useState<WritingLength>();
  const [submitting, setSubmitting] = useState(false);
  const [smartPlay, setSmartPlay] = useState<MeetingPresentation | null>(null);
  const pending = writings.some((item) => item.status === 'GENERATING');
  const current = writings.find((item) => item.minutes === selected);
  const available = WRITING_LENGTHS.filter((minutes) =>
    !writings.some((item) => item.minutes === minutes && item.status !== 'FAILED'));
  const showNew = canManage && hasTranscript && available.length > 0;
  const shouldRecommend = !loading && !loadFailed && showNew && selected === 'new' && !recommended;
  const chosen = choice && available.includes(choice) ? choice :
    recommended && available.includes(recommended) ? recommended : available[0];

  const load = useCallback(async (signal: AbortSignal) => {
    const response = await authFetch(endpoint, { cache: 'no-store', signal });
    if (!response.ok) throw new Error('Could not load AI recaps');
    const result = await response.json();
    const saved = result.writings as ReplayWriting[];
    if (!signal.aborted) setWritings(saved);
    return saved;
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then((entries) => {
      if (controller.signal.aborted) return;
      const first = entries.find((item) => item.status === 'READY') ?? entries[0];
      if (first) setSelected((value) => value === 'new' ? first.minutes : value);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadFailed(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (legacyFocus) setSelected('legacy');
  }, [legacyFocus]);

  useEffect(() => {
    if (!shouldRecommend) return;
    const controller = new AbortController();
    authFetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recommend: true }), signal: controller.signal,
    }).then((response) => response.ok ? response.json() : null).then((result) => {
      const minutes = result?.recommended;
      if (!controller.signal.aborted && isWritingLength(minutes)) setRecommended(minutes);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [endpoint, shouldRecommend]);

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => void load(controller.signal).catch(() => undefined), 3500);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [load, pending]);

  async function generate(minutes: WritingLength) {
    if (submitting) return;
    setSubmitting(true);
    setRequestFailed(false);
    try {
      const response = await authFetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes }),
      });
      if (!response.ok) throw new Error('Could not start writing');
      setWritings((await response.json()).writings);
      setSelected(minutes);
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

  return (
    <div className={s.tabBody}>
      {(writings.length > 0 || legacy) && (
        <div className={s.writingTabs} role="tablist" aria-label={t('replay.write.versions')}>
          {[...writings].sort((a, b) => a.minutes - b.minutes).map((item) => (
            <button key={item.minutes} type="button" role="tab" aria-selected={selected === item.minutes}
              className={selected === item.minutes ? s.tabOn : s.tab} onClick={() => setSelected(item.minutes)}>
              {t('replay.minutes', { n: item.minutes })}
            </button>
          ))}
          {legacy && <button type="button" role="tab" aria-selected={selected === 'legacy'}
            className={selected === 'legacy' ? s.tabOn : s.tab} onClick={() => setSelected('legacy')}>
            {t('replay.write.meetingNotes')}
          </button>}
          {showNew && <button type="button" role="tab" aria-selected={selected === 'new'}
            className={selected === 'new' ? s.tabOn : s.tab} onClick={() => setSelected('new')}>
            {t('replay.write.new')}
          </button>}
        </div>
      )}

      {selected === 'legacy' ? legacy : current?.presentation ? (
        <div className={s.scroll + ' ' + s.writingContent}>
          <h2>{current.presentation.title}</h2>
          <button type="button" className={s.primaryBtn} onClick={() => {
            onPause();
            setSmartPlay(current.presentation);
          }}>{t('replay.write.smartPlay')}</button>
          {current.presentation.slides.map((slide, index) => (
            <section key={index}>
              <h3>{slide.title}</h3>
              <p>{slide.narration}</p>
            </section>
          ))}
          <p className={s.muted}>{t('replay.aiNote')}</p>
        </div>
      ) : current?.status === 'GENERATING' ? (
        <p className={s.writingNotice} role="status">{t('replay.write.writing')}</p>
      ) : current?.status === 'FAILED' ? (
        <div className={s.writingContent}>
          <p role="alert">{t('replay.write.failed')}</p>
          {canManage && <button type="button" className={s.primaryBtn} disabled={submitting}
            onClick={() => void generate(current.minutes)}>{t('replay.write.retry')}</button>}
        </div>
      ) : showNew ? (
        <form className={s.scroll + ' ' + s.writingContent} onSubmit={(event) => {
          event.preventDefault();
          if (chosen) void generate(chosen);
        }}>
          <h2>{t('replay.write.choose')}</h2>
          <p className={s.muted}>{t('replay.write.target')}</p>
          <fieldset className={s.writingChoices} disabled={submitting}>
            <legend className={s.visuallyHidden}>{t('replay.write.choose')}</legend>
            {available.map((minutes) => (
              <label key={minutes}>
                <input type="radio" name="recap-length" value={minutes}
                  checked={chosen === minutes} onChange={() => setChoice(minutes)} />
                {t('replay.minutes', { n: minutes })}
                {recommended === minutes && <small>{t('replay.write.recommended')}</small>}
              </label>
            ))}
          </fieldset>
          <button type="submit" className={s.primaryBtn} disabled={submitting}>
            {t(submitting ? 'replay.write.writing' : 'replay.write.create')}
          </button>
        </form>
      ) : (
        <p className={s.writingNotice}>{t(hasTranscript ? 'replay.write.emptyViewer' : 'replay.write.noTranscript')}</p>
      )}
      {requestFailed && <p className={s.writingNotice} role="alert">{t('replay.write.failed')}</p>}

      {smartPlay && (
        <SmartPlay presentation={smartPlay} shots={shots} onClose={() => setSmartPlay(null)} onPause={onPause} onJump={onSeek} />
      )}
    </div>
  );
}
