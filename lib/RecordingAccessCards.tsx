'use client';

/**
 * Replay page and meeting access levels (screen s7): why someone can't watch yet, and the host's
 * bar for answering requests. Protected meetings: ask the host. Private: attendees only.
 */
import React from 'react';
import Link from 'next/link';
import { Bell, Check, Info, Lock, ShieldCheck } from 'lucide-react';
import styles from '@/styles/MeetingAccess.module.css';
import { useI18n } from './i18n';
import { authHeaders } from './kloudSession';
import { recordingReplayPath } from './recordingReplayPath';

export interface RecordingBlocked {
  code: 'REQUEST_ACCESS' | 'ATTENDEES_ONLY';
  requestStatus?: string | null;
  meeting?: { title: string | null; hostName: string | null; date: string } | null;
  signedInAs?: string | null;
}

export function parseRecordingBlocked(body: unknown): RecordingBlocked | null {
  if (!body || typeof body !== 'object') return null;
  const code = Reflect.get(body, 'code');
  if (code !== 'REQUEST_ACCESS' && code !== 'ATTENDEES_ONLY') return null;
  return body as RecordingBlocked;
}

function apiPath(recordingKey: string) {
  return `/api/recordings/${encodeURIComponent(recordingKey)}/access-requests`;
}

function useMeetingLine(blocked: RecordingBlocked) {
  const { t, locale } = useI18n();
  const title = blocked.meeting?.title || t('access.untitledMeeting');
  let date = '';
  try {
    if (blocked.meeting?.date) {
      date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(blocked.meeting.date));
    }
  } catch {
    /* ignore */
  }
  return date ? `${title} · ${date}` : title;
}

export function RecordingAccessBlocked({ recordingKey, blocked }: { recordingKey: string; blocked: RecordingBlocked }) {
  const { t } = useI18n();
  const meetingLine = useMeetingLine(blocked);
  const [status, setStatus] = React.useState<string | null>(blocked.requestStatus ?? null);
  const [sending, setSending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const request = async () => {
    setSending(true);
    setFailed(false);
    try {
      const res = await fetch(apiPath(recordingKey), { method: 'POST', headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (data?.status === 'APPROVED') {
        window.location.reload();
        return;
      }
      if (res.ok && data?.status) setStatus(data.status);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  const switchAccount = () => {
    try {
      localStorage.removeItem('kloudUser');
      sessionStorage.removeItem('kloudUser');
    } catch {
      /* ignore */
    }
    window.location.href = `/?next=${encodeURIComponent(recordingReplayPath(recordingKey))}`;
  };

  if (blocked.code === 'ATTENDEES_ONLY') {
    return (
      <section className={styles.replayCard}>
        <span className={styles.replayThumb} aria-hidden="true">
          <Lock size={34} />
        </span>
        <h1 className={styles.cardTitle} style={{ fontSize: 22 }}>{t('access.recordingAttendeesTitle')}</h1>
        <p className={styles.cardText}>
          {meetingLine}
          <br />
          {t('access.recordingAttendeesText')}
        </p>
        {blocked.signedInAs && (
          <div className={styles.infoRow}>
            <Info size={15} aria-hidden="true" />
            <span>
              {t('access.signedInAs')} <strong>{blocked.signedInAs}</strong>
              {' · '}
              <button type="button" className={styles.linkBtn} onClick={switchAccount}>
                {t('access.switchAccount')}
              </button>
            </span>
          </div>
        )}
        <Link className={styles.secondary} href="/">
          {t('access.backHome')}
        </Link>
      </section>
    );
  }

  return (
    <section className={styles.replayCard}>
      <span className={styles.replayThumb} aria-hidden="true">
        <ShieldCheck size={34} />
      </span>
      <h1 className={styles.cardTitle} style={{ fontSize: 22 }}>{t('access.recordingRequestTitle')}</h1>
      <p className={styles.cardText}>
        {meetingLine}
        <br />
        {t('access.recordingRequestText')}
      </p>
      {status === 'PENDING' ? (
        <p className={styles.fineprint} role="status" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Check size={15} aria-hidden="true" style={{ color: 'var(--km-success)' }} />
          {t('access.recordingRequestSent')}
        </p>
      ) : (
        <>
          {status === 'DENIED' && <p className={styles.fineprint}>{t('access.recordingRequestDenied')}</p>}
          <button type="button" className={styles.primary} onClick={() => void request()} disabled={sending}>
            {status === 'DENIED' ? t('access.recordingRequestAgain') : t('access.recordingRequest')}
          </button>
          {failed && (
            <p className={styles.fineprint} role="alert">
              {t('access.recordingRequestFailed')}
            </p>
          )}
        </>
      )}
      <Link className={styles.secondary} href="/">
        {t('access.backHome')}
      </Link>
    </section>
  );
}

interface RecordingRequest {
  id: number;
  name: string;
  email: string;
  requestedAt: string;
}

/** Host / recorder: "2 people asked to watch this recording" with Deny · Approve all · Review. */
export function RecordingRequestsBar({ recordingKey }: { recordingKey: string }) {
  const { t } = useI18n();
  const [requests, setRequests] = React.useState<RecordingRequest[]>([]);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(apiPath(recordingKey), { headers: authHeaders(), cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setRequests(Array.isArray(data?.requests) ? data.requests : []);
    } catch {
      /* ignore */
    }
  }, [recordingKey]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const answer = async (action: 'approve' | 'deny', target: { ids: number[] } | { all: true }) => {
    setBusy(true);
    try {
      await fetch(apiPath(recordingKey), {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action, ...target }),
      });
    } finally {
      setBusy(false);
      void load();
    }
  };

  if (requests.length === 0) return null;
  const names = requests.slice(0, 3).map((r) => r.name).join(', ');

  return (
    <div className={styles.requestBar} role="region" aria-label={t('access.recordingRequestsCount', { n: requests.length })}>
      <Bell size={17} aria-hidden="true" />
      <span className={styles.requestBarText}>
        <strong>{t('access.recordingRequestsCount', { n: requests.length })}</strong>
        <span className={styles.requestBarNames}>
          {' · '}
          {names}
          {requests.length > 3 ? ` +${requests.length - 3}` : ''}
        </span>
      </span>
      <button type="button" className={styles.smallBtn} disabled={busy} onClick={() => void answer('deny', { all: true })}>
        {t('access.deny')}
      </button>
      <button type="button" className={styles.smallPrimary} disabled={busy} onClick={() => void answer('approve', { all: true })}>
        {t('access.approveAll')}
      </button>
      <button type="button" className={styles.linkBtn} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t('access.review')}
      </button>
      {open && (
        <ul className={styles.list} style={{ flexBasis: '100%', padding: 0 }}>
          {requests.map((r) => (
            <li key={r.id} className={styles.listItem}>
              <span className={styles.listText}>
                <div className={styles.listName}>{r.name}</div>
                <div className={styles.listEmail}>{r.email}</div>
              </span>
              <button type="button" className={styles.smallBtn} disabled={busy} onClick={() => void answer('deny', { ids: [r.id] })}>
                {t('access.deny')}
              </button>
              <button type="button" className={styles.smallPrimary} disabled={busy} onClick={() => void answer('approve', { ids: [r.id] })}>
                {t('access.approve')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
