'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from './i18n';
import { authHeaders, getKloudSessionBearer } from './kloudSession';
import { writePrejoinPersonalRoomEnabled } from './prejoinPersonalRoom';

export function PrejoinPersonalRoomCheckbox({
  active,
  routeRoomName,
  syncEnabled,
  onEnabledChange,
  onPersonalRoomIdLoaded,
}: {
  active: boolean;
  /** Next 路由入口会议号；仅当入口已是个人房号时隐藏（勾选切过去的仍可取消）。 */
  routeRoomName: string;
  syncEnabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onPersonalRoomIdLoaded: (personalRoomId: string) => void;
}) {
  const { t } = useI18n();
  const [mountEl, setMountEl] = React.useState<HTMLElement | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  /** null = loading; '' = no personal room; non-empty = show checkbox */
  const [personalRoomId, setPersonalRoomId] = React.useState<string | null>(null);

  const enteredViaPersonalRoom =
    personalRoomId &&
    routeRoomName.trim().toLowerCase() === personalRoomId.toLowerCase();

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

  React.useEffect(() => {
    if (!active || !personalRoomId || enteredViaPersonalRoom) {
      setMountEl(null);
      return;
    }

    let slot: HTMLDivElement | null = null;
    let observer: MutationObserver | null = null;
    let cancelled = false;

    const attach = () => {
      if (cancelled) return true;
      const container = document.querySelector(
        '.kloud-prejoin-wrapper .lk-username-container',
      );
      if (!container) return false;

      if (slot?.parentElement === container) return true;

      detach();
      slot = document.createElement('div');
      slot.className = 'kloud-prejoin-personal-room';
      const joinBtn = container.querySelector(
        'button[type="submit"], .lk-join-button',
      );
      if (joinBtn) {
        container.insertBefore(slot, joinBtn);
      } else {
        container.appendChild(slot);
      }
      setMountEl(slot);
      return true;
    };

    const detach = () => {
      if (slot) {
        slot.remove();
        slot = null;
      }
      setMountEl(null);
    };

    if (!attach()) {
      const root = document.querySelector('.kloud-prejoin-wrapper');
      if (root) {
        observer = new MutationObserver(() => {
          if (attach()) observer?.disconnect();
        });
        observer.observe(root, { childList: true, subtree: true });
      }
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      detach();
    };
  }, [active, personalRoomId, enteredViaPersonalRoom]);

  const handleChange = (checked: boolean) => {
    setEnabled(checked);
    onEnabledChange(checked);
    writePrejoinPersonalRoomEnabled(checked);
  };

  if (!personalRoomId || enteredViaPersonalRoom || !mountEl) return null;

  return createPortal(
    <label className="kloud-prejoin-personal-room-checkbox">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => handleChange(e.target.checked)}
      />
      <span>{t('profile.supportPersonalRoom')}</span>
    </label>,
    mountEl,
  );
}
