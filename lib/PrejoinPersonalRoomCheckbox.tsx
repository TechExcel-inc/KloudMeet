'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from './i18n';

const STORAGE_KEY = 'kloud-prejoin-personal-room-enabled';

export function PrejoinPersonalRoomCheckbox({ active }: { active: boolean }) {
  const { t } = useI18n();
  const [mountEl, setMountEl] = React.useState<HTMLElement | null>(null);
  const [enabled, setEnabled] = React.useState(false);

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'true' || stored === 'false') {
        setEnabled(stored === 'true');
        return;
      }
    } catch {
      /* ignore */
    }

    try {
      const raw = localStorage.getItem('kloudUser');
      if (!raw) return;
      const user = JSON.parse(raw);
      if (!user?.token) return;

      fetch('/api/account/profile', {
        headers: { Authorization: `Bearer ${user.token}` },
      })
        .then((res) => res.json())
        .then((data) => {
          if (!data.error && data.personalRoomId) {
            setEnabled(true);
            localStorage.setItem(STORAGE_KEY, 'true');
          }
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    if (!active) {
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
  }, [active]);

  const handleChange = (checked: boolean) => {
    setEnabled(checked);
    try {
      localStorage.setItem(STORAGE_KEY, checked ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  };

  if (!mountEl) return null;

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
