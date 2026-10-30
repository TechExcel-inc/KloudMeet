'use client';

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { useIsAccountAdmin, useIsInternalStaff } from '@/lib/useIsAccountAdmin';
import { CalendarSubscribeModal } from '@/lib/CalendarSubscribeModal';
import { useBillingEnabled } from '@/lib/billing/useBillingSummary';
import styles from '../styles/Home.module.css';

export interface UserAvatarMenuUser {
  displayName: string;
  avatarUrl?: string;
  email?: string;
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
  const isAccountAdmin = useIsAccountAdmin();
  const isInternalStaff = useIsInternalStaff();
  const billingEnabled = useBillingEnabled();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showCalendarSubscribe, setShowCalendarSubscribe] = useState(false);
  // A dead avatar URL (expired upload, blocked host) falls back to the initial instead of a broken image.
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => setAvatarFailed(false), [user?.avatarUrl]);
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
        {user.avatarUrl && !avatarFailed ? (
          <Image
            src={user.avatarUrl}
            alt=""
            width={40}
            height={40}
            unoptimized
            // Google profile photos often refuse requests that carry a referrer.
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{user.displayName.charAt(0).toUpperCase()}</span>
        )}
      </button>
      {menuOpen && (
        <div className={styles.orgDropdownMenu} style={{ right: 0, left: 'auto', marginTop: '0.5rem' }}>
          {/* Who is signed in. (Account switching isn't built yet, so no switcher is shown.) */}
          <div className={styles.orgDropdownSection}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 10px' }}>
              <div style={{ width: '28px', height: '28px', flex: 'none', borderRadius: '50%', background: 'var(--km-primary, #5E5CE6)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700 }}>
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.displayName}</div>
                {user.email && (
                  <div style={{ fontSize: '12px', opacity: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
                )}
              </div>
            </div>
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
                setShowCalendarSubscribe(true);
              }}
            >
              {t('calendar.subscribe.menuItem')}
            </button>
            {/* Hidden while BILLING_ENABLED is off (summary answers { enabled: false }). */}
            {billingEnabled && (
              <Link
                className={styles.orgDropdownItem}
                href="/account/billing"
                onClick={closeMenu}
                style={{ textDecoration: 'none', boxSizing: 'border-box' }}
              >
                {t('nav.planBilling')}
              </Link>
            )}
            {isAccountAdmin && (
              <Link
                className={styles.orgDropdownItem}
                href="/account/company"
                onClick={closeMenu}
                style={{ textDecoration: 'none', boxSizing: 'border-box' }}
              >
                {t('nav.companySettings')}
              </Link>
            )}
            {/* System settings hold the site's infrastructure keys: Kloud Meet staff only. */}
            {isInternalStaff && onOpenSettings && (
              <button
                className={styles.orgDropdownItem}
                onClick={() => {
                  closeMenu();
                  onOpenSettings();
                }}
              >
                {t('nav.systemSettings')}
              </button>
            )}
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
      {showCalendarSubscribe && (
        <CalendarSubscribeModal onClose={() => setShowCalendarSubscribe(false)} />
      )}
    </div>
  );
}
