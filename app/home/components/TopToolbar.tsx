'use client';

import React, { useState } from 'react';
import { useI18n, LOCALE_OPTIONS } from '@/lib/i18n';
import styles from '../../../styles/Home.module.css';
import type { AuthUser } from '../types';
import { KloudLogo } from './KloudLogo';
import { UserAvatarMenu } from '@/lib/UserAvatarMenu';

const LOCALE_TAGS: Record<string, string> = { en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR' };

/** Kloud platform switcher (9-dot menu): hidden until kloud.cn is ready to receive users from Meet. */
const SHOW_APP_SWITCHER = false;

/** "2:32 PM • Thu, Oct 23" in the active UI language; client-only (rendered after mount). */
function NavClock() {
  const { locale } = useI18n();
  const [now, setNow] = useState<Date | null>(null);

  React.useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;
  const tag = LOCALE_TAGS[locale] || undefined;
  let text = '';
  try {
    const time = now.toLocaleTimeString(tag, { hour: 'numeric', minute: '2-digit' });
    const date = now.toLocaleDateString(tag, { weekday: 'short', month: 'short', day: 'numeric' });
    text = `${time} • ${date}`;
  } catch {
    text = now.toLocaleString();
  }
  return (
    <span className={styles.navClock} aria-hidden="true">
      {text}
    </span>
  );
}

export function TopToolbar({
  onBack,
  onSignIn,
  onSignUp,
  onSignOut,
  onOpenSettings,
  onOpenProfile,
  onOpenHelp,
  onOpenDesktopApp,
  user,
  hideAvatar,
  hideLogo,
  showClock,
  transparent,
  tagline,
}: {
  onBack?: () => void;
  onSignIn?: () => void;
  /** When set together with onSignIn (and no user), shows Sign In / Sign Up buttons. */
  onSignUp?: () => void;
  onSignOut?: () => void;
  onOpenSettings?: () => void;
  onOpenProfile?: () => void;
  onOpenHelp?: () => void;
  onOpenDesktopApp?: () => void;
  user?: AuthUser;
  hideAvatar?: boolean;
  /** Auth pages show the logo inside the card instead. */
  hideLogo?: boolean;
  showClock?: boolean;
  transparent?: boolean;
  /** One quiet line beside the logo (the product promise on the signed-in home). */
  tagline?: string;
}) {
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

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setLangMenuOpen(false);
      }
      if (appSwitcherRef.current && !appSwitcherRef.current.contains(event.target as Node)) {
        setAppSwitcherOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setLangMenuOpen(false);
        setAppSwitcherOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  const currentLocale = LOCALE_OPTIONS.find((l) => l.code === locale);
  const themeLabel = theme === 'dark' ? t('nav.switchLightTheme') : t('nav.switchDarkTheme');
  const showAuthButtons = !user && !!onSignIn && !!onSignUp;

  const openPlatform = (path: string) => {
    setAppSwitcherOpen(false);
    window.location.href = getKloudPlatformUrl(path);
  };

  return (
    <nav className={`${styles.topNav}${transparent ? ` ${styles.topNavTransparent}` : ''}`}>
      <div className={styles.navInner}>
        {/* ── Left: back + logo ── */}
        <div className={styles.toolbarLeft}>
          {onBack && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onBack}
              aria-label={t('nav.goBack')}
              title={t('common.back')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            </button>
          )}
          {!hideLogo && (
            <button
              type="button"
              className={styles.navLogo}
              onClick={() => window.location.assign('/')}
              aria-label="Kloud Meet"
            >
              <KloudLogo variant="nav" />
            </button>
          )}
          {tagline && <span className={styles.navTagline}>{tagline}</span>}
        </div>

        {/* ── Right: clock, help, theme, language, apps, account ── */}
        <div className={styles.topNavRight}>
          {showClock && <NavClock />}

          <button
            type="button"
            className={styles.topNavIconBtn}
            aria-label={t('nav.help')}
            title={t('nav.help')}
            onClick={() => onOpenHelp?.()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="21" height="21" aria-hidden="true">
              <circle cx="12" cy="12" r="9"></circle>
              <path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.7-2.5 2-2.5 4M12 17h.01"></path>
            </svg>
          </button>

          <button
            type="button"
            className={styles.topNavIconBtn}
            aria-label={themeLabel}
            title={themeLabel}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="20" height="20" aria-hidden="true">
                <circle cx="12" cy="12" r="4"></circle>
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
                <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"></path>
              </svg>
            )}
          </button>

          {/* Language selector */}
          <div style={{ position: 'relative' }} ref={langMenuRef}>
            <button
              type="button"
              className={`${styles.topNavIconBtn} ${styles.navLangBtn}${langMenuOpen ? ` ${styles.topNavIconBtnActive}` : ''}`}
              aria-label={t('nav.langSelector')}
              aria-haspopup="menu"
              aria-expanded={langMenuOpen}
              onClick={() => setLangMenuOpen(!langMenuOpen)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="18" height="18" aria-hidden="true">
                <circle cx="12" cy="12" r="9"></circle>
                <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"></path>
              </svg>
              <span className={styles.navLangLabel}>{currentLocale?.label || 'English'}</span>
              <span className={styles.navLangShort}>{currentLocale?.shortCode || 'EN'}</span>
            </button>
            {langMenuOpen && (
              <div className={styles.dropdownMenu} role="menu" aria-label={t('nav.langSelector')} style={{ minWidth: '180px' }}>
                {LOCALE_OPTIONS.map((opt) => {
                  const active = locale === opt.code;
                  return (
                    <button
                      key={opt.code}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      className={`${styles.dropdownItem}${active ? ` ${styles.dropdownItemActive}` : ''}`}
                      onClick={() => {
                        setLocale(opt.code);
                        setLangMenuOpen(false);
                      }}
                    >
                      <span>{opt.label}</span>
                      <span className={styles.dropdownItemMeta}>{opt.shortCode}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* App Switcher — only for logged-in users with a Kloud platform account */}
          {SHOW_APP_SWITCHER && user && (
            <div style={{ position: 'relative' }} ref={appSwitcherRef}>
              <button
                type="button"
                className={`${styles.topNavIconBtn} ${appSwitcherOpen ? styles.topNavIconBtnActive : ''}`}
                aria-label="Kloud App Switcher"
                aria-haspopup="menu"
                aria-expanded={appSwitcherOpen}
                title="Switch to other Kloud products"
                onClick={() => setAppSwitcherOpen(!appSwitcherOpen)}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
                  <circle cx="5" cy="5" r="2" /><circle cx="12" cy="5" r="2" /><circle cx="19" cy="5" r="2" />
                  <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                  <circle cx="5" cy="19" r="2" /><circle cx="12" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
                </svg>
              </button>
              {appSwitcherOpen && (
                <div className={`${styles.dropdownMenu} ${styles.platformMenu}`}>
                  <div className={styles.platformLabel}>Kloud Platform</div>
                  <div className={styles.platformGrid}>
                    <button type="button" className={styles.platformTile} onClick={() => openPlatform('/livedoc/documents')}>
                      <span className={styles.platformIconWrap}>
                        <svg className={`${styles.platformIcon} ${styles.platformIconLivedoc}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round"/><polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </span>
                      <span className={styles.platformName}>LiveDoc</span>
                    </button>
                    <button type="button" className={`${styles.platformTile} ${styles.platformTileActive}`} aria-current="true" onClick={() => setAppSwitcherOpen(false)}>
                      <span className={styles.platformIconWrap}>
                        <svg className={`${styles.platformIcon} ${styles.platformIconMeet}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </span>
                      <span className={`${styles.platformName} ${styles.platformNameActive}`}>Meet ●</span>
                    </button>
                    <button type="button" className={styles.platformTile} onClick={() => openPlatform('/livedoc/meeting')}>
                      <span className={styles.platformIconWrap}>
                        <svg className={`${styles.platformIcon} ${styles.platformIconMeeting}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" strokeLinecap="round" /><line x1="8" y1="2" x2="8" y2="6" strokeLinecap="round" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                      </span>
                      <span className={styles.platformName}>Meeting</span>
                    </button>
                    <button type="button" className={styles.platformTile} onClick={() => openPlatform('/livedoc/livesync-list')}>
                      <span className={styles.platformIconWrap}>
                        <svg className={`${styles.platformIcon} ${styles.platformIconLivesync}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><polyline points="23 4 23 10 17 10" strokeLinecap="round" strokeLinejoin="round"/><polyline points="1 20 1 14 7 14" strokeLinecap="round" strokeLinejoin="round"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </span>
                      <span className={styles.platformName}>LiveSync</span>
                    </button>
                    <button type="button" className={styles.platformTile} onClick={() => openPlatform('/konverse/list')}>
                      <span className={styles.platformIconWrap}>
                        <svg className={`${styles.platformIcon} ${styles.platformIconKonverse}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </span>
                      <span className={styles.platformName}>Konverse</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Anonymous: Sign In (tonal) + Sign Up (filled) */}
          {showAuthButtons && (
            <div className={styles.navAuthBtns}>
              <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnTonal}`} onClick={onSignIn}>
                {t('nav.signIn')}
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnFill}`} onClick={onSignUp}>
                {t('nav.signUp')}
              </button>
            </div>
          )}

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
