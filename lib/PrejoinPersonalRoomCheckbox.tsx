'use client';

import React from 'react';
import { useI18n } from './i18n';
import { authHeaders, getKloudSessionBearer } from './kloudSession';
import { writePrejoinPersonalRoomEnabled } from './prejoinPersonalRoom';

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

  if (!active || !personalRoomId) return null;

  return (
    <label
      className={`kloud-prejoin-personal-room-checkbox${switching ? ' kloud-prejoin-personal-room-checkbox--disabled' : ''}`}
    >
      <input
        type="checkbox"
        checked={enabled}
        disabled={switching}
        onChange={(e) => handleChange(e.target.checked)}
      />
      <span>{t('profile.supportPersonalRoom')}</span>
    </label>
  );
}
