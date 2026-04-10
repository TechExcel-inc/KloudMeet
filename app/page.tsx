'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { generateRoomId } from '@/lib/client-utils';
import { ScheduleMeetingModal } from '@/lib/ScheduleMeetingModal';
import { SystemSettingsModal } from '@/lib/SystemSettingsModal';
import { MyProfileModal } from '@/lib/MyProfileModal';
import { useI18n, LOCALE_OPTIONS, type Locale } from '@/lib/i18n';
import { HelpModal } from '@/lib/HelpModal';
import styles from '../styles/Home.module.css';

/* ────────── Types ────────── */
type PageView = 'anonymous' | 'login' | 'signup' | 'dashboard' | 'forgot-password';
type SignupStep = 'email' | 'verify' | 'create';

interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  token: string;
}

/* ────────── Placeholder recent meetings ────────── */
const MOCK_RECENT = [
  { date: '2026-03-25', host: 'Alice', start: '10:30 am', end: '11:30 am' },
  { date: '2026-03-24', host: 'Bob', start: '2:00 pm', end: '3:15 pm' },
  { date: '2026-03-22', host: 'Charlie', start: '9:00 am', end: '9:45 am' },
];
const MOCK_SCHEDULED = [
  { date: '2026-03-28', host: 'Alice', start: '10:00 am', end: '11:00 am' },
  { date: '2026-03-30', host: 'Team Standup', start: '9:30 am', end: '10:00 am' },
];

/* ════════════════════════════════════════════════════
   Logo Component
   ════════════════════════════════════════════════════ */
function KloudLogo({ size = 'sm', appendNode }: { size?: 'sm' | 'lg', appendNode?: React.ReactNode }) {
  // 尺寸调整：在上一次基础上减小约 20%
  const imgHeight = size === 'lg' ? 68 : 52;
  return (
    <div className={styles.logoRow}>
      <img src="/images/kloud-header-logo.svg" alt="Kloud Meet Logo" height={imgHeight} style={{ display: 'block' }} />
      {appendNode}
    </div>
  );
}

/* ════════════════════════════════════════════════════
   Toast Hook
   ════════════════════════════════════════════════════ */
function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(null), 2500);
  };
  const el = msg ? <div className={styles.toast}>{msg}</div> : null;
  return { show, el };
}

/* ════════════════════════════════════════════════════
   Top Toolbar Component
   ════════════════════════════════════════════════════ */
function TopToolbar({ onBack, onSignIn, onSignOut, onOpenSettings, onOpenProfile, onOpenHelp, user, hideAvatar }: { onBack?: () => void, onSignIn?: () => void, onSignOut?: () => void, onOpenSettings?: () => void, onOpenProfile?: () => void, onOpenHelp?: () => void, user?: AuthUser, hideAvatar?: boolean }) {
  const { t, locale, setLocale } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const orgMenuRef = React.useRef<HTMLDivElement>(null);
  const langMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
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
      <div className={styles.toolbarLeft}>
        {onBack && (
          <button className={styles.iconBtn} onClick={onBack} aria-label={t('nav.goBack')} title={t('common.back')} style={{ marginRight: '1rem' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }} onClick={() => window.location.assign('/')}>
          <KloudLogo />
        </div>
      </div>
      <div className={styles.topNavRight}>
        {user && (
          <div className={styles.orgDropdownWrapper} ref={orgMenuRef} style={{ marginRight: '0.5rem' }}>
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

        {/* Help button */}
        <button className={styles.topNavIconBtn} aria-label={t('nav.help')} title={t('nav.help')} onClick={() => onOpenHelp?.()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"></path>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </button>
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
        {!hideAvatar && (user ? (
          <div style={{ position: 'relative' }} ref={menuRef}>
            <button 
              className={styles.avatarBtn} 
              onClick={() => setMenuOpen(!menuOpen)} 
              aria-label="User Menu" 
              title="User Menu"
              style={{ overflow: 'hidden' }}
            >
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{user.displayName.charAt(0).toUpperCase()}</span>
              )}
            </button>
            {menuOpen && (
              <div className={styles.dropdownMenu}>
                <button 
                  className={styles.dropdownItem} 
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenProfile && onOpenProfile();
                  }}
                  style={{ borderBottom: '1px solid #f1f5f9' }}
                >
                  {t('nav.myProfile')}
                </button>
                <button 
                  className={styles.dropdownItem} 
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenSettings && onOpenSettings();
                  }}
                  style={{ borderBottom: '1px solid #f1f5f9' }}
                >
                  {t('nav.systemSettings')}
                </button>
                <button 
                  className={styles.dropdownItem} 
                  onClick={() => {
                    setMenuOpen(false);
                    onSignOut && onSignOut();
                  }}
                >
                  {t('nav.signOut')}
                </button>
              </div>
            )}
          </div>
        ) : onSignIn && (
          <button className={styles.avatarBtn} onClick={onSignIn} aria-label="Sign In via User Profile">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </button>
        ))}
      </div>
      </div>
    </nav>
  );
}

/* ════════════════════════════════════════════════════
   View 1 – Anonymous Join
   ════════════════════════════════════════════════════ */
