'use client';

import React, { useState } from 'react';
import { useI18n, LOCALE_OPTIONS } from '@/lib/i18n';
import styles from '../../../styles/Home.module.css';
import type { AuthUser } from '../types';
import { KloudLogo } from './KloudLogo';
import { UserAvatarMenu } from '@/lib/UserAvatarMenu';

export function TopToolbar({ onBack, onSignIn, onSignOut, onOpenSettings, onOpenProfile, onOpenHelp, onOpenDesktopApp, user, hideAvatar }: { onBack?: () => void, onSignIn?: () => void, onSignOut?: () => void, onOpenSettings?: () => void, onOpenProfile?: () => void, onOpenHelp?: () => void, onOpenDesktopApp?: () => void, user?: AuthUser, hideAvatar?: boolean }) {
  const { t, locale, setLocale } = useI18n();
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const langMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedTheme = window.localStorage.getItem('kloud-theme');
    const nextTheme: 'light' | 'dark' = storedTheme === 'light' ? 'light' : 'dark';
    setTheme(nextTheme);
  }, []);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem('kloud-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setLangMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <nav className={styles.topNav}>
      <div className={styles.navInner}>
        {/* ── Left: Logo + Back btn ── */}
        <div className={styles.toolbarLeft}>
          {onBack && (
            <button className={styles.iconBtn} onClick={onBack} aria-label={t('nav.goBack')} title={t('common.back')} style={{ marginRight: '1rem' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            </button>
          )}
          <div className={styles.navLogo} onClick={() => window.location.assign('/')}>
            <KloudLogo variant="nav" />
          </div>
        </div>

        {/* ── Right: actions ── */}
        <div className={styles.topNavRight}>
          <button
            className={`${styles.topNavIconBtn} ${theme === 'dark' ? styles.topNavIconBtnActive : ''}`}
            aria-label={theme === 'dark' ? t('nav.switchLightTheme') : t('nav.switchDarkTheme')}
            title={theme === 'dark' ? t('nav.switchLightTheme') : t('nav.switchDarkTheme')}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M21 12.79A9 9 0 1111.21 3c0 .28-.01.56-.01.84A7 7 0 0021 12.79z"></path>
              </svg>
            )}
          </button>

          {/* Help button — desktop only */}
          <button className={styles.topNavIconBtn} aria-label={t('nav.help')} title={t('nav.help')} onClick={() => onOpenHelp?.()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"></path>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </button>

          {/* Language selector — desktop only */}
          <div style={{ position: 'relative' }} ref={langMenuRef}>
            <button className={styles.topNavIconBtn} aria-label={t('nav.langSelector')} onClick={() => setLangMenuOpen(!langMenuOpen)} style={{ gap: '4px', paddingLeft: '0.75rem', paddingRight: '0.75rem' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"></path>
              </svg>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, marginLeft: '0.3rem' }}>{LOCALE_OPTIONS.find(l => l.code === locale)?.shortCode || 'EN'}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginLeft: '0.1rem', marginTop: '1px' }}>
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            {langMenuOpen && (
              <div className={styles.dropdownMenu} style={{ minWidth: '160px' }}>
                {LOCALE_OPTIONS.map(opt => (
                  <button
                    key={opt.code}
                    className={styles.dropdownItem}
                    onClick={() => { setLocale(opt.code); setLangMenuOpen(false); }}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: locale === opt.code ? 600 : 400, background: locale === opt.code ? '#f1f5f9' : undefined }}
                  >
                    <span>{opt.label}</span>
                    <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{opt.shortCode}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Avatar / Sign-in */}
          {!hideAvatar && (
            <UserAvatarMenu
              user={user}
              onSignIn={onSignIn}
              onOpenProfile={onOpenProfile}
              onOpenSettings={onOpenSettings}
              onOpenDesktopApp={onOpenDesktopApp}
              onSignOut={onSignOut}
            />
          )}
        </div>
      </div>
    </nav>
  );
}
