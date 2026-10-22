'use client';

/**
 * Free-plan meeting length: a banner from 5 minutes before `meetingEndsAt`
 * (host sees "Upgrade to Pro", everyone else just the notice). At the deadline
 * the client asks the server to end the room; the server re-checks the time
 * itself, so this is only a trigger, not the enforcement.
 * Renders nothing when billing is off (connection-details sends no meetingEndsAt).
 */
import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { authHeaders } from '@/lib/kloudSession';

const WARN_BEFORE_MS = 5 * 60_000;

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MeetingTimeLimitBanner(props: {
  meetingEndsAt?: string | null;
  roomName: string;
  isHost: boolean;
}) {
  const { t } = useI18n();
  const endsAtMs = props.meetingEndsAt ? Date.parse(props.meetingEndsAt) : NaN;
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);
  const endRequested = useRef(false);

  useEffect(() => {
    if (!Number.isFinite(endsAtMs)) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endsAtMs]);

  const remaining = endsAtMs - now;

  useEffect(() => {
    if (!Number.isFinite(endsAtMs) || remaining > 0 || endRequested.current) return;
    endRequested.current = true;
    // Every client may call; the server ends the room only if the limit has really passed.
    void fetch(`/api/meetings/${encodeURIComponent(props.roomName)}/time-limit`, {
      method: 'POST',
      headers: authHeaders(),
    }).catch(() => {
      endRequested.current = false;
    });
  }, [endsAtMs, remaining, props.roomName]);

  if (!Number.isFinite(endsAtMs) || remaining > WARN_BEFORE_MS || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        maxWidth: 'calc(100vw - 32px)',
        padding: '10px 12px 10px 16px',
        borderRadius: 999,
        background: 'var(--km-snackbar, #323232)',
        color: 'var(--km-stage-text, #e8eaed)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        fontFamily: 'var(--km-font)',
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span>
        {remaining > 0
          ? t('meeting.timeLimit.warning', { time: formatRemaining(remaining) })
          : t('meeting.timeLimit.ended')}
      </span>
      {props.isHost && (
        <a
          href="/account/billing"
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 32,
            padding: '0 14px',
            borderRadius: 999,
            background: 'var(--km-primary-grad, #5e5ce6)',
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          {t('meeting.timeLimit.upgrade')}
        </a>
      )}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('billing.dismiss')}
        style={{
          width: 32,
          height: 32,
          border: 0,
          borderRadius: '50%',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        ✕
      </button>
    </div>
  );
}
