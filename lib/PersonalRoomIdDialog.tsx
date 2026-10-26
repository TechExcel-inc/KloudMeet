'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Check, LoaderCircle } from 'lucide-react';
import styles from '../styles/PersonalRoomIdDialog.module.css';
import { useI18n } from './i18n';
import { cleanPersonalRoomIdInput, isValidPersonalRoomId } from './personalRoomId';

type Status = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error';

/**
 * Pick a personal meeting ID in one step: a suggestion from the member's names is
 * filled in, every edit is checked as you type, and taken IDs offer free ones.
 * Saves through PUT /api/account/profile (same rules as My Profile).
 */
export function PersonalRoomIdDialog({
  open,
  token,
  onClose,
  onSaved,
}: {
  open: boolean;
  token: string;
  onClose: () => void;
  onSaved: (personalRoomId: string) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = React.useState('');
  const [status, setStatus] = React.useState<Status>('idle');
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [loadingSuggestion, setLoadingSuggestion] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const checkGenRef = React.useRef(0);
  const host = typeof window !== 'undefined' ? window.location.host : '';

  const authed = React.useCallback(
    (url: string, init?: RequestInit) =>
      fetch(url, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } }),
    [token],
  );

  const runCheck = React.useCallback(
    async (id: string) => {
      const gen = ++checkGenRef.current;
      if (!isValidPersonalRoomId(id)) {
        setStatus(id ? 'invalid' : 'idle');
        setSuggestions([]);
        return;
      }
      setStatus('checking');
      try {
        const res = await authed(`/api/account/personal-room-id?check=${encodeURIComponent(id)}`);
        const data = await res.json();
        if (gen !== checkGenRef.current) return;
        if (!res.ok) throw new Error(data?.error || 'check failed');
        setStatus(data.available ? 'available' : data.valid ? 'taken' : 'invalid');
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      } catch {
        if (gen === checkGenRef.current) setStatus('error');
      }
    },
    [authed],
  );

  // Opening: start from a free ID built from the member's names
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setValue('');
    setStatus('idle');
    setSuggestions([]);
    setTouched(false);
    setSaving(false);
    setLoadingSuggestion(true);
    authed('/api/account/personal-room-id')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const id = typeof data?.suggestion === 'string' ? data.suggestion : '';
        setValue(id);
        if (id) setStatus('available');
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        setLoadingSuggestion(false);
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, authed]);

  // Check as you type (debounced); the opening suggestion is already known to be free
  React.useEffect(() => {
    if (!open || !touched) return;
    const timer = setTimeout(() => void runCheck(value), 300);
    return () => clearTimeout(timer);
  }, [open, touched, value, runCheck]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  const pick = (id: string) => {
    setTouched(true);
    setValue(id);
    setStatus('checking');
    inputRef.current?.focus();
  };

  const save = async () => {
    if (status !== 'available' || saving) return;
    setSaving(true);
    try {
      const res = await authed('/api/account/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalRoomId: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.code === 'PERSONAL_ROOM_ID_TAKEN') {
          setTouched(true);
          await runCheck(value);
        } else if (data?.code === 'PERSONAL_ROOM_ID_INVALID') {
          setStatus('invalid');
        } else {
          setStatus('error');
        }
        return;
      }
      onSaved(typeof data?.personalRoomId === 'string' && data.personalRoomId ? data.personalRoomId : value);
    } catch {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  const fieldBad = touched && (status === 'taken' || status === 'invalid');
  const shownId = value || 'ying';
  let hint: React.ReactNode = t('personalId.rule');
  if (touched && status === 'invalid' && value) hint = t('profile.roomIdInvalid');
  if (status === 'taken') hint = t('personalId.taken');
  if (status === 'error') hint = t('personalId.checkFailed');

  return createPortal(
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="personal-id-title">
        <h2 id="personal-id-title" className={styles.title}>
          {t('personalId.dialogTitle')}
        </h2>
        <p className={styles.lead}>{t('personalId.dialogLead')}</p>

        <label className={styles.label} htmlFor="personal-id-input">
          {t('personalId.fieldLabel')}
        </label>
        <div
          className={`${styles.field}${fieldBad ? ` ${styles.fieldBad}` : ''}`}
          onClick={() => inputRef.current?.focus()}
        >
          <span className={styles.prefix} aria-hidden="true">
            <span className={styles.prefixHost}>{host}</span>/rooms/
          </span>
          <input
            ref={inputRef}
            id="personal-id-input"
            className={styles.input}
            value={value}
            disabled={loadingSuggestion}
            placeholder={loadingSuggestion ? '' : 'ying'}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={12}
            aria-invalid={fieldBad || undefined}
            aria-describedby="personal-id-hint"
            onChange={(e) => {
              setTouched(true);
              setValue(cleanPersonalRoomIdInput(e.target.value));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void save();
              }
            }}
          />
          <span className={styles.status} aria-live="polite">
            {(loadingSuggestion || status === 'checking') && (
              <LoaderCircle size={16} className={styles.spin} aria-label={t('personalId.checking')} />
            )}
            {!loadingSuggestion && status === 'available' && (
              <span className={styles.ok}>
                <Check size={15} strokeWidth={2.5} aria-hidden="true" />
                {t('personalId.available')}
              </span>
            )}
            {status === 'taken' && <span className={styles.bad}>{t('personalId.takenShort')}</span>}
          </span>
        </div>
        <p id="personal-id-hint" className={`${styles.hint}${fieldBad || status === 'error' ? ` ${styles.hintBad}` : ''}`}>
          {hint}
        </p>
        {suggestions.length > 0 && (
          <div className={styles.chips}>
            <span>{t('personalId.try')}</span>
            {suggestions.map((s) => (
              <button key={s} type="button" className={styles.chip} onClick={() => pick(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        <ol className={styles.how}>
          <li>
            <span className={styles.step} aria-hidden="true">
              1
            </span>
            <span>{t('personalId.howStart', { id: shownId })}</span>
          </li>
          <li>
            <span className={styles.step} aria-hidden="true">
              2
            </span>
            <span>{t('personalId.howShare')}</span>
          </li>
        </ol>

        <div className={styles.actions}>
          <button type="button" className={styles.btnGhost} onClick={onClose} disabled={saving}>
            {t('personalId.cancel')}
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => void save()}
            disabled={status !== 'available' || saving || loadingSuggestion}
          >
            {saving ? t('personalId.saving') : t('personalId.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