function AnonymousView({
  onSignIn,
  onSignUp,
  onOpenHelp,
  toast,
}: {
  onSignIn: () => void;
  onSignUp: () => void;
  onOpenHelp: () => void;
  toast: { show: (t: string) => void };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [scheduledModalData, setScheduledModalData] = useState<any>(null);
  const [countdown, setCountdown] = useState<string>('');
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!scheduledModalData?.scheduledFor) return;
    const tick = () => {
      const target = new Date(scheduledModalData.scheduledFor).getTime();
      const diffMs = target - Date.now();
      if (diffMs <= 0) {
        setCountdown("00:00");
        return;
      }
      const totalSec = Math.floor(diffMs / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      setCountdown(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const intv = setInterval(tick, 1000);
    return () => clearInterval(intv);
  }, [scheduledModalData]);

  const handleJoin = async () => {
    const raw = code.trim();
    if (!raw) {
      setWarningMessage(t('anon.meetingCodeEmpty'));
      return;
    }
    if (isJoining) return;

    let roomId = raw;
    if (raw.includes('/rooms/')) {
      roomId = raw.split('/rooms/')[1].split('?')[0].split('#')[0];
    } else {
      roomId = raw.replace(/\s/g, '');
    }

    if (!roomId) {
      toast.show(t('anon.enterValidCode'));
      return;
    }
    
    // Preserve query string if they pasted a full URL with ?action=...
    let query = '';
    if (raw.includes('?')) {
      query = raw.substring(raw.indexOf('?'));
    }

    setIsJoining(true);

    try {
      const res = await fetch(`/api/meetings/${roomId}`);
      
      // 1. Non-Existing
      if (!res.ok) {
        setWarningMessage(t('anon.meetingNotFound'));
        setIsJoining(false);
        return;
      }
      
      const data = await res.json();
      
      // 2. Already Finished
      if (data.status === 'ENDED') {
        setWarningMessage(t('anon.meetingEnded'));
        setIsJoining(false);
        return;
      }
      
      // 6. Already In Progress
      if (data.isActive) {
        router.push(`/rooms/${roomId}${query}`);
        return;
      }

      // Check Scheduling
      if (data.scheduledFor) {
        const diffMs = new Date(data.scheduledFor).getTime() - Date.now();
        
        if (diffMs > 0) {
          // 4 & 5. Scheduled for Future (> 1Hr & < 1Hr) handled by Modal
          setScheduledModalData(data);
          setIsJoining(false);
          return;
        } else {
          // 3. Past Start Date (But Not Started)
          toast.show(t('anon.pastStartTime'));
          router.push(`/rooms/${roomId}${query}`);
          return;
        }
      }
      
      // Valid Path (3, 4, 5, 6)
      router.push(`/rooms/${roomId}${query}`);
    } catch(e) {
      console.error(e);
      setWarningMessage(t('anon.apiError'));
      setIsJoining(false);
    }
  };

  return (
    <div className={styles.anonWrapper}>
      <TopToolbar onSignIn={onSignIn} onOpenHelp={onOpenHelp} hideAvatar={true} />

      {/* ── Central Join Container ── */}
      <div className={styles.anonContainer}>
        <h1 className={styles.anonTitle}>{t('anon.joinMeeting')}</h1>
        <p className={styles.anonSubtitle}>
          {t('anon.hostPrivilege')}{' '}
          <button 
            type="button" 
            className={styles.linkBtn} 
            onClick={onSignIn} 
            style={{ fontSize: 'inherit', fontWeight: 500, display: 'inline', color: '#5E33DD' }}
          >
            {t('anon.signInHere')}
          </button>
        </p>

        <div className={styles.joinRow}>
          <input
            className={styles.joinInput}
            placeholder={t('anon.enterMeetingCode')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          />
          <button className={isJoining ? styles.joinBtnLoading : styles.joinBtn} onClick={handleJoin} disabled={isJoining} style={isJoining ? { opacity: 0.7, cursor: 'not-allowed' } : {}}>
            {isJoining ? t('common.joining') : t('common.join')}
          </button>
        </div>

        <div className={styles.recentSection}>
          <h3 className={styles.recentTitle}>{t('anon.recentMeetings')}</h3>
          {MOCK_RECENT.map((m, i) => (
            <div
              key={i}
              className={styles.recentCard}
              onClick={() => toast.show(t('anon.replaySoon'))}
            >
              <div style={{ minWidth: '85px' }}>
                <div className={styles.recentCardDate}>{m.date}</div>
                <div className={styles.recentCardTime}>{m.start}</div>
              </div>
              <div className={styles.recentCardName} style={{ flex: 1, textAlign: 'center' }}>{m.host}</div>
              <div className={styles.recentCardTime} style={{ minWidth: '85px', textAlign: 'right' }}>{m.end}</div>
            </div>
          ))}
        </div>

        <div className={styles.registerRow} style={{ marginTop: '1.5rem', borderTop: '1px solid #f1f5f9', paddingTop: '1.5rem' }}>
          <span>{t('anon.noAccount')}</span>
          <button type="button" className={styles.linkBtn} onClick={onSignUp}>
            {t('nav.signUp')}
          </button>
        </div>

        {/* ── Download Desktop App ── */}
        <div className={styles.downloadRow} style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <a
            href="/api/download?os=win"
            className={styles.downloadBtn}
            id="download-desktop-app-btn"
            title="Download Kloud Meet for Windows"
          >
            {/* Windows Logo */}
            <svg className={styles.downloadBtnIcon} viewBox="0 0 24 24" width="16" height="16" fill="#5E33DD">
              <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
            </svg>
            <span className={styles.downloadBtnLabel}>Windows App</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{ opacity: 0.5, marginLeft: 2 }}>
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </a>
          

            <a
              href="/api/download?os=mac"
              className={styles.downloadBtn}
              id="download-desktop-app-mac-btn"
              title="Download Kloud Meet for Mac"
            >
              {/* App Store Logo */}
              <svg className={styles.downloadBtnIcon} viewBox="0 0 24 24" width="16" height="16">
                <circle cx="12" cy="12" r="12" fill="#5E33DD" />
                <path d="M13.2 6.5h-2.4l-4.5 11h2.3l1.2-3.2h4.4l1.2 3.2h2.3l-4.5-11zm-2.8 6.2l1.6-4.3 1.6 4.3h-3.2z" fill="#fff" />
              </svg>
              <span className={styles.downloadBtnLabel}>macOS App</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{ opacity: 0.5, marginLeft: 2 }}>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </a>
        </div>
      </div>

      {/* ── Warning Message Overlay ── */}
      {warningMessage && (
        <div className={styles.dashModalOverlay} style={{ zIndex: 9999 }}>
          <div className={styles.dashModalContent} style={{ maxWidth: '400px', textAlign: 'center', padding: '2rem' }}>
            <div style={{ color: '#ef4444', marginBottom: '1rem' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="48" height="48" style={{ margin: '0 auto' }}>
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <h3 style={{ fontSize: '1.25rem', color: '#1e293b', marginBottom: '1rem' }}>{t('common.warning')}</h3>
            <p style={{ color: '#4b5563', lineHeight: '1.5', marginBottom: '2rem' }}>
              {warningMessage}
            </p>
            <button 
              onClick={() => setWarningMessage(null)} 
              className={styles.dashSignOut} 
              style={{ width: '100%', padding: '0.75rem', borderRadius: '12px' }}
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

      {/* ── Scheduled Meeting Overlay ── */}
      {scheduledModalData && (
        <div className={styles.dashModalOverlay}>
          <div className={styles.dashModalContent}>
            <h3>{t('anon.scheduledMeeting')}</h3>
            <p style={{ marginTop: '1rem', color: '#4b5563', lineHeight: '1.5' }}>
              {t('anon.hostedBy', { title: scheduledModalData.title || scheduledModalData.roomName, host: scheduledModalData.createdByMember?.fullName || 'Host' })}
            </p>
            {(() => {
              const diffMs = new Date(scheduledModalData.scheduledFor).getTime() - Date.now();
              return diffMs > 60 * 60 * 1000 ? (
                <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
                  <p style={{ color: '#64748b' }}>{t('anon.scheduledFor')} <strong>{new Date(scheduledModalData.scheduledFor).toLocaleString()}</strong></p>
                  <p style={{ marginTop: '0.5rem', color: '#334155' }}>{t('anon.moreThanHour')}</p>
                </div>
              ) : (
                <div style={{ textAlign: 'center', marginTop: '2rem', padding: '1.5rem', background: 'rgba(124, 58, 237, 0.05)', borderRadius: '12px', border: '1px solid rgba(124, 58, 237, 0.1)' }}>
                  <p style={{ color: '#6b7280', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('anon.startingIn')}</p>
                  <h2 style={{ fontSize: '3.5rem', margin: '0.5rem 0', color: '#5E33DD', fontFamily: 'monospace', fontWeight: 700 }}>{countdown}</h2>
                </div>
              );
            })()}
            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
              <button 
                onClick={() => setScheduledModalData(null)} 
                className={styles.dashSignOut} 
                style={{ flex: 1, padding: '0.75rem', borderRadius: '12px' }}
              >
                {t('common.close')}
              </button>
              {new Date(scheduledModalData.scheduledFor).getTime() - Date.now() <= 60 * 60 * 1000 && (
                <button 
                  onClick={() => {
                    router.push(`/rooms/${scheduledModalData.roomName}?action=join`);
                    setScheduledModalData(null);
                  }}
                  className={styles.modalBtnSubmit} 
                  style={{ flex: 1, padding: '0.75rem', borderRadius: '12px', width: 'auto' }}
                >
                  {t('anon.joinAnyway')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════
   View 2 – Login (Real API)
   ════════════════════════════════════════════════════ */
function LoginView({
  onBack,
  onLoginSuccess,
  onSignUp,
  onForgotPassword,
  onOpenHelp,
  toast,
}: {
  onBack: () => void;
  onLoginSuccess: (user: AuthUser) => void;
  onSignUp: () => void;
  onForgotPassword: () => void;
  onOpenHelp: () => void;
  toast: { show: (t: string) => void };
}) {
  const { t } = useI18n();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const id = identifier.trim();
    if (!id) { setError(t('login.pleaseEnterEmail')); return; }
    if (!password) { setError(t('login.pleaseEnterPassword')); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: id, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('login.loginFailed'));
        return;
      }
      const user: AuthUser = {
        id: data.user.id,
        username: data.user.username,
        displayName: data.user.fullName || data.user.username,
        email: data.user.email,
        avatarUrl: data.user.avatarUrl,
        token: data.token,
      };
      localStorage.setItem('kloudUser', JSON.stringify(user));
      onLoginSuccess(user);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.anonWrapper}>
      <TopToolbar onBack={onBack} onOpenHelp={onOpenHelp} hideAvatar />
      
      <div className={styles.authContainer}>
        <form className={styles.authCard} onSubmit={handleLogin}>
          <h1 className={styles.loginTitle}>{t('login.title')}</h1>

          {error && <div className={styles.errorBanner}>⚠ {error}</div>}

          <label className={styles.fieldLabel}>{t('login.emailOrLogin')}</label>
          <input
            className={error ? styles.fieldInputError : styles.fieldInput}
            type="text"
            placeholder={t('login.emailOrLogin')}
            value={identifier}
            onChange={(e) => { setIdentifier(e.target.value); setError(''); }}
            autoFocus
          />

          <label className={styles.fieldLabel}>{t('login.password')}</label>
          <div className={styles.passwordWrap}>
            <input
              className={error ? styles.fieldInputError : styles.fieldInput}
              type={showPassword ? 'text' : 'password'}
              placeholder={t('login.password')}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              style={{ paddingRight: '2.5rem' }}
            />
            <button
              type="button"
              className={styles.passwordToggle}
              onClick={() => setShowPassword(!showPassword)}
              style={{ top: 'calc(50% - 8px)' }}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>

          <div className={styles.forgotRow}>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={onForgotPassword}
            >
              {t('login.forgotPassword')}
            </button>
          </div>

          <button
            type="submit"
            className={loading ? styles.loginSubmitLoading : styles.loginSubmit}
            disabled={loading}
          >
            {loading ? (
              <>
                <svg className={styles.spinner} viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 11-6.219-8.56"></path>
                </svg>
                {t('login.signingIn')}
              </>
            ) : t('login.title')}
          </button>

          <div className={styles.ssoDivider}>{t('login.orContinueWith')}</div>
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', justifyContent: 'center' }}>
            <button type="button" className={styles.anonLink} style={{ flex: 1 }} onClick={() => window.location.href = '/api/auth/google'}>Google</button>
          </div>

          <div className={styles.registerRow}>
            <span>{t('anon.noAccount')}</span>
            <button type="button" className={styles.linkBtn} onClick={onSignUp}>
              {t('nav.signUp')}
            </button>
          </div>

          {/* ── Download Desktop App ── */}
          <div className={styles.downloadRow} style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
            <a
              href="/api/download?os=win"
              className={styles.downloadBtn}
              id="download-desktop-app-login-btn"
              title="Download Kloud Meet for Windows"
            >
              {/* Windows Logo */}
              <svg className={styles.downloadBtnIcon} viewBox="0 0 24 24" width="16" height="16" fill="#5E33DD">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
              </svg>
              <span className={styles.downloadBtnLabel}>Windows App</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{ opacity: 0.5, marginLeft: 2 }}>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </a>
            

            <a
              href="/api/download?os=mac"
              className={styles.downloadBtn}
              id="download-desktop-app-mac-login-btn"
              title="Download Kloud Meet for Mac"
            >
              {/* App Store Logo */}
              <svg className={styles.downloadBtnIcon} viewBox="0 0 24 24" width="16" height="16">
                <circle cx="12" cy="12" r="12" fill="#5E33DD" />
                <path d="M13.2 6.5h-2.4l-4.5 11h2.3l1.2-3.2h4.4l1.2 3.2h2.3l-4.5-11zm-2.8 6.2l1.6-4.3 1.6 4.3h-3.2z" fill="#fff" />
              </svg>
              <span className={styles.downloadBtnLabel}>macOS App</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{ opacity: 0.5, marginLeft: 2 }}>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════
   View 2b – Signup (3-step flow)
   ════════════════════════════════════════════════════ */
function SignupView({
  onBack,
  onSignupSuccess,
  onOpenHelp,
  toast,
}: {
  onBack: () => void;
  onSignupSuccess: (user: AuthUser) => void;
  onOpenHelp: () => void;
  toast: { show: (t: string) => void };
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<SignupStep>('email');
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);

  /* ── Step indicator ── */
  const stepIndex = step === 'email' ? 0 : step === 'verify' ? 1 : 2;
  const StepIndicator = () => (
    <div className={styles.signupSteps}>
      {[0, 1, 2].map((i) => (
        <React.Fragment key={i}>
          <div
            className={
              i < stepIndex
                ? styles.signupStepDotDone
                : i === stepIndex
                  ? styles.signupStepDotActive
                  : styles.signupStepDot
            }
          />
          {i < 2 && (
            <div className={i < stepIndex ? styles.signupStepLineDone : styles.signupStepLine} />
          )}
        </React.Fragment>
      ))}
    </div>
  );

  /* ── Start countdown timer ── */
  const startCountdown = useCallback(() => {
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(timer); return 0; }
        return c - 1;
      });
    }, 1000);
  }, []);

  /* ── Send verification code ── */
  const sendCode = async (target?: string) => {
    const addr = (target || email).trim();
    if (!addr) { setError(t('signup.pleaseEnterEmail')); return false; }
    setLoading(true);
    setError('');
    try {
      const isPhone = addr.startsWith('+');
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: addr, type: isPhone ? 1 : 0, intent: 'signup' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('signup.failedSendCode'));
        return false;
      }
      if (data.code) setDevCode(data.code);
      startCountdown();
      return true;
    } catch {
      setError(t('login.networkError'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 1: Email ── */
  const handleEmailNext = async () => {
    const tgt = email.trim();
    if (!tgt) { setError(t('signup.pleaseEnterEmail')); return; }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(tgt)) { setError(t('signup.invalidEmail')); return; }
    const ok = await sendCode(tgt);
    if (ok) setStep('verify');
  };

  /* ── Step 2: Verify ── */
  const handleVerifyNext = () => {
    if (verificationCode.length !== 6) {
      setError(t('signup.enterCode'));
      return;
    }
    setError('');
    setStep('create');
  };

  /* ── Step 3: Create account ── */
  const handleCreate = async () => {
    setError('');
    const usernameRe = /^(?!\d+$)[a-zA-Z0-9]{2,20}$/;
    if (!usernameRe.test(username)) {
      setError(t('signup.loginNameError'));
      return;
    }
    const passwordRe = /^(?![0-9]+$)(?![a-zA-Z]+$)[0-9A-Za-z]{8,30}$/;
    if (!passwordRe.test(password)) {
      setError(t('signup.passwordError'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('signup.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          username: username.trim(),
          password,
          verificationCode: verificationCode.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('signup.signupFailed'));
        return;
      }
      const user: AuthUser = {
        id: data.user.id,
        username: data.user.username,
        displayName: data.user.fullName || data.user.username,
        email: data.user.email,
        avatarUrl: data.user.avatarUrl,
        token: data.token,
      };
      localStorage.setItem('kloudUser', JSON.stringify(user));
      onSignupSuccess(user);
    } catch {
      setError(t('login.networkError'));
    } finally {
      setLoading(false);
    }
  };

  /* ── Back navigation ── */
  const handleBack = () => {
    setError('');
    if (step === 'create') setStep('verify');
    else if (step === 'verify') { setStep('email'); setVerificationCode(''); }
    else onBack();
  };

  return (
    <div className={styles.anonWrapper}>
      <TopToolbar onBack={handleBack} onOpenHelp={onOpenHelp} hideAvatar />
      
      <div className={styles.authContainer}>
        <div className={styles.authCard}>
          <h1 className={styles.loginTitle}>
            {step === 'verify' ? t('signup.verifyEmail') : t('signup.title')}
          </h1>

          <StepIndicator />

          {error && <div className={styles.errorBanner}>⚠ {error}</div>}

          {/* ── Step 1: Email ── */}
          {step === 'email' && (
            <>
              <label className={styles.fieldLabel}>{t('signup.emailAddress')}</label>
              <input
                className={error ? styles.fieldInputError : styles.fieldInput}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleEmailNext()}
                autoFocus
              />

              <button
                type="button"
                className={loading ? styles.loginSubmitLoading : styles.loginSubmit}
                disabled={loading}
                onClick={handleEmailNext}
              >
                {loading ? (
                  <>
                    <svg className={styles.spinner} viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 11-6.219-8.56"></path>
                    </svg>
                    {t('signup.sendingCode')}
                  </>
                ) : t('common.next')}
              </button>

              <div className={styles.ssoDivider}>{t('signup.orSignUpWith')}</div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                <button type="button" className={styles.anonLink} style={{ flex: 1 }} onClick={() => window.location.href = '/api/auth/google'}>Google</button>
              </div>

              <div className={styles.registerRow} style={{ marginTop: '1rem' }}>
                <span>{t('signup.alreadyHaveAccount')}</span>
                <button type="button" className={styles.linkBtn} onClick={onBack}>
                  {t('nav.signIn')}
                </button>
              </div>
            </>
          )}

          {/* ── Step 2: Verify ── */}
          {step === 'verify' && (
            <>
              <div className={styles.verifyIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="28" height="28">
                  <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className={styles.signupSubtext}>
                {t('signup.codeSentTo', { email })}
              </p>

              <input
                className={styles.verifyCodeInput}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                value={verificationCode}
                onChange={(e) => {
                  setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyNext()}
                autoFocus
              />

              {devCode && (
               <div className={styles.devHint}>{t('signup.devCode', { code: devCode })}</div>
              )}

              <button
                type="button"
                className={verificationCode.length === 6 ? styles.loginSubmit : styles.loginSubmitLoading}
                disabled={verificationCode.length !== 6}
                onClick={handleVerifyNext}
              >
                {t('signup.continue')}
              </button>

              <div className={styles.resendRow}>
                {countdown > 0 ? (
                  <span>{t('signup.resendIn', { seconds: String(countdown) })}</span>
                ) : (
                  <button type="button" className={styles.linkBtn} onClick={() => sendCode()}>
                    {t('signup.resendCode')}
                  </button>
                )}
              </div>
            </>
          )}

          {/* ── Step 3: Create account ── */}
          {step === 'create' && (
            <>
              <p className={styles.signupSubtext}>
                {t('signup.creatingFor', { email })}
              </p>

              <label className={styles.fieldLabel}>{t('signup.loginName')}</label>
              <input
                className={styles.fieldInput}
                type="text"
                placeholder={t('signup.loginNameHint')}
                maxLength={20}
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(''); }}
                autoFocus
              />
              <p className={styles.fieldHint}>{t('signup.cannotAllDigits')}</p>

              <label className={styles.fieldLabel}>{t('signup.passwordLabel')}</label>
              <div className={styles.passwordWrap}>
                <input
                  className={styles.fieldInput}
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('signup.passwordHint')}
                  maxLength={30}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  style={{ paddingRight: '2.5rem' }}
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ top: 'calc(50% - 8px)' }}
                >
                  {showPassword ? '🙈' : '👁'}
                </button>
              </div>

              <label className={styles.fieldLabel}>{t('signup.confirmPassword')}</label>
              <div className={styles.passwordWrap}>
                <input
                  className={styles.fieldInput}
                  type={showConfirm ? 'text' : 'password'}
                  placeholder={t('signup.confirmPasswordHint')}
                  maxLength={30}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                  style={{ paddingRight: '2.5rem' }}
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowConfirm(!showConfirm)}
                  style={{ top: 'calc(50% - 8px)' }}
                >
                  {showConfirm ? '🙈' : '👁'}
                </button>
              </div>

              <button
                type="button"
                className={loading ? styles.loginSubmitLoading : styles.loginSubmit}
                disabled={loading}
                onClick={handleCreate}
                style={{ marginTop: '0.5rem' }}
              >
                {loading ? (
                  <>
                    <svg className={styles.spinner} viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 11-6.219-8.56"></path>
                    </svg>
                    {t('signup.creatingAccount')}
                  </>
                ) : t('signup.title')}
              </button>

              <p style={{ fontSize: '0.78rem', color: '#9ca3af', textAlign: 'center', marginTop: '0.75rem' }}>
                {t('signup.termsNotice')}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════
   View 3 – Dashboard (Signed In)
   ════════════════════════════════════════════════════ */
function DashboardView({
  user,
  onSignOut,
  onOpenHelp,
  toast,
}: {
  user: AuthUser;
  onSignOut: () => void;
  onOpenHelp: () => void;
  toast: { show: (t: string) => void };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<any>(null);
  
  const [isJoining, setIsJoining] = useState(false);
  const [scheduledModalData, setScheduledModalData] = useState<any>(null);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  const [dbMeetings, setDbMeetings] = useState<any[]>([]);
  const [totalMeetings, setTotalMeetings] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [earlyStartMeeting, setEarlyStartMeeting] = useState<any>(null);
  const [deletingMeeting, setDeletingMeeting] = useState<any>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [meetingView, setMeetingView] = useState<'upcoming' | 'past'>('upcoming');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchMeetings = () => {
    if (!user || (!user.token && !user.id)) return;
    setLoadingMeetings(true);
    fetch(`/api/account/meetings?page=${page}&pageSize=${pageSize}`, {
      headers: { Authorization: `Bearer ${user.token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data.meetings) {
          const sorted = data.meetings.sort((a: any, b: any) => {
            const tA = a.scheduledFor ? new Date(a.scheduledFor).getTime() : new Date(a.createdAt).getTime();
            const tB = b.scheduledFor ? new Date(b.scheduledFor).getTime() : new Date(b.createdAt).getTime();
            return tB - tA;
          });
          setDbMeetings(sorted);
          setTotalMeetings(data.total || 0);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingMeetings(false));
  };

  useEffect(() => {
    fetchMeetings();
  }, [user, page, pageSize]);

  // Polling fallback to check processing recordings
  useEffect(() => {
    if (!user?.token) return;
    
    // Check if any meetings in the current list have a PROCESSING/UPLOADING recording
    const hasProcessing = dbMeetings.some(m => 
      m.recordings?.some((r: any) => ['PROCESSING', 'UPLOADING'].includes(r.status))
    );

    if (!hasProcessing) return;

    const intervalId = setInterval(() => {
      fetch('/api/account/recordings/sync', {
        headers: { Authorization: `Bearer ${user.token}` }
      })
      .then(res => res.json())
      .then(data => {
        if (data.updatedCount > 0) {
          // Re-fetch meetings silently without setting loading state
            fetch(`/api/account/meetings?page=${page}&pageSize=${pageSize}`, {
              headers: { Authorization: `Bearer ${user.token}` }
            })
              .then(res => res.json())
              .then(d => {
                if (d.meetings) {
                  const sorted = d.meetings.sort((a: any, b: any) => {
                    const tA = a.scheduledFor ? new Date(a.scheduledFor).getTime() : new Date(a.createdAt).getTime();
                    const tB = b.scheduledFor ? new Date(b.scheduledFor).getTime() : new Date(b.createdAt).getTime();
                    return tB - tA;
                  });
                  setDbMeetings(sorted);
                  setTotalMeetings(d.total || 0);
                }
              });
        }
      })
      .catch(console.error);
    }, 5000);

    return () => clearInterval(intervalId);
  }, [user, dbMeetings]);

  useEffect(() => {
    if (!scheduledModalData?.scheduledFor) return;
    const tick = () => {
      const target = new Date(scheduledModalData.scheduledFor).getTime();
      const diffMs = target - Date.now();
      if (diffMs <= 0) {
        setCountdown("00:00");
        const action = scheduledModalData.createdByMemberId === user.id ? 'start' : 'join';
        toast.show(t('dash.meetingStarting'));
        router.push(`/rooms/${scheduledModalData.roomName}?action=${action}`);
        setScheduledModalData(null);
        return;
      }
      if (diffMs > 3600000) {
        setCountdown("MORE_THAN_HOUR");
        return;
      }
      const totalSec = Math.floor(diffMs / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      setCountdown(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const intv = setInterval(tick, 1000);
    return () => clearInterval(intv);
  }, [scheduledModalData, router, user.id, toast]);

  const handleDeleteMeeting = async (roomName: string) => {
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/meetings/${roomName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (res.ok) {
        setDbMeetings(prev => prev.filter(m => m.roomName !== roomName));
        toast.show(t('dash.meetingDeleted'));
      } else {
        toast.show(t('dash.deleteFailure'));
      }
    } catch {
      toast.show(t('dash.networkError'));
    } finally {
      setDeleteLoading(false);
      setDeletingMeeting(null);
    }
  };

  const handleNewMeeting = async () => {
    const roomId = generateRoomId();
    if (user && user.id) {
      try {
        await fetch('/api/meetings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomName: roomId, createdByMemberId: user.id }),
        });
      } catch (e) {
        console.error('Failed to register meeting:', e);
      }
    }
    router.push(`/rooms/${roomId}?action=start`);
  };

  const handleJoinMeeting = async () => {
    const raw = joinCode.trim();
    if (!raw) {
      setWarningMessage(t('dash.enterValidCode'));
      return;
    }
    if (isJoining) return;
    
    let roomId = raw;
    if (raw.includes('/rooms/')) {
      roomId = raw.split('/rooms/')[1].split('?')[0].split('#')[0];
    } else {
      roomId = raw.replace(/\s/g, '');
    }

    if (!roomId) {
      toast.show('Please enter a valid meeting code');
      return;
    }
    
    setIsJoining(true);

    try {
      const res = await fetch(`/api/meetings/${roomId}`);
      
      // 1. Non-Existing
      if (!res.ok) {
        setWarningMessage(t('dash.meetingNotFoundDash'));
        setIsJoining(false);
        return;
      }
      
      const data = await res.json();
      const isHost = data.createdByMemberId === user.id;
      const targetAction = isHost && !data.isActive ? 'start' : 'join';
      
      // 2. Already Finished
      if (data.status === 'ENDED') {
        setWarningMessage('This meeting has already ended and is no longer available.');
        setIsJoining(false);
        return;
      }
      
      // 6. Already In Progress
      if (data.isActive) {
        router.push(`/rooms/${roomId}?action=${targetAction}`);
        return;
      }

      // Check Scheduling
      if (data.scheduledFor) {
        const diffMs = new Date(data.scheduledFor).getTime() - Date.now();
        
        if (diffMs > 0) {
          // 4 & 5. Scheduled for Future
          setScheduledModalData(data);
          setIsJoining(false);
          return;
        } else {
          // 3. Past Start Date (But Not Started)
          toast.show('The scheduled start time has passed. We are waiting for the Host to begin.');
          router.push(`/rooms/${roomId}?action=${targetAction}`);
          return;
        }
      }
      
      // Valid routing
      router.push(`/rooms/${roomId}?action=${targetAction}`);
    } catch(e) {
      console.error(e);
      setWarningMessage('An error occurred connecting to the API. Please try again.');
      setIsJoining(false);
    }
  };

  // Group meetings by date for Figma card layout
  const userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const toLocalDateStr = (date: Date) =>
    date.toLocaleDateString('en-CA', { timeZone: userTZ }); // produces YYYY-MM-DD

  const getDisplayDate = (m: any) => {
    const d = m.scheduledFor ? new Date(m.scheduledFor) : new Date(m.createdAt);
    const dateStr = toLocalDateStr(d);
    const todayStr = toLocalDateStr(new Date());
    const tomorrowDate = new Date(); tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const yesterdayDate = new Date(); yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const tomorrowStr = toLocalDateStr(tomorrowDate);
    const yesterdayStr = toLocalDateStr(yesterdayDate);
    if (dateStr === todayStr) return t('dash.today');
    if (dateStr === tomorrowStr) return t('dash.tomorrow');
    if (dateStr === yesterdayStr) return t('dash.yesterday');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: userTZ });
  };

  const filteredMeetings = dbMeetings
    .filter(m => {
      if (meetingView === 'upcoming') return m.status !== 'ENDED' && m.status !== 'CANCELED';
      return m.status === 'ENDED' || m.status === 'CANCELED';
    })
    .filter(m => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (m.title || '').toLowerCase().includes(q) ||
             (m.roomName || '').toLowerCase().includes(q) ||
             (m.createdByMember?.username || '').toLowerCase().includes(q);
    });

  const groupedMeetings = filteredMeetings.reduce((acc: Record<string, any[]>, m) => {
    const label = getDisplayDate(m);
    if (!acc[label]) acc[label] = [];
    acc[label].push(m);
    return acc;
  }, {});

  return (
    <div className={styles.anonWrapper}>
      <TopToolbar 
        user={user} 
        onSignOut={onSignOut} 
        onOpenSettings={() => setShowSettingsModal(true)} 
        onOpenProfile={() => setShowProfileModal(true)}
        onOpenHelp={onOpenHelp}
        hideAvatar={false} 
      />

      <div className={styles.dashStickyTop}>

        {/* ── QuickActions Glassmorphism Bar ── */}
        <div className={styles.quickActionsBar}>
          <div className={styles.quickActionsInner}>
            {/* Join input group */}
            <div className={styles.quickJoinGroup}>
              <input
                className={styles.quickJoinInput}
                placeholder={t('anon.enterMeetingCode')}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoinMeeting()}
              />
              <button
                className={styles.quickJoinBtn}
                onClick={handleJoinMeeting}
                disabled={!joinCode.trim()}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13.8 12H3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t('dash.joinMeeting')}
              </button>
            </div>
            {/* Divider */}
            <div className={styles.quickDivider} />
            {/* New Meeting */}
            <button className={styles.quickNewBtn} onClick={handleNewMeeting}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('dash.newMeeting')}
            </button>
          </div>
        </div>

        {/* ── Meeting List Header ── */}
        <div className={styles.meetingListHeader}>
          {/* Title + Tabs */}
          <div className={styles.meetingListTitleRow}>
            <h1 className={styles.meetingListTitle}>{t('dash.yourMeetings')}</h1>
            <div className={styles.meetingViewTabs}>
              <button
                className={meetingView === 'upcoming' ? styles.meetingTabActive : styles.meetingTab}
                onClick={() => setMeetingView('upcoming')}
              >
                {t('dash.upcoming')}
              </button>
              <button
                className={meetingView === 'past' ? styles.meetingTabActive : styles.meetingTab}
                onClick={() => setMeetingView('past')}
              >
                {t('dash.past')}
              </button>
            </div>
          </div>

          {/* Search + Schedule */}
          <div className={styles.meetingListActions}>
            <div className={styles.meetingSearchWrapper}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className={styles.meetingSearchIcon}>
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                className={styles.meetingSearchInput}
                placeholder={t('dash.searchMeetings')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {/* Filter funnel button */}
            <button className={styles.filterBtn} title="Filter meetings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
            </button>
            <button
              className={styles.scheduleBtn}
              onClick={() => setShowScheduleModal(true)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              {t('dash.scheduleMeeting')}
            </button>
          </div>

        </div>
      </div>
      <div className={styles.dashContainer}>

        {/* ── Meeting Cards ── */}
        {loadingMeetings ? (
          <div className={styles.meetingEmptyState}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40" style={{ color: '#cbd5e1', marginBottom: '0.75rem' }}>
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p>{t('dash.loadingMeetings')}</p>
          </div>
        ) : Object.keys(groupedMeetings).length === 0 ? (
          <div className={styles.meetingEmptyState}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48" style={{ color: '#cbd5e1', marginBottom: '0.75rem' }}>
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p>{t('dash.noMeetings')}</p>
          </div>
        ) : (
          <div className={styles.meetingCardsList}>
            {Object.entries(groupedMeetings).map(([dateLabel, meetings]) => (
              <div key={dateLabel} className={styles.meetingDateGroup}>
                {/* Date header */}
                <div className={styles.meetingDateHeader}>
                  <h2 className={styles.meetingDateLabel}>{dateLabel}</h2>
                  <div className={styles.meetingDateLine} />
                </div>

                {/* Cards */}
                <div className={styles.meetingCardsGroup}>
                  {(meetings as any[]).map((m, i) => {
                    const d = m.scheduledFor ? new Date(m.scheduledFor) : new Date(m.createdAt);
                    const recording = m.recordings?.find((r: any) => r.status === 'READY');
                    const processingRecording = !recording && m.recordings?.find((r: any) => ['PROCESSING', 'UPLOADING'].includes(r.status));
                    const failedRecording = !recording && !processingRecording && m.recordings?.find((r: any) => r.status === 'FAILED');
                    const diffMs = m.scheduledFor ? new Date(m.scheduledFor).getTime() - currentTime : -1;
                    const isHost = m.createdByMemberId === user.id;
                    const isLive = m.isActive;
                    const showStart = isHost && m.status !== 'ENDED' && m.status !== 'CANCELED' && !m.isActive && !recording && !processingRecording && !failedRecording && m.scheduledFor;

                    return (
                      <div
                        key={m.id || i}
                        className={isLive ? styles.meetingCardLive : styles.meetingCard}
                        onDoubleClick={() => setEditingMeeting(m)}
                      >
                        {/* Live badge */}
                        {isLive && (
                          <div className={styles.liveBadge}>
                            <span className={styles.liveDot} />
                            Live Now
                          </div>
                        )}

                        <div className={styles.meetingCardContent}>
                          {/* Time column — desktop only */}
                          <div className={styles.meetingCardTime}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ color: '#94a3b8', flexShrink: 0 }}>
                              <circle cx="12" cy="12" r="10"/>
                              <polyline points="12 6 12 12 16 14"/>
                            </svg>
                            <span>{d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</span>
                          </div>

                          {/* Info column */}
                          <div className={styles.meetingCardInfo}>
                            {/* Title row — includes mobile "..." button on right */}
                            <div className={styles.mobileCardTitleRow}>
                              <h3 className={styles.meetingCardTitle}>{m.title || m.roomName || 'Untitled Meeting'}</h3>
                              {/* Mobile-only three-dot menu */}
                              <button className={styles.mobileMenuBtn} onClick={(e) => e.stopPropagation()}>
                                <span>•••</span>
                              </button>
                            </div>

                            <div className={styles.meetingCardMeta}>
                              {/* Mobile: time + duration on same line */}
                              <span className={styles.mobileTimeLine}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                                  <circle cx="12" cy="12" r="10"/>
                                  <polyline points="12 6 12 12 16 14"/>
                                </svg>
                                {d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
                                {m.durationMinutes ? `\u00a0•\u00a0${m.durationMinutes} min` : ''}
                              </span>

                              {/* Desktop: duration + participants */}
                              {m.durationMinutes && <span className={styles.desktopMeta}>{m.durationMinutes} min</span>}
                              {m._count?.participants > 0 && (
                                <span className={`${styles.meetingCardMetaItem} ${styles.desktopMeta}`}>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                  {m._count.participants}
                                </span>
                              )}

                              {/* Mobile: attendees + host on same line */}
                              {m._count?.participants > 0 && (
                                <span className={styles.mobileMetaLine}>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                  {m._count.participants}{'\u00a0\u00a0'}Host: {m.createdByMember?.username || 'Unknown'}
                                </span>
                              )}

                              {/* Desktop: host */}
                              <span className={styles.desktopMeta}>Host: {m.createdByMember?.username || 'Unknown'}</span>

                              {/* Code — desktop inline */}
                              {m.roomName && (
                                <button
                                  className={`${styles.meetingCodeBtn} ${styles.desktopMeta}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard?.writeText(m.roomName);
                                    toast.show('Meeting code copied');
                                  }}
                                >
                                  {m.roomName}
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                                </button>
                              )}

                              {/* Code — mobile full line */}
                              {m.roomName && (
                                <button
                                  className={styles.mobileCodeLine}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard?.writeText(m.roomName);
                                    toast.show('Meeting code copied');
                                  }}
                                >
                                  Code: {m.roomName}
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Action area — right side of card */}
                          <div className={styles.meetingCardActions}>

                            {/* ── Always-visible: Join Now for live meetings ── */}
                            {isLive && (
                              <button
                                className={styles.joinNowBtn}
                                onClick={() => router.push(`/rooms/${m.roomName}?action=${isHost ? 'start' : 'join'}`)}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                                  <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                Join Now
                              </button>
                            )}

                            {/* ── Recording pill (always visible if available) ── */}
                            {recording && (
                              <button
                                className={styles.playRecordingBtn}
                                onClick={() => window.open(`/recordings/${recording.id}`, '_blank')}
                              >
                                <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M8 5v14l11-7z" /></svg>
                                Play
                              </button>
                            )}
                            {processingRecording && (
                              <div className={styles.recordingProcessing}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                Processing
                              </div>
                            )}

                            {/* ── Status badge (hidden on hover to make room for actions) ── */}
                            {!isLive && (
                              <span className={`${styles.statusBadge} ${styles.statusBadgeHideable} ${
                                m.status === 'ENDED' ? styles.statusFinished
                                : m.status === 'CANCELED' ? styles.statusCanceled
                                : diffMs < 0 && m.scheduledFor ? styles.statusPastDue
                                : m.scheduledFor ? styles.statusScheduled
                                : styles.statusFinished
                              }`}>
                                {m.status === 'ENDED' ? 'Finished'
                                  : m.status === 'CANCELED' ? 'Canceled'
                                  : diffMs < 0 && m.scheduledFor ? 'Past Due'
                                  : m.scheduledFor ? 'Scheduled'
                                  : 'Created'}
                              </span>
                            )}

                            {/* ── Hover action bar: slides in from right on card hover ── */}
                            <div className={styles.meetingHoverActions}>
                              {/* Join / Start */}
                              {!isLive && m.status !== 'ENDED' && m.status !== 'CANCELED' && (
                                <button
                                  className={isHost && !m.isActive && m.scheduledFor ? styles.startActionBtn : styles.cardJoinBtn}
                                  onClick={() => {
                                    if (isHost && m.scheduledFor) {
                                      const diff = new Date(m.scheduledFor).getTime() - Date.now();
                                      if (Math.abs(diff) > 15 * 60 * 1000) {
                                        setEarlyStartMeeting(m);
                                      } else {
                                        router.push(`/rooms/${m.roomName}?action=start`);
                                      }
                                    } else {
                                      router.push(`/rooms/${m.roomName}?action=${isHost ? 'start' : 'join'}`);
                                    }
                                  }}
                                >
                                  {isHost && !m.isActive ? (
                                    <>
                                      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M8 5v14l11-7z" /></svg>
                                      Start
                                    </>
                                  ) : (
                                    <>
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                      Join
                                    </>
                                  )}
                                </button>
                              )}

                              {/* Copy link */}
                              {m.roomName && (
                                <button
                                  title="Copy meeting link"
                                  className={styles.iconBtn}
                                  onClick={() => {
                                    const link = `${window.location.origin}/?code=${m.roomName}`;
                                    navigator.clipboard?.writeText(link);
                                    toast.show('Meeting link copied!');
                                  }}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </button>
                              )}

                              {/* Edit */}
                              {isHost && (
                                <button
                                  title="Edit meeting"
                                  className={styles.iconBtn}
                                  onClick={() => setEditingMeeting(m)}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </button>
                              )}

                              {/* Delete */}
                              {isHost && !m.isActive && (
                                <button
                                  title="Delete meeting"
                                  className={styles.iconBtnDanger}
                                  onClick={() => setDeletingMeeting(m)}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                    <polyline points="3 6 5 6 21 6" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>

                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Pagination */}
            <div className={styles.paginationFooter}>
              <div className={styles.paginationLeft}>
                <select
                  className={styles.pageSizeSelect}
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                >
                  <option value={15}>15 / Page</option>
                  <option value={25}>25 / Page</option>
                  <option value={50}>50 / Page</option>
                  <option value={100}>100 / Page</option>
                </select>
                <span className={styles.totalFiles}>{totalMeetings} {t('dash.totalRecords')}</span>
              </div>
              <div className={styles.paginationRight}>
                <button className={styles.pageArrow} disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>&lt;</button>
                {(() => {
                  const totalPages = Math.ceil(totalMeetings / pageSize) || 1;
                  const pages = [];
                  for (let i = 1; i <= Math.min(4, totalPages); i++) {
                    pages.push(
                      <button key={i} className={page === i ? styles.pageNumActive : styles.pageNum} onClick={() => setPage(i)}>{i}</button>
                    );
                  }
                  return pages;
                })()}
                <button className={styles.pageArrow} disabled={page >= Math.ceil(totalMeetings / pageSize)} onClick={() => setPage(p => Math.min(Math.ceil(totalMeetings / pageSize), p + 1))}>&gt;</button>
              </div>
            </div>
          </div>
        )}

      </div>{/* end dashContainer */}

      {scheduledModalData && (
        <div className={styles.dashModalOverlay}>
          <div className={styles.dashModalContent}>
            <h3>Scheduled Meeting</h3>
            <p style={{ marginTop: '1rem', color: '#4b5563', lineHeight: '1.5' }}>
              <strong>{scheduledModalData.title || scheduledModalData.roomName}</strong> is hosted by <strong>{scheduledModalData.createdByMember?.fullName || 'Host'}</strong>.
            </p>
            {(() => {
              const diffMs = new Date(scheduledModalData.scheduledFor).getTime() - Date.now();
              return diffMs > 60 * 60 * 1000 ? (
                <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
                  <p style={{ color: '#64748b' }}>Scheduled for: <strong>{new Date(scheduledModalData.scheduledFor).toLocaleString()}</strong></p>
                  <p style={{ marginTop: '0.5rem', color: '#334155' }}>This meeting is more than an hour away. Please check back closer to the start time.</p>
                </div>
              ) : (
                <div style={{ textAlign: 'center', marginTop: '2rem', padding: '1.5rem', background: 'rgba(124, 58, 237, 0.05)', borderRadius: '12px', border: '1px solid rgba(124, 58, 237, 0.1)' }}>
                  <p style={{ color: '#6b7280', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Starting in</p>
                  <h2 style={{ fontSize: '3.5rem', margin: '0.5rem 0', color: '#5E33DD', fontFamily: 'monospace', fontWeight: 700 }}>{countdown}</h2>
                </div>
              );
            })()}
            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
              <button 
                onClick={() => setScheduledModalData(null)} 
                className={styles.dashSignOut} 
                style={{ flex: 1, padding: '0.75rem', borderRadius: '12px' }}
              >
                Close
              </button>
              {new Date(scheduledModalData.scheduledFor).getTime() - Date.now() <= 60 * 60 * 1000 && (
                <button 
                  onClick={() => {
                    const isHost = scheduledModalData.createdByMemberId === user.id;
                    const action = isHost ? 'start' : 'join';
                    setScheduledModalData(null);
                    router.push(`/rooms/${scheduledModalData.roomName}?action=${action}`);
                  }} 
                  className={styles.dashJoinBtn} 
                  style={{ flex: 1, padding: '0.75rem', borderRadius: '12px', width: 'auto' }}
                >
                  {scheduledModalData.createdByMemberId === user.id ? 'Start Meeting' : 'Join Anyway'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showScheduleModal && (
        <ScheduleMeetingModal 
          user={user}
          onClose={() => setShowScheduleModal(false)}
          onSave={() => {
            setShowScheduleModal(false);
            fetchMeetings();
          }} 
        />
      )}

      {editingMeeting && (
        <ScheduleMeetingModal 
          user={user}
          existingMeeting={editingMeeting}
          onClose={() => setEditingMeeting(null)}
          onSave={() => {
            setEditingMeeting(null);
            fetchMeetings();
          }} 
        />
      )}

      {earlyStartMeeting && (
        <div className={styles.dashModalOverlay}>
          <div className={styles.dashModalContent}>
            <h3 style={{ marginTop: 0, color: '#111827', fontSize: '1.25rem' }}>Start Meeting Outside Window?</h3>
            <p style={{ color: '#4b5563', lineHeight: '1.5', fontSize: '0.95rem' }}>
              This meeting is scheduled to begin at <strong>{new Date(earlyStartMeeting.scheduledFor).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</strong>. The current time is outside the standard 15-minute starting window.
              <br /><br />
              Are you sure you want to start this meeting right now?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '28px' }}>
              <button 
                onClick={() => setEarlyStartMeeting(null)}
                style={{
                  padding: '9px 18px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem'
                }}
              >
                Cancel
              </button>
              <button 
                onClick={() => router.push(`/rooms/${earlyStartMeeting.roomName}?action=start`)}
                style={{
                  padding: '9px 18px', borderRadius: '8px', border: 'none', background: '#db2777', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem'
                }}
              >
                Yes, Start Meeting
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <SystemSettingsModal 
          onClose={() => setShowSettingsModal(false)}
          onSave={() => {
            setShowSettingsModal(false);
            toast.show('System Settings saved globally!');
          }}
        />
      )}

      {showProfileModal && (
        <MyProfileModal 
          user={user} 
          onClose={() => setShowProfileModal(false)}
          toast={toast}
        />
      )}

      {/* ── Warning Message Overlay ── */}
      {warningMessage && (
        <div className={styles.dashModalOverlay} style={{ zIndex: 9999 }}>
          <div className={styles.dashModalContent} style={{ maxWidth: '400px', textAlign: 'center', padding: '2rem' }}>
            <div style={{ color: '#ef4444', marginBottom: '1rem' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="48" height="48" style={{ margin: '0 auto' }}>
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <h3 style={{ fontSize: '1.25rem', color: '#1e293b', marginBottom: '1rem' }}>Warning</h3>
            <p style={{ color: '#4b5563', lineHeight: '1.5', marginBottom: '2rem' }}>
              {warningMessage}
            </p>
            <button 
              onClick={() => setWarningMessage(null)} 
              className={styles.dashSignOut} 
              style={{ width: '100%', padding: '0.75rem', borderRadius: '12px', background: '#f1f5f9', border: '1px solid #e2e8f0' }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deletingMeeting && (
        <div className={styles.dashModalOverlay} style={{ zIndex: 9999 }}>
          <div className={styles.dashModalContent} style={{ maxWidth: '400px', textAlign: 'center', padding: '2rem' }}>
            <div style={{ color: '#ef4444', marginBottom: '1rem' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="48" height="48" style={{ margin: '0 auto' }}>
                <polyline points="3 6 5 6 21 6" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 style={{ fontSize: '1.2rem', color: '#1e293b', marginBottom: '0.5rem' }}>Delete Meeting?</h3>
            <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: 1.5 }}>
              <strong>{deletingMeeting.title || deletingMeeting.roomName}</strong> will be permanently deleted.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setDeletingMeeting(null)}
                className={styles.dashSignOut}
                style={{ flex: 1, padding: '0.75rem', borderRadius: '12px', background: '#f1f5f9', border: '1px solid #e2e8f0' }}
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteMeeting(deletingMeeting.roomName)}
                style={{ flex: 1, padding: '0.75rem', borderRadius: '12px', background: '#ef4444', color: '#fff', border: 'none', fontWeight: 600, cursor: deleteLoading ? 'not-allowed' : 'pointer', opacity: deleteLoading ? 0.7 : 1 }}
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════
   View 4 – Forgot Password
   ════════════════════════════════════════════════════ */
function ForgotPasswordView({
  onBack,
  onOpenHelp,
  toast,
}: {
  onBack: () => void;
  onOpenHelp: () => void;
  toast: { show: (t: string) => void };
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<'email' | 'verify' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  const sendCode = async () => {
    const addr = email.trim();
    if (!addr) { setError(t('forgot.pleaseEnterEmail')); return false; }
    setLoading(true);
    setError('');
    try {
      const isPhone = addr.startsWith('+');
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: addr, type: isPhone ? 1 : 0, intent: 'reset' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('signup.failedSendCode'));
        return false;
      }
      if (data.code) setDevCode(data.code);
      return true;
    } catch {
      setError(t('login.networkError'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleEmailNext = async () => {
    const ok = await sendCode();
    if (ok) setStep('verify');
  };

  const handleVerifyNext = () => {
    if (verificationCode.length !== 6) { setError(t('forgot.enter6Digit')); return; }
    setError('');
    setStep('reset');
  };

  const handleReset = async () => {
    setError('');
    const passwordRe = /^(?![0-9]+$)(?![a-zA-Z]+$)[0-9A-Za-z]{8,30}$/;
    if (!passwordRe.test(password)) {
      setError(t('signup.passwordError'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('signup.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      const isPhone = email.trim().startsWith('+');
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [isPhone ? 'phone' : 'email']: email.trim(),
          code: verificationCode.trim(),
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('forgot.resetFailed'));
        return;
      }
      toast.show(t('forgot.resetSuccess'));
      onBack();
    } catch {
      setError(t('login.networkError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.anonWrapper}>
      <TopToolbar onBack={() => {
        if (step === 'reset') setStep('verify');
        else if (step === 'verify') { setStep('email'); setVerificationCode(''); }
        else onBack();
      }} hideAvatar />
      <div className={styles.authContainer}>
        <div className={styles.authCard}>
          <h1 className={styles.loginTitle}>{t('forgot.title')}</h1>
          {error && <div className={styles.errorBanner}>⚠ {error}</div>}

          {step === 'email' && (
            <>
              <p className={styles.signupSubtext}>{t('forgot.description')}</p>
              <label className={styles.fieldLabel}>{t('forgot.emailOrPhone')}</label>
              <input
                className={error ? styles.fieldInputError : styles.fieldInput}
                type="text"
                placeholder="you@example.com or +123"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleEmailNext()}
                autoFocus
              />
              <button
                type="button"
                className={loading ? styles.loginSubmitLoading : styles.loginSubmit}
                disabled={loading}
                onClick={handleEmailNext}
              >
                {loading ? t('signup.sendingCode') : t('common.next')}
              </button>
            </>
          )}

          {step === 'verify' && (
            <>
              <p className={styles.signupSubtext}>{t('forgot.codeSentTo', { email })}</p>
              <input
                className={styles.verifyCodeInput}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                value={verificationCode}
                onChange={(e) => {
                  setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyNext()}
                autoFocus
              />
              {devCode && <div className={styles.devHint}>{t('forgot.devCode', { code: devCode })}</div>}
              <button
                type="button"
                className={verificationCode.length === 6 ? styles.loginSubmit : styles.loginSubmitLoading}
                disabled={verificationCode.length !== 6}
                onClick={handleVerifyNext}
              >
                {t('forgot.verifyCode')}
              </button>
            </>
          )}

          {step === 'reset' && (
            <>
              <label className={styles.fieldLabel}>{t('forgot.newPassword')}</label>
              <div className={styles.passwordWrap}>
                <input
                  className={styles.fieldInput}
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('signup.passwordHint')}
                  maxLength={30}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  style={{ paddingRight: '2.5rem' }}
                />
                <button type="button" className={styles.passwordToggle} onClick={() => setShowPassword(!showPassword)}>{showPassword ? '🙈' : '👁'}</button>
              </div>

              <label className={styles.fieldLabel}>{t('forgot.confirmNewPassword')}</label>
              <div className={styles.passwordWrap}>
                <input
                  className={styles.fieldInput}
                  type={showConfirm ? 'text' : 'password'}
                  placeholder={t('signup.confirmPasswordHint')}
                  maxLength={30}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                  style={{ paddingRight: '2.5rem' }}
                />
                <button type="button" className={styles.passwordToggle} onClick={() => setShowConfirm(!showConfirm)}>{showConfirm ? '🙈' : '👁'}</button>
              </div>

              <button
                type="button"
                className={loading ? styles.loginSubmitLoading : styles.loginSubmit}
                disabled={loading}
                onClick={handleReset}
                style={{ marginTop: '0.5rem' }}
              >
                {loading ? t('forgot.resetting') : t('forgot.resetPassword')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════
   Main Page (state machine)
   ════════════════════════════════════════════════════ */
function HomeContent() {
  const [view, setView] = useState<PageView>('anonymous');
  const [signupSource, setSignupSource] = useState<PageView>('login');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const toast = useToast();
  const searchParams = useSearchParams();

  // Handle SSO token via URL
  useEffect(() => {
    const ssoToken = searchParams.get('sso_token');
    const errorMsg = searchParams.get('error');

    if (errorMsg) {
      toast.show(errorMsg);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (ssoToken) {
      fetch('/api/auth/profile', {
        headers: { Authorization: `Bearer ${ssoToken}` }
      })
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          const u: AuthUser = {
            id: data.id,
            username: data.username,
            displayName: data.fullName || data.username,
            email: data.email,
            avatarUrl: data.avatarUrl,
            token: ssoToken,
          };
          localStorage.setItem('kloudUser', JSON.stringify(u));
          handleAuthSuccess(u);
          toast.show('Signed in with Google');
        } else {
          toast.show(data.error || 'Failed to get profile');
        }
      })
      .catch(err => {
        console.error('SSO profile error', err);
        toast.show('Network error logging in with Google');
      })
      .finally(() => {
        window.history.replaceState({}, document.title, window.location.pathname);
      });
    }
  }, [searchParams]);

  // Restore session from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('kloudUser');
      if (stored) {
        const parsed = JSON.parse(stored) as AuthUser;
        setUser(parsed);
        setView('dashboard');
      }
    } catch {}
  }, []);

  const handleAuthSuccess = (u: AuthUser) => {
    setUser(u);
    setView('dashboard');
  };

  const handleSignOut = () => {
    localStorage.removeItem('kloudUser');
    setUser(null);
    setView('anonymous');
  };

  return (
    <>
      {toast.el}
      <div className={styles.bgGlow} />
      {view === 'anonymous' && (
        <AnonymousView onSignIn={() => setView('login')} onSignUp={() => { setSignupSource('anonymous'); setView('signup'); }} onOpenHelp={() => setShowHelp(true)} toast={toast} />
      )}
      {view === 'login' && (
        <LoginView
          onBack={() => setView('anonymous')}
          onLoginSuccess={handleAuthSuccess}
          onSignUp={() => { setSignupSource('login'); setView('signup'); }}
          onForgotPassword={() => setView('forgot-password')}
          onOpenHelp={() => setShowHelp(true)}
          toast={toast}
        />
      )}
      {view === 'forgot-password' && (
        <ForgotPasswordView
          onBack={() => setView('login')}
          onOpenHelp={() => setShowHelp(true)}
          toast={toast}
        />
      )}
      {view === 'signup' && (
        <SignupView
          onBack={() => setView(signupSource)}
          onSignupSuccess={handleAuthSuccess}
          onOpenHelp={() => setShowHelp(true)}
          toast={toast}
        />
      )}
      {view === 'dashboard' && user && (
        <DashboardView user={user} onSignOut={handleSignOut} onOpenHelp={() => setShowHelp(true)} toast={toast} />
      )}

      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </>
  );
}

export default function Page() {
  return (
    <main className={styles.main}>
      <Suspense fallback="Loading">
        <HomeContent />
      </Suspense>
    </main>
  );
}
