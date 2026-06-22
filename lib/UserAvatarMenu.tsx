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
}

export function UserAvatarMenu({
  user,
  onSignIn,
  onOpenProfile,
  onOpenSettings,
  onOpenDesktopApp,
  onSignOut,
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

  const closeMenu = () => setMenuOpen(false);

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
        <div className={styles.orgDropdownMenu} style={{ right: 0, left: 'auto', marginTop: '0.5rem' }}>
          <div className={styles.orgDropdownSection}>
            <div className={styles.orgDropdownTitle}>{t('nav.switchAccount')}</div>
            <button className={styles.orgDropdownItemActive}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '20px', height: '20px', borderRadius: '4px', background: '#4f46e5', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>
                  {user.displayName.charAt(0).toUpperCase()}
                </div>
                {user.displayName}
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </button>
            <button className={styles.orgDropdownItem} onClick={closeMenu}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '20px', height: '20px', borderRadius: '4px', background: '#e2e8f0', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>P</div>
                KloudMeet Personal
              </div>
            </button>
          </div>
          <div className={styles.orgDropdownSection}>
            <button
              className={styles.orgDropdownItem}
              onClick={() => {
                closeMenu();
                onOpenProfile?.();
              }}
            >
              {t('nav.myProfile')}
            </button>
            <button
              className={styles.orgDropdownItem}
              onClick={() => {
                closeMenu();
                onOpenSettings?.();
              }}
            >
              {t('nav.systemSettings')}
            </button>
            <button
              className={styles.orgDropdownItem}
              onClick={() => {
                closeMenu();
                onOpenDesktopApp?.();
              }}
            >
              {t('toolbar.openDesktop.menuItem')}
            </button>
            <button
              className={styles.orgDropdownItem}
              onClick={() => {
                closeMenu();
                onSignOut?.();
              }}
              style={{ color: '#ef4444' }}
            >
              {t('nav.signOut')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
