'use client';

import React, { useState } from 'react';
import { useI18n, LOCALE_OPTIONS } from '@/lib/i18n';
import styles from '../../../styles/Home.module.css';
import type { AuthUser } from '../types';
import { KloudLogo } from './KloudLogo';
import { UserAvatarMenu } from '@/lib/UserAvatarMenu';

export function TopToolbar({ onBack, onSignIn, onSignOut, onOpenSettings, onOpenProfile, onOpenHelp, onOpenDesktopApp, user, hideAvatar }: { onBack?: () => void, onSignIn?: () => void, onSignOut?: () => void, onOpenSettings?: () => void, onOpenProfile?: () => void, onOpenHelp?: () => void, onOpenDesktopApp?: () => void, user?: AuthUser, hideAvatar?: boolean }) {
  const { t, locale, setLocale } = useI18n();
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const orgMenuRef = React.useRef<HTMLDivElement>(null);
  const langMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (orgMenuRef.current && !orgMenuRef.current.contains(event.target as Node)) {
        setOrgMenuOpen(false);
      }
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
          <div className={styles.navLogo} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }} onClick={() => window.location.assign('/')}>
            <KloudLogo />
          </div>
        </div>

        {/* ── Right: actions ── */}
        <div className={styles.topNavRight}>
          {/* Org dropdown — desktop only */}
          {user && (
            <div className={`${styles.orgDropdownWrapper} ${styles.navOrgDesktop}`} ref={orgMenuRef} style={{ marginRight: '0.5rem' }}>
              <button 
                className={styles.orgDropdownBtn} 
                onClick={() => setOrgMenuOpen(!orgMenuOpen)}
                style={{ padding: '0.4rem 0.65rem', fontSize: '0.85rem', color: '#4b5563', fontWeight: 500 }}
              >
                {user.displayName}@Kloud Corp
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14" style={{ marginLeft: '6px', opacity: 0.6 }}>
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
              {orgMenuOpen && (
                <div className={styles.orgDropdownMenu} style={{ right: 0, left: 'auto', marginTop: '1rem' }}>
                  <div className={styles.orgDropdownSection}>
                    <div className={styles.orgDropdownTitle}>{t('nav.switchAccount')}</div>
                    <button className={styles.orgDropdownItemActive}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '20px', height: '20px', borderRadius: '4px', background: '#4f46e5', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>K</div>
                        Kloud Corp
                      </div>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    </button>
                    <button className={styles.orgDropdownItem} onClick={() => setOrgMenuOpen(false)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '20px', height: '20px', borderRadius: '4px', background: '#e2e8f0', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>P</div>
                        KloudMeet Personal
                      </div>
                    </button>
                  </div>
                  <div className={styles.orgDropdownSection}>
                    <div className={styles.orgDropdownIdentity}>{t('nav.signedInAs', { name: user.displayName })}</div>
                    <button className={styles.orgDropdownItem} onClick={() => { setOrgMenuOpen(false); onOpenProfile && onOpenProfile(); }}>
                      {t('nav.myProfile')}
                    </button>
                    <button className={styles.orgDropdownItem} onClick={() => { setOrgMenuOpen(false); onSignOut && onSignOut(); }} style={{ color: '#ef4444' }}>
                      {t('nav.signOut')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

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

