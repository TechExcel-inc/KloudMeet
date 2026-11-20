import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '@/lib/i18n';
import { authFetch } from '@/lib/kloudSession';
import type { SpeechSettingsStatus } from '@/lib/speechSettings.server';
import styles from '@/styles/SystemSettingsModal.module.css';

const ENDPOINT = '/api/settings/speech';

export function SpeechSettingsPanel() {
  const { t } = useI18n();
  const [service, setService] = useState<'stt' | 'tts'>('stt');
  const [status, setStatus] = useState<SpeechSettingsStatus>();
  const [loadError, setLoadError] = useState(false);
  const [edit, setEdit] = useState(false);
  const [active, setActive] = useState(false);
  const [appKey, setAppKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    authFetch(ENDPOINT, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load speech settings');
        setStatus(await response.json());
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (edit) dialog.current?.showModal();
  }, [edit]);

  function closeEditor() {
    setEdit(false);
    setAppKey('');
    setSaveError(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const response = await authFetch(ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active, appKey }),
      });
      if (!response.ok) throw new Error('Failed to save speech settings');
      setStatus(await response.json());
      closeEditor();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  const title = t('settings.speech');
  return (
    <section aria-label={title} className={styles.formGroup}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.speechTabs} role="group" aria-label={title}>
        <button type="button" aria-pressed={service === 'stt'} onClick={() => setService('stt')}>
          {t('settings.speechStt')}
        </button>
        <button type="button" aria-pressed={service === 'tts'} onClick={() => setService('tts')}>
          {t('settings.speechTts')}
        </button>
      </div>
      {service === 'tts' ? (
        <p className={styles.helperText}>{t('settings.speechBrowserTts')}</p>
      ) : status ? (
        <div className={styles.speechTableWrap}>
          <table className={styles.speechTable}>
            <thead>
              <tr>
                <th scope="col">{t('settings.speechVendor')}</th>
                <th scope="col">{t('settings.speechUsedFor')}</th>
                <th scope="col">{t('settings.speechStatus')}</th>
                <th scope="col">{t('settings.speechAction')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">AssemblyAI</th>
                <td>{t('settings.speechAssemblyUsage')}</td>
                <td>
                  {t(!status.assemblyActive ? 'settings.speechDisabled' :
                    status.assemblyConfigured ? 'settings.speechActive' : 'settings.speechNotConfigured')}
                </td>
                <td>
                  <button type="button" className={styles.btnOutline} onClick={() => {
                    setActive(status.assemblyActive);
                    setEdit(true);
                  }}>
                    {t(status.assemblyConfigured ? 'common.edit' : 'settings.speechConfigure')}
                  </button>
                </td>
              </tr>
              <tr>
                <th scope="row">Ali Fun-ASR</th>
                <td>{t('settings.speechAliUsage')}</td>
                <td>{t(status.aliConfigured ? 'settings.speechActive' : 'settings.speechNotConfigured')}</td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : loadError ? (
        <p role="alert" className={styles.errorText}>{t('settings.speechLoadError')}</p>
      ) : (
        <p role="status" className={styles.helperText}>{t('settings.loadingSettings')}</p>
      )}

      {edit && (
        <dialog ref={dialog} aria-labelledby="speech-provider-title" className={styles.speechDialog}
          onCancel={(event) => {
            event.preventDefault();
            if (!saving) closeEditor();
          }}
        >
          <form onSubmit={save}>
            <div className={styles.header}>
              <h4 id="speech-provider-title" className={styles.title}>{t('settings.speechEditAssembly')}</h4>
            </div>
            <div className={styles.speechDialogBody}>
              <dl className={styles.speechVendorDetails}>
                <div><dt>{t('settings.speechVendor')}</dt><dd>AssemblyAI</dd></div>
                <div><dt>{t('settings.speechVendorId')}</dt><dd>assemblyai</dd></div>
              </dl>
              <div className={styles.inputRow}>
                <label htmlFor="assemblyai-app-key" className={styles.label}>{t('settings.speechAppKey')}</label>
                <input id="assemblyai-app-key" type="password" autoComplete="new-password"
                  className={styles.input} value={appKey} maxLength={256} required={active && !status?.assemblyConfigured}
                  placeholder={status?.assemblyConfigured ? '••••••••••••••••' : undefined}
                  onChange={(event) => setAppKey(event.target.value)} disabled={saving}
                />
                {status?.assemblyConfigured && (
                  <p className={styles.helperText}>{t('settings.speechKeepKey')}</p>
                )}
              </div>
              <label className={styles.checkboxRow}>
                <input type="checkbox" role="switch" checked={active}
                  onChange={(event) => setActive(event.target.checked)} disabled={saving}
                />
                <span>{t('settings.speechActive')}</span>
              </label>
              {saveError && <p role="alert" className={styles.errorText}>{t('settings.speechSaveError')}</p>}
            </div>
            <div className={styles.footer}>
              <button type="button" className={styles.btnOutline} onClick={closeEditor} disabled={saving}>
                {t('common.cancel')}
              </button>
              <button type="submit" className={styles.btnSolid} disabled={saving}>
                {t(saving ? 'common.saving' : 'settings.saveSettings')}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </section>
  );
}
