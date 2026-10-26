'use client';

import React from 'react';
import styles from '../styles/PreJoin.module.css';
import { useI18n } from './i18n';
import { authHeaders, getKloudSessionBearer } from './kloudSession';
import { writePrejoinPersonalRoomEnabled } from './prejoinPersonalRoom';
import { PersonalRoomIdDialog } from './PersonalRoomIdDialog';

export function PrejoinPersonalRoomCheckbox({
  active,
  syncEnabled,
  switching = false,
  onEnabledChange,
  onPersonalRoomIdLoaded,
}: {
  active: boolean;
  syncEnabled: boolean;
  switching?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onPersonalRoomIdLoaded: (personalRoomId: string) => void;
}) {
  const { t } = useI18n();
  const [enabled, setEnabled] = React.useState(false);
  /** null = loading; '' = no personal room; non-empty = show checkbox */
  const [personalRoomId, setPersonalRoomId] = React.useState<string | null>(null);
  const [setupOpen, setSetupOpen] = React.useState(false);
  const bearer = getKloudSessionBearer();

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!getKloudSessionBearer()) {
        if (!cancelled) setPersonalRoomId('');
        return;
      }

      try {
        const res = await fetch('/api/account/profile', {
          headers: authHeaders(),
        });
        const data = await res.json();
        if (cancelled) return;

        const roomId =
          typeof data?.personalRoomId === 'string' ? data.personalRoomId.trim() : '';
        setPersonalRoomId(roomId);

        if (!roomId) return;

        onPersonalRoomIdLoaded(roomId);
      } catch {
        if (!cancelled) setPersonalRoomId('');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [onPersonalRoomIdLoaded]);

  React.useEffect(() => {
    setEnabled(syncEnabled);
  }, [syncEnabled]);

  const handleChange = (checked: boolean) => {
    if (switching) return;
    setEnabled(checked);
    onEnabledChange(checked);
    writePrejoinPersonalRoomEnabled(checked);
  };

  // Signed in without a personal ID: offer to set one up here, then use it right away
  const handleSetupSaved = (id: string) => {
    setSetupOpen(false);
    setPersonalRoomId(id);
    onPersonalRoomIdLoaded(id);
    handleChange(true);
  };

  if (active && personalRoomId === '' && bearer) {
    return (
      <>
        <div className={`${styles.checkRow} ${styles.checkRowMuted}`}>
          <input
            type="checkbox"
            checked={false}
            disabled
            aria-describedby="prejoin-personal-id-setup"
            onChange={() => {}}
          />
          <span className={styles.checkText}>
            {t('profile.supportPersonalRoom')}
            <span className={styles.checkMeta} aria-hidden="true">
              {' · '}
            </span>
            <button
              type="button"
              id="prejoin-personal-id-setup"
              className={styles.checkLink}
              onClick={() => setSetupOpen(true)}
            >
              {t('personalId.setOneUp')}
            </button>
          </span>
        </div>
        <PersonalRoomIdDialog
          open={setupOpen}
          token={bearer}
          onClose={() => setSetupOpen(false)}
          onSaved={handleSetupSaved}
        />
      </>
    );
  }

  if (!active || !personalRoomId) return null;

  return (
    <label
      className={`${styles.checkRow}${switching ? ` ${styles.checkRowDisabled}` : ''}`}
      aria-busy={switching || undefined}
    >
      <input
        type="checkbox"
        checked={enabled}
        disabled={switching}
        onChange={(e) => handleChange(e.target.checked)}
      />
      <span className={styles.checkText}>
        {t('profile.supportPersonalRoom')}{' '}
        <span className={styles.checkMeta}>{personalRoomId}</span>
      </span>
    </label>
  );
}
