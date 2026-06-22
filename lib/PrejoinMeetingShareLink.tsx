'use client';

import React from 'react';
import { useI18n } from './i18n';

export function PrejoinMeetingShareLink({
  active,
  roomName,
}: {
  active: boolean;
  roomName?: string;
}) {
  const { t } = useI18n();
  const [meetingUrl, setMeetingUrl] = React.useState('');
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!active) {
      setMeetingUrl('');
      return;
    }

    try {
      const current = new URL(window.location.href);
      if (roomName && roomName.trim()) {
        current.pathname = `/rooms/${encodeURIComponent(roomName.trim())}`;
      }
      current.search = '';
      current.hash = '';
      setMeetingUrl(current.toString());
    } catch {
      setMeetingUrl('');
    }
  }, [active, roomName]);

  const handleCopy = async () => {
    if (!meetingUrl) return;
    try {
      await navigator.clipboard.writeText(meetingUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  if (!active || !meetingUrl) return null;

  return (
    <div className="kloud-prejoin-share-link-block">
      <div className="kloud-prejoin-share-link-label">{t('prejoin.shareMeetingUrl')}</div>
      <div className="kloud-meeting-link-box kloud-prejoin-share-link-box">
        <span title={meetingUrl} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {meetingUrl}
        </span>
        <button onClick={() => void handleCopy()} title={t('schedule.copyLink')}>
          {copied ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
