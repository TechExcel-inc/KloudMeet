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
  const [appSwitcherOpen, setAppSwitcherOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const langMenuRef = React.useRef<HTMLDivElement>(null);
  const appSwitcherRef = React.useRef<HTMLDivElement>(null);

  const getKloudPlatformUrl = (path = '') => {
    if (typeof window === 'undefined') return 'http://local.kloud.cn:8081';
    const host = window.location.hostname.toLowerCase();
    if (host.indexOf('local.kloud.cn') > -1) {
      return `http://local.kloud.cn:8081${path}`;
    }
    if (host === 'localhost' || host === '127.0.0.1') {
      return `http://localhost:8081${path}`;
    }
    return `https://kloud.cn${path}`;
  };

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

  // Product tile style — matches Kloud-Web HeaderPartFunMenu .function-item
  const productTileStyle: React.CSSProperties = {
    width: '109px',
    textAlign: 'center',
    cursor: 'pointer',
    padding: '20px 0',
    transition: 'background 0.2s',
    borderRadius: '8px',
  };

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setLangMenuOpen(false);
      }
      if (appSwitcherRef.current && !appSwitcherRef.current.contains(event.target as Node)) {
        setAppSwitcherOpen(false);
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

          {/* App Switcher — switch to other Kloud products (before avatar) */}
          <div style={{ position: 'relative' }} ref={appSwitcherRef}>
            <button
              className={`${styles.topNavIconBtn} ${appSwitcherOpen ? styles.topNavIconBtnActive : ''}`}
              aria-label="Kloud App Switcher"
              title="Switch to other Kloud products"
              onClick={() => setAppSwitcherOpen(!appSwitcherOpen)}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <circle cx="5" cy="5" r="2" /><circle cx="12" cy="5" r="2" /><circle cx="19" cy="5" r="2" />
                <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                <circle cx="5" cy="19" r="2" /><circle cx="12" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
              </svg>
            </button>
            {appSwitcherOpen && (
              <div className={styles.dropdownMenu} style={{ minWidth: '360px', padding: '16px' }}>
                <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8', fontWeight: 700, marginBottom: '8px' }}>
                  Kloud Platform
                </div>
                {/* Grid of product tiles — matches Kloud-Web HeaderPartFunMenu style */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
                  {/* LiveDoc */}
                  <div onClick={() => { setAppSwitcherOpen(false); window.location.href = getKloudPlatformUrl('/livedoc/documents'); }} style={productTileStyle}>
                    <div style={{ height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="1.5" width="32" height="32"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round"/><polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 400, color: '#3d358b' }}>LiveDoc</div>
                  </div>
                  {/* Meet (current) */}
                  <div onClick={() => setAppSwitcherOpen(false)} style={{ ...productTileStyle, background: 'rgba(82,39,211,0.06)', borderRadius: '8px' }}>
                    <div style={{ height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#5227D3" strokeWidth="1.5" width="32" height="32"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#5227D3' }}>Meet ●</div>
                  </div>
                  {/* Meeting (old) */}
                  <div onClick={() => { setAppSwitcherOpen(false); window.location.href = getKloudPlatformUrl('/livedoc/meeting'); }} style={productTileStyle}>
                    <div style={{ height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.5" width="32" height="32"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" strokeLinecap="round" /><line x1="8" y1="2" x2="8" y2="6" strokeLinecap="round" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 400, color: '#3d358b' }}>Meeting</div>
                  </div>
                  {/* LiveSync */}
                  <div onClick={() => { setAppSwitcherOpen(false); window.location.href = getKloudPlatformUrl('/livedoc/livesync-list'); }} style={productTileStyle}>
                    <div style={{ height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="1.5" width="32" height="32"><polyline points="23 4 23 10 17 10" strokeLinecap="round" strokeLinejoin="round"/><polyline points="1 20 1 14 7 14" strokeLinecap="round" strokeLinejoin="round"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 400, color: '#3d358b' }}>LiveSync</div>
                  </div>
                  {/* Konverse */}
                  <div onClick={() => { setAppSwitcherOpen(false); window.location.href = getKloudPlatformUrl('/konverse/list'); }} style={productTileStyle}>
                    <div style={{ height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.5" width="32" height="32"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 400, color: '#3d358b' }}>Konverse</div>
                  </div>
                </div>
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
