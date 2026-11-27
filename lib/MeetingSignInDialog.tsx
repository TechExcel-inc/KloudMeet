'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMaybeRoomContext } from '@livekit/components-react';
import { useI18n } from '@/lib/i18n';
import { authFetch, publishKloudAuthChanged, type StoredKloudUser } from '@/lib/kloudSession';
import { roomAuthHeaders } from '@/lib/roomAuth';
import styles from '@/styles/MeetingSignInDialog.module.css';

interface MeetingSignInDialogProps {
  open: boolean;
  onClose: () => void;
  /** 登录成功。synced 为 false 时姓名已保存，但这场会的身份没有写上。 */
  onSignedIn: (result: { name: string; synced: boolean }) => void;
}

function roomNameFromPath(): string {
  if (typeof window === 'undefined') return '';
  const segments = window.location.pathname.split('/').filter(Boolean);
  return segments.pop() || '';
}

/**
 * MeetingSignInDialog — 会议里的邮箱密码登录。不离开本页。
 */
export function MeetingSignInDialog({ open, onClose, onSignedIn }: MeetingSignInDialogProps) {
  const { t } = useI18n();
  const room = useMaybeRoomContext();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const id = identifier.trim();
    if (!id) {
      setError(t('login.pleaseEnterEmail'));
      return;
    }
    if (!password) {
      setError(t('login.pleaseEnterPassword'));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: id, password }),
      });
      const data = (await res.json()) as {
        error?: string;
        token?: string;
        user?: { id?: string | number; username?: string; fullName?: string; email?: string; avatarUrl?: string };
      };
      if (!res.ok || !data.token || !data.user) {
        setError(data.error || t('login.loginFailed'));
        return;
      }
      const name = (data.user.fullName || data.user.username || '').trim();
      const user: StoredKloudUser = {
        id: String(data.user.id ?? ''),
        username: data.user.username || name,
        displayName: name || data.user.username || '',
        email: data.user.email,
        avatarUrl: data.user.avatarUrl,
        token: data.token,
      };
      localStorage.setItem('kloudUser', JSON.stringify(user));
      publishKloudAuthChanged();

      let synced = false;
      const identity = room?.localParticipant.identity;
      const roomName = roomNameFromPath();
      if (room && name) {
        try {
          await room.localParticipant.setName(name);
        } catch {
          /* the server update below still sets the name everyone sees */
        }
      }
      if (!identity || !roomName) {
        synced = true;
      } else {
        try {
          const claim = await authFetch(`/api/meetings/${encodeURIComponent(roomName)}/account`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...roomAuthHeaders() },
            body: JSON.stringify({ identity }),
          });
          synced = claim.ok;
        } catch {
          synced = false;
        }
      }
      onSignedIn({ name: user.displayName, synced });
      onClose();
    } catch {
      setError(t('login.networkError'));
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className={styles.backdrop} onMouseDown={onClose}>
      <form
        className={styles.dialog}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <div className={styles.head}>
          <h2 className={styles.title}>{t('login.title')}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <label className={styles.field}>
          <span>{t('login.emailOrLogin')}</span>
          <input
            type="text"
            autoComplete="username"
            autoFocus
            value={identifier}
            onChange={(event) => {
              setIdentifier(event.target.value);
              setError('');
            }}
          />
        </label>
        <label className={styles.field}>
          <span>{t('login.password')}</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setError('');
            }}
          />
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? t('login.signingIn') : t('login.title')}
        </button>
      </form>
    </div>,
    document.body,
  );
}
