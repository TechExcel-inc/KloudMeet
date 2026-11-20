'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authFetch } from '@/lib/kloudSession';
import { useI18n } from '@/lib/i18n';
import s from '@/styles/Replay.module.css';

export function ReplayMeetingDialog({
  mode, title, description, viewPath, recordingKey, onClose, onSaved,
}: {
  mode: 'edit' | 'link';
  title: string;
  description: string;
  viewPath: string;
  recordingKey: string;
  onClose: () => void;
  onSaved: (meeting: { title: string; description: string | null }) => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(title);
  const [details, setDetails] = useState(description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState(viewPath);

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    setLink(new URL(viewPath, window.location.origin).href);
  }, [viewPath]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    setError(false);
    try {
      const response = await authFetch(`/api/recordings/${encodeURIComponent(recordingKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit-meeting', title: name, description: details }),
      });
      if (!response.ok) throw new Error('Could not save meeting details');
      onSaved(await response.json());
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} className={s.meetingDialog} aria-labelledby="replay-meeting-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <h2 id="replay-meeting-dialog-title">
        {t(mode === 'edit' ? 'replay.editMeeting' : 'replay.accessUrl')}
      </h2>
      {mode === 'edit' ? (
        <form onSubmit={save}>
          <label>
            {t('replay.meetingTitle')}
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={191} disabled={saving} />
          </label>
          <label>
            {t('replay.meetingDescription')}
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={191} disabled={saving} />
          </label>
          {error && <p role="alert">{t('replay.editMeetingFailed')}</p>}
          <div className={s.meetingDialogActions}>
            <button type="button" className={s.iconBtn} onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{t('settings.saveSettings')}</button>
          </div>
        </form>
      ) : (
        <>
          <input aria-label={t('replay.accessUrl')} value={link} readOnly onFocus={(e) => e.target.select()} />
          <div className={s.meetingDialogActions}>
            <button type="button" className={s.iconBtn} onClick={onClose}>{t('settings.close')}</button>
            <button type="button" className={s.primaryBtn} onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                setError(false);
              } catch {
                setError(true);
              }
            }}>
              {t(copied ? 'replay.accessUrlCopied' : 'replay.copyAccessUrl')}
            </button>
          </div>
          {error && <p role="alert">{t('replay.copyAccessUrlFailed')}</p>}
        </>
      )}
    </dialog>
  );
}
