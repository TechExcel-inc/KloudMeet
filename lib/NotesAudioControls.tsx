'use client';

import { useId, useRef, useState } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import { authFetch } from '@/lib/kloudSession';
import { useI18n } from '@/lib/i18n';
import { DEFAULT_WRITING_LANGUAGE, DEFAULT_WRITING_VOICE, isWritingVoice, WRITING_VOICES, type NotesAudio, type WritingLanguage, type WritingVoice } from '@/lib/replayWriting';
import { WritingLanguageSelect } from '@/lib/WritingLanguageSelect';
import s from '@/styles/Replay.module.css';

export function NotesAudioControls({ recordingKey, audio, canManage, hasTranscript, selected, onChange, onTogglePlayback }: {
  recordingKey: string;
  audio: NotesAudio | null;
  canManage: boolean;
  hasTranscript: boolean;
  selected: boolean;
  onChange: (audio: NotesAudio) => void;
  onTogglePlayback: () => void;
}) {
  const { t } = useI18n();
  const [voice, setVoice] = useState<WritingVoice>(audio?.voice ?? DEFAULT_WRITING_VOICE);
  const [language, setLanguage] = useState<WritingLanguage>(audio?.language ?? DEFAULT_WRITING_LANGUAGE);
  const [submitting, setSubmitting] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogTitle = useId();
  const ready = audio?.status === 'READY';
  const pending = submitting || audio?.status === 'GENERATING';
  const failed = !pending && audio?.status === 'FAILED';
  const dialogAction = ready ? 'replay.notesAudio.regenerate' : 'replay.notesAudio.enable';

  function openSettings() {
    setVoice(audio?.voice ?? DEFAULT_WRITING_VOICE);
    setLanguage(audio?.language ?? DEFAULT_WRITING_LANGUAGE);
    setRequestFailed(false);
    dialog.current?.showModal();
  }

  async function generate() {
    if (pending) return;
    setSubmitting(true);
    setRequestFailed(false);
    try {
      const response = await authFetch(`/api/recordings/${encodeURIComponent(recordingKey)}/notes-audio`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice, language }),
      });
      if (!response.ok) throw new Error('AI audio request failed');
      const { notesAudio } = await response.json() as { notesAudio: NotesAudio | null };
      if (!notesAudio) throw new Error('AI audio status is missing');
      dialog.current?.close();
      onChange(notesAudio);
    } catch {
      setRequestFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (!canManage && !audio) return null;

  return (
    <div className={s.notesAudioOptions}>
      <div className={s.notesAudioRow}>
        <span role="status" className={s.notesAudioStatus}>
          {t(pending ? 'replay.notesAudio.generating' : ready ? 'replay.notesAudio.ready' : 'replay.notesAudio.title')}
        </span>
        {ready && (
          <button type="button" className={s.notesAudioAction} onClick={onTogglePlayback}>
            {t(selected ? 'replay.notesAudio.original' : 'replay.notesAudio.play')}
          </button>
        )}
        {canManage && !ready && !pending && (
          <button type="button" className={s.primaryBtn} disabled={!hasTranscript} onClick={openSettings} aria-haspopup="dialog">
            {t(failed ? 'replay.write.retry' : 'replay.notesAudio.enable')}
          </button>
        )}
        {canManage && ready && !pending && (
          <button type="button" className={s.notesAudioAction} onClick={openSettings} aria-haspopup="dialog"
            aria-label={t(dialogAction)} title={t(dialogAction)}>
            <Menu size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      {canManage && (
        <dialog ref={dialog} className={s.writingDialog} aria-labelledby={dialogTitle} onCancel={event => {
          if (submitting) event.preventDefault();
        }}>
          <form onSubmit={event => {
            event.preventDefault();
            void generate();
          }}>
            <div className={s.writingDialogHeader}>
              <h2 id={dialogTitle}>{t(dialogAction)}</h2>
              <button type="button" className={s.tab} disabled={submitting} aria-label={t('replay.write.close')}
                onClick={() => dialog.current?.close()}><X aria-hidden="true" /></button>
            </div>
            <fieldset className={s.writingFields} disabled={submitting}>
              <label>{t('replay.write.voice')}
                <span className={s.writingSelect}>
                  <select value={voice} onChange={event => {
                    if (isWritingVoice(event.target.value)) setVoice(event.target.value);
                  }}>
                    {WRITING_VOICES.map(item => (
                      <option key={item} value={item}>{t(`replay.write.voice.${item}`)} · {t(`replay.write.voiceStyle.${item}`)}</option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" />
                </span>
              </label>
              <label>{t('replay.write.language')}
                <span className={s.writingSelect}>
                  <WritingLanguageSelect value={language} onChange={setLanguage} />
                  <ChevronDown aria-hidden="true" />
                </span>
              </label>
            </fieldset>
            {requestFailed && <p className={s.writingDialogError} role="alert">{t('replay.notesAudio.failed')}</p>}
            <div className={s.writingActions}>
              <button type="button" className={s.tab} disabled={submitting} onClick={() => dialog.current?.close()}>
                {t('replay.write.cancel')}
              </button>
              <button type="submit" className={s.primaryBtn} disabled={pending}>
                {t(submitting ? 'replay.notesAudio.generating' : dialogAction)}
              </button>
            </div>
          </form>
        </dialog>
      )}
      {failed && <p className={s.notesAudioError} role="alert">{t('replay.notesAudio.failed')}</p>}
      {canManage && !audio && !hasTranscript && <p className={s.notesAudioHint}>{t('replay.notesAudio.needsTranscript')}</p>}
    </div>
  );
}
