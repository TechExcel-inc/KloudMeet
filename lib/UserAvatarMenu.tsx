'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n';
import styles from '../styles/Home.module.css';

export interface UserAvatarMenuUser {
  displayName: string;
  avatarUrl?: string;
}

export interface UserAvatarMenuProps {
  user?: UserAvatarMenuUser | null;
  onSignIn?: () => void;
  onOpenProfile?: () => void;
  onOpenSettings?: () => void;
  onOpenDesktopApp?: () => void;
  onSignOut?: () => void;
  /** Shown at top of dropdown on mobile (≤640px), e.g. "Name@Kloud Corp" */
  mobileOrgLabel?: string;
}

export function UserAvatarMenu({
  user,
  onSignIn,
  onOpenProfile,
  onOpenSettings,
  onOpenDesktopApp,
  onSignOut,
  mobileOrgLabel,
}: UserAvatarMenuProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) {
    if (!onSignIn) return null;
    return (
      <button
        className={styles.avatarBtn}
        onClick={onSignIn}
        aria-label={t('nav.signIn')}
        title={t('nav.signIn')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </button>
    );
  }

  const orgHeaderLabel = mobileOrgLabel ?? `${user.displayName}@Kloud Corp`;

  return (
    <div style={{ position: 'relative' }} ref={menuRef}>
      <button
        className={styles.avatarBtn}
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label={t('nav.userMenu')}
        title={t('nav.userMenu')}
        style={{ overflow: 'hidden' }}
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{user.displayName.charAt(0).toUpperCase()}</span>
        )}
      </button>
      {menuOpen && (
        <div className={styles.dropdownMenu}>
          <div className={styles.navAvatarMenuMobileHeader}>
            <span className={styles.navAvatarMenuOrgName}>{orgHeaderLabel}</span>
          </div>
          <button
            className={styles.dropdownItem}
            onClick={() => {
              setMenuOpen(false);
              onOpenProfile?.();
            }}
            style={{ borderBottom: '1px solid #f1f5f9' }}
          >
            {t('nav.myProfile')}
          </button>
          <button
            className={styles.dropdownItem}
            onClick={() => {
              setMenuOpen(false);
              onOpenSettings?.();
            }}
            style={{ borderBottom: '1px solid #f1f5f9' }}
          >
            {t('nav.systemSettings')}
          </button>
          <button
            className={styles.dropdownItem}
            onClick={() => {
              setMenuOpen(false);
              onOpenDesktopApp?.();
            }}
            style={{ borderBottom: '1px solid #f1f5f9' }}
          >
            {t('toolbar.openDesktop.menuItem')}
          </button>
          <button
            className={styles.dropdownItem}
            onClick={() => {
              setMenuOpen(false);
              onSignOut?.();
            }}
          >
            {t('nav.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
