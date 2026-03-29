'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { generateRoomId } from '@/lib/client-utils';
import { ScheduleMeetingModal } from '@/lib/ScheduleMeetingModal';
import { SystemSettingsModal } from '@/lib/SystemSettingsModal';
import { MyProfileModal } from '@/lib/MyProfileModal';
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
  const iconSize = size === 'lg' ? 48 : 36;
  const fontSize = size === 'lg' ? '2rem' : '1.35rem';
  return (
    <div className={styles.logoRow}>
      <div
        className={size === 'lg' ? styles.loginBrandLogoIcon : styles.logoIcon}
        style={{ width: iconSize, height: iconSize }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" width={iconSize * 0.5} height={iconSize * 0.5}>
          <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span className={styles.logoText} style={{ fontSize, color: size === 'lg' ? '#fff' : '#1e1e2e' }}>
        Kloud Meet
      </span>
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
function TopToolbar({ onBack, onSignIn, onSignOut, onOpenSettings, onOpenProfile, user, hideAvatar }: { onBack?: () => void, onSignIn?: () => void, onSignOut?: () => void, onOpenSettings?: () => void, onOpenProfile?: () => void, user?: AuthUser, hideAvatar?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
      if (orgMenuRef.current && !orgMenuRef.current.contains(event.target as Node)) {
        setOrgMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={styles.topToolbar}>
      <div className={styles.toolbarLeft}>
        {onBack && (
          <button className={styles.iconBtn} onClick={onBack} aria-label="Go Back" title="Back" style={{ marginRight: '1rem' }}>
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
      <div className={styles.toolbarRight}>
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
                  <div className={styles.orgDropdownTitle}>Switch Account</div>
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
                  <div className={styles.orgDropdownIdentity}>Signed in as {user.displayName}</div>
                  <button className={styles.orgDropdownItem} onClick={() => { setOrgMenuOpen(false); onOpenProfile && onOpenProfile(); }}>
                    My Profile
                  </button>
                  <button className={styles.orgDropdownItem} onClick={() => { setOrgMenuOpen(false); onSignOut && onSignOut(); }} style={{ color: '#ef4444' }}>
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <button className={styles.iconBtn} aria-label="Help" title="Help">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"></path>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </button>
        <button className={styles.iconBtn} aria-label="Language Selector" style={{ paddingLeft: '0.65rem', paddingRight: '0.55rem' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"></path>
          </svg>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, marginLeft: '0.3rem' }}>EN</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginLeft: '0.1rem', marginTop: '1px' }}>
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
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
                  My Profile
                </button>
                <button 
                  className={styles.dropdownItem} 
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenSettings && onOpenSettings();
                  }}
                  style={{ borderBottom: '1px solid #f1f5f9' }}
                >
                  System Settings
                </button>
                <button 
                  className={styles.dropdownItem} 
                  onClick={() => {
                    setMenuOpen(false);
                    onSignOut && onSignOut();
                  }}
                >
                  Sign Out
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
  );
}

/* ════════════════════════════════════════════════════
   View 1 – Anonymous Join
   ════════════════════════════════════════════════════ */
function AnonymousView({
  onSignIn,
  onSignUp,
  toast,
}: {
  onSignIn: () => void;
  onSignUp: () => void;
  toast: { show: (t: string) => void };
}) {
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
      setWarningMessage('Meeting code cannot be empty. Please enter a valid code to join.');
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
        setWarningMessage('Meeting not found. Please review the code or Sign In to schedule a new one.');
        setIsJoining(false);
        return;
      }
      
      const data = await res.json();
      
      // 2. Already Finished
      if (data.status === 'ENDED') {
        setWarningMessage('This meeting has already ended and is no longer available.');
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
          toast.show('The scheduled start time has passed. We are waiting for the Host to begin.');
          router.push(`/rooms/${roomId}${query}`);
          return;
        }
      }
      
      // Valid Path (3, 4, 5, 6)
      router.push(`/rooms/${roomId}${query}`);
    } catch(e) {
      console.error(e);
      setWarningMessage('An error occurred connecting to the API. Please try again.');
      setIsJoining(false);
    }
  };

  return (
    <div className={styles.anonWrapper}>
      <TopToolbar onSignIn={onSignIn} hideAvatar={true} />

      {/* ── Central Join Container ── */}
      <div className={styles.anonContainer}>
        <h1 className={styles.anonTitle}>Join Meeting</h1>
        <p className={styles.anonSubtitle}>
          To host a meeting or join with more privileges,{' '}
          <button 
            type="button" 
            className={styles.linkBtn} 
            onClick={onSignIn} 
            style={{ fontSize: 'inherit', fontWeight: 500, display: 'inline', color: '#5b21b6' }}
          >
            Sign In Here
          </button>
        </p>

        <div className={styles.joinRow}>
          <input
            className={styles.joinInput}
            placeholder="Enter meeting code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          />
          <button className={isJoining ? styles.joinBtnLoading : styles.joinBtn} onClick={handleJoin} disabled={isJoining} style={isJoining ? { opacity: 0.7, cursor: 'not-allowed' } : {}}>
            {isJoining ? 'Joining...' : 'Join'}
          </button>
        </div>

        <div className={styles.recentSection}>
          <h3 className={styles.recentTitle}>Recent Meetings</h3>
          {MOCK_RECENT.map((m, i) => (
            <div
              key={i}
              className={styles.recentCard}
              onClick={() => toast.show('Meeting replay coming soon!')}
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
          <span>Don&apos;t have a Kloud account?</span>
          <button type="button" className={styles.linkBtn} onClick={onSignUp}>
            Sign Up
          </button>
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
            <h3 style={{ fontSize: '1.25rem', color: '#1e293b', marginBottom: '1rem' }}>Warning</h3>
            <p style={{ color: '#4b5563', lineHeight: '1.5', marginBottom: '2rem' }}>
              {warningMessage}
            </p>
            <button 
              onClick={() => setWarningMessage(null)} 
              className={styles.dashSignOut} 
              style={{ width: '100%', padding: '0.75rem', borderRadius: '12px' }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Scheduled Meeting Overlay ── */}
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
                  <h2 style={{ fontSize: '3.5rem', margin: '0.5rem 0', color: '#7c3aed', fontFamily: 'monospace', fontWeight: 700 }}>{countdown}</h2>
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
                    router.push(`/rooms/${scheduledModalData.roomName}?action=join`);
                    setScheduledModalData(null);
                  }}
                  className={styles.modalBtnSubmit} 
                  style={{ flex: 1, padding: '0.75rem', borderRadius: '12px', width: 'auto' }}
                >
                  Join Anyway
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
  toast,
}: {
  onBack: () => void;
  onLoginSuccess: (user: AuthUser) => void;
  onSignUp: () => void;
  onForgotPassword: () => void;
  toast: { show: (t: string) => void };
}) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const id = identifier.trim();
    if (!id) { setError('Please enter your email or login name'); return; }
    if (!password) { setError('Please enter your password'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: id, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
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
      <TopToolbar onBack={onBack} hideAvatar />
      
      <div className={styles.authContainer}>
        <form className={styles.authCard} onSubmit={handleLogin}>
          <h1 className={styles.loginTitle}>Sign In</h1>

          {error && <div className={styles.errorBanner}>⚠ {error}</div>}

          <label className={styles.fieldLabel}>Email or login name</label>
          <input
            className={error ? styles.fieldInputError : styles.fieldInput}
            type="text"
            placeholder="Email or login name"
            value={identifier}
            onChange={(e) => { setIdentifier(e.target.value); setError(''); }}
            autoFocus
          />

          <label className={styles.fieldLabel}>Password</label>
          <div className={styles.passwordWrap}>
            <input
              className={error ? styles.fieldInputError : styles.fieldInput}
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
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
              Forgot password
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
                Signing in...
              </>
            ) : 'Sign In'}
          </button>

          <div className={styles.ssoDivider}>or continue with</div>
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', justifyContent: 'center' }}>
            <button type="button" className={styles.anonLink} style={{ flex: 1 }} onClick={() => window.location.href = '/api/auth/google'}>Google</button>
          </div>

          <div className={styles.registerRow}>
            <span>Don&apos;t have a Kloud account?</span>
            <button type="button" className={styles.linkBtn} onClick={onSignUp}>
              Sign Up
            </button>
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
  toast,
}: {
  onBack: () => void;
  onSignupSuccess: (user: AuthUser) => void;
  toast: { show: (t: string) => void };
}) {
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
    const t = (target || email).trim();
    if (!t) { setError('Please enter your email address'); return false; }
    setLoading(true);
    setError('');
    try {
      const isPhone = t.startsWith('+');
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: t, type: isPhone ? 1 : 0, intent: 'signup' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to send code');
        return false;
      }
      if (data.code) setDevCode(data.code);
      startCountdown();
      return true;
    } catch {
      setError('Network error. Please try again.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 1: Email ── */
  const handleEmailNext = async () => {
    const t = email.trim();
    if (!t) { setError('Please enter your email address'); return; }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(t)) { setError('Please enter a valid email address'); return; }
    const ok = await sendCode(t);
    if (ok) setStep('verify');
  };

  /* ── Step 2: Verify ── */
  const handleVerifyNext = () => {
    if (verificationCode.length !== 6) {
      setError('Please enter the 6-digit verification code');
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
      setError('Login name: 2-20 chars, letters & numbers, cannot be all digits');
      return;
    }
    const passwordRe = /^(?![0-9]+$)(?![a-zA-Z]+$)[0-9A-Za-z]{8,30}$/;
    if (!passwordRe.test(password)) {
      setError('Password: 8-30 chars with both letters and numbers');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
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
        setError(data.error || 'Signup failed');
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
      setError('Network error. Please try again.');
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
      <TopToolbar onBack={handleBack} hideAvatar />
      
      <div className={styles.authContainer}>
        <div className={styles.authCard}>
          <h1 className={styles.loginTitle}>
            {step === 'verify' ? 'Verify Email' : 'Sign Up'}
          </h1>

          <StepIndicator />

          {error && <div className={styles.errorBanner}>⚠ {error}</div>}

          {/* ── Step 1: Email ── */}
          {step === 'email' && (
            <>
              <label className={styles.fieldLabel}>Email address</label>
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
                    Sending code...
                  </>
                ) : 'Next'}
              </button>

              <div className={styles.ssoDivider}>or sign up with</div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                <button type="button" className={styles.anonLink} style={{ flex: 1 }} onClick={() => window.location.href = '/api/auth/google'}>Google</button>
              </div>

              <div className={styles.registerRow} style={{ marginTop: '1rem' }}>
                <span>Already have an account?</span>
                <button type="button" className={styles.linkBtn} onClick={onBack}>
                  Sign In
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
                We sent a 6-digit code to <strong>{email}</strong>
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
               <div className={styles.devHint}>Dev mode — use code: <strong>{devCode}</strong></div>
              )}

              <button
                type="button"
                className={verificationCode.length === 6 ? styles.loginSubmit : styles.loginSubmitLoading}
                disabled={verificationCode.length !== 6}
                onClick={handleVerifyNext}
              >
                Continue
              </button>

              <div className={styles.resendRow}>
                {countdown > 0 ? (
                  <span>Resend code in {countdown}s</span>
                ) : (
                  <button type="button" className={styles.linkBtn} onClick={() => sendCode()}>
                    Resend code
                  </button>
                )}
              </div>
            </>
          )}

          {/* ── Step 3: Create account ── */}
          {step === 'create' && (
            <>
              <p className={styles.signupSubtext}>
                Creating account for <strong>{email}</strong>
              </p>

              <label className={styles.fieldLabel}>Login name *</label>
              <input
                className={styles.fieldInput}
                type="text"
                placeholder="2-20 characters, letters & numbers"
                maxLength={20}
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(''); }}
                autoFocus
              />
              <p className={styles.fieldHint}>Cannot be all digits</p>

              <label className={styles.fieldLabel}>Password *</label>
              <div className={styles.passwordWrap}>
                <input
                  className={styles.fieldInput}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="8-30 chars, letters & numbers"
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

              <label className={styles.fieldLabel}>Confirm Password *</label>
              <div className={styles.passwordWrap}>
                <input
                  className={styles.fieldInput}
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Enter password again"
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
                    Creating Account...
                  </>
                ) : 'Sign Up'}
              </button>

              <p style={{ fontSize: '0.78rem', color: '#9ca3af', textAlign: 'center', marginTop: '0.75rem' }}>
                By signing up, you agree to our Terms of Use and Privacy Policy
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
  toast,
}: {
  user: AuthUser;
  onSignOut: () => void;
  toast: { show: (t: string) => void };
}) {
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
        toast.show('Meeting is starting! Joining automatically...');
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
      setWarningMessage('Please enter a valid meeting code to join.');
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
        setWarningMessage("Meeting not found. Please use 'Schedule Meeting' to create a new one.");
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

  return (
    <div className={styles.anonWrapper}>
      <TopToolbar 
        user={user} 
        onSignOut={onSignOut} 
        onOpenSettings={() => setShowSettingsModal(true)} 
        onOpenProfile={() => setShowProfileModal(true)}
        hideAvatar={false} 
      />
      

      <div className={styles.dashContainer}>
      {/* New Meeting + Join Meeting row */}
      <div className={styles.dashActions}>
        <button className={styles.newMeetingBtn} onClick={handleNewMeeting}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          New Meeting
        </button>
        <div className={styles.dashJoinRow}>
          <input
            className={styles.dashJoinInput}
            placeholder="Enter meeting code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoinMeeting()}
          />
          <button
            className={styles.dashJoinBtn}
            onClick={handleJoinMeeting}
            disabled={!joinCode.trim()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13.8 12H3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Join Meeting
          </button>
        </div>
      </div>

      {/* Search + Schedule + Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '2rem 0 1rem', paddingBottom: '0.5rem', borderBottom: '1px solid #e5e7eb', flexWrap: 'wrap', gap: '1rem' }}>
        <h3 style={{ fontSize: '1rem', color: '#4b5563', fontWeight: 600, margin: 0 }}>Your past and scheduled meetings</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <input
            className={styles.dashSearchInput}
            placeholder="Search meetings..."
            onChange={() => toast.show('Search coming soon!')}
            style={{ width: '250px', margin: 0 }}
          />
          <button
            className={styles.scheduleBtn}
            onClick={() => setShowScheduleModal(true)}
            style={{ margin: 0 }}
          >
            + Schedule Meeting
          </button>
        </div>
      </div>
      
      {loadingMeetings ? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>Loading meetings...</div>
      ) : dbMeetings.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>No meetings found.</div>
      ) : (
        <div className={styles.dashTableContainer}>
          <table className={styles.dashTable}>
            <thead>
              <tr>
                <th style={{ minWidth: '180px' }}>Meeting Title</th>
                <th style={{ minWidth: '140px' }}>
                  Created <span style={{ fontSize: '10px' }}>▼</span>
                </th>
                <th style={{ minWidth: '180px' }}>
                  Scheduled <span style={{ fontSize: '10px' }}>▼</span>
                </th>
                <th style={{ minWidth: '100px' }}>
                  Actual
                </th>
                <th>Host</th>
                <th>Attendees</th>
                <th>Status</th>
                <th style={{ textAlign: 'left', width: '150px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {dbMeetings.map((m, i) => {
                const d = m.scheduledFor ? new Date(m.scheduledFor) : new Date(m.createdAt);
                const cDate = new Date(m.createdAt);
                const recording = m.recordings?.find((r: any) => r.status === 'READY');
                const processingRecording = !recording && m.recordings?.find((r: any) => ['PROCESSING', 'UPLOADING'].includes(r.status));
                const failedRecording = !recording && !processingRecording && m.recordings?.find((r: any) => r.status === 'FAILED');

                const diffMs = m.scheduledFor ? new Date(m.scheduledFor).getTime() - currentTime : -1;
                const isHost = m.createdByMemberId === user.id;
                const showStart = isHost && m.status !== 'ENDED' && m.status !== 'CANCELED' && !m.isActive && !recording && !processingRecording && !failedRecording && m.scheduledFor;
                
                const showCountdown = m.scheduledFor && m.status !== 'ENDED' && m.status !== 'CANCELED' && !m.isActive && diffMs <= 60 * 60 * 1000 && diffMs >= -15 * 60 * 1000;
                let countdownText = '';
                if (showCountdown) {
                  const absDiff = Math.abs(diffMs);
                  const mm = Math.floor(absDiff / 60000).toString().padStart(2, '0');
                  const ss = Math.floor((absDiff % 60000) / 1000).toString().padStart(2, '0');
                  countdownText = diffMs > 0 ? `Starts in ${mm}:${ss}` : `Overdue by ${mm}:${ss}`;
                }

                let displayStatusText = m.status; // 'ACTIVE', 'ENDED', 'ARCHIVED', 'CANCELED'
                let displayStatusBadge = styles.statusFinished;
                if (m.status === 'ACTIVE') {
                  if (m.isActive) {
                    displayStatusText = 'In Progress';
                    displayStatusBadge = styles.statusInProgress;
                  } else if (m.scheduledFor) {
                    if (diffMs < 0) {
                      displayStatusText = 'Past Due';
                      displayStatusBadge = styles.statusPastDue;
                    } else {
                      displayStatusText = 'Scheduled';
                      displayStatusBadge = styles.statusScheduled;
                    }
                  } else {
                    displayStatusText = 'Created';
                  }
                } else if (m.status === 'ENDED') {
                  displayStatusText = 'Finished';
                } else if (m.status === 'CANCELED') {
                  displayStatusText = 'Canceled';
                  displayStatusBadge = styles.statusCanceled;
                }

                return (
                  <tr key={m.id || i} className={styles.dashTableRow} onDoubleClick={() => setEditingMeeting(m)}>
                    <td>
                      <div className={styles.meetingNameCol}>
                        <div className={styles.meetingAvatar}>
                          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" style={{ color: '#fff' }}>
                            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                          </svg>
                        </div>
                        <span style={{ fontWeight: 500 }}>{m.title || m.roomName || 'Untitled Meeting'}</span>
                      </div>
                    </td>
                    <td>
                      <div>{cDate.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')} {cDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</div>
                      <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '2px' }}>By {m.createdByMember?.username}</div>
                    </td>
                    <td>
                      {m.scheduledFor ? (
                        <div>
                          <div style={{ color: '#111827', fontWeight: 500, fontSize: '0.9rem' }}>
                            {d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                          </div>
                          {m.durationMinutes ? (
                            <div style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: '2px' }}>{m.durationMinutes} mins</div>
                          ) : null}
                        </div>
                      ) : (
                        <div style={{ fontWeight: 500, color: '#4b5563', fontSize: '0.9rem' }}>Instant Meeting</div>
                      )}
                    </td>
                    <td>
                      {m.actualStartedAt || (m.status === 'ENDED' && m.startedAt) || (m.isActive && m.status === 'ACTIVE') ? (
                        <>
                          <div style={{ color: '#111827', fontSize: '0.9rem', fontWeight: 500 }}>
                            {new Date(m.actualStartedAt || m.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                          </div>
                          {m.actualDurationMinutes || (m.status === 'ENDED' && m.durationMinutes) ? (
                            <div style={{ fontSize: '0.85rem', color: '#059669', marginTop: '2px', fontWeight: 600 }}>
                              {m.actualDurationMinutes || m.durationMinutes} mins
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.85rem', color: '#ef4444', marginTop: '2px', fontWeight: 600 }}>
                              {Math.max(1, Math.round((Date.now() - new Date(m.actualStartedAt || m.startedAt).getTime()) / 60000))} mins
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ color: '#9ca3af', fontSize: '0.9rem', fontWeight: 500 }}>-</div>
                      )}
                    </td>
                    <td>{m.createdByMember?.username || 'Unknown'}</td>
                    <td>
                      {m._count?.participants > 0 && (
                        <div className={styles.attendeesBadge}>
                          <div className={styles.attendeeAvatars}>
                            <div className={styles.attendeeAvatarIcon}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                              </svg>
                            </div>
                          </div>
                          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{m._count.participants}</span>
                        </div>
                      )}
                    </td>
                    <td><span className={`${styles.statusBadge} ${displayStatusBadge}`}>{displayStatusText}</span></td>
                    <td>
                      <div className={styles.rowActionsRight}>
                        {isHost && (
                          <button
                            title="Edit Meeting"
                            className={`${styles.iconBtn} ${styles.hoverAction}`}
                            onClick={() => setEditingMeeting(m)}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        )}
                        {showStart && (
                          <button
                            title="Start Meeting"
                            className={`${styles.startActionBtn} ${styles.hoverAction}`}
                            onClick={() => {
                              const diff = new Date(m.scheduledFor).getTime() - Date.now();
                              if (Math.abs(diff) > 15 * 60 * 1000) {
                                setEarlyStartMeeting(m);
                              } else {
                                router.push(`/rooms/${m.roomName}?action=start`);
                              }
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                            Start
                          </button>
                        )}
                        
                        {recording ? (
                          <button 
                            onClick={() => window.open(`/recordings/${recording.id}`, '_blank')}
                            style={{ 
                              background: '#e8f0fe', 
                              color: '#0b57d0', 
                              border: 'none', 
                              padding: '6px 12px', 
                              borderRadius: '100px',
                              fontSize: '13px',
                              fontWeight: 500,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px'
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                            Play
                          </button>
                        ) : processingRecording ? (
                          <div style={{ 
                            padding: '8px 16px', 
                            fontSize: '13px', 
                            color: '#6b7280', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '6px',
                            background: '#f3f4f6',
                            borderRadius: '100px',
                            fontWeight: 500
                          }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                              <circle cx="12" cy="12" r="10"></circle>
                              <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            Processing
                          </div>
                        ) : failedRecording ? (
                          <div style={{ 
                            padding: '8px 16px', 
                            fontSize: '13px', 
                            color: '#dc2626', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '6px',
                            background: '#fef2f2',
                            borderRadius: '100px',
                            fontWeight: 500
                          }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                              <circle cx="12" cy="12" r="10"></circle>
                              <line x1="12" y1="8" x2="12" y2="12"></line>
                              <line x1="12" y1="16" x2="12.01" y2="16"></line>
                            </svg>
                            Failed
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          
          <div className={styles.paginationFooter}>
            <div className={styles.paginationLeft}>
              <select 
                className={styles.pageSizeSelect} 
                value={pageSize} 
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={15}>15 / Page</option>
                <option value={25}>25 / Page</option>
                <option value={50}>50 / Page</option>
                <option value={100}>100 / Page</option>
              </select>
              <span className={styles.totalFiles}>{totalMeetings} Total Files</span>
            </div>
            <div className={styles.paginationRight}>
              <button 
                className={styles.pageArrow} 
                disabled={page <= 1} 
                onClick={() => setPage(typeof page === 'number' ? Math.max(1, page - 1) : 1)}
              >
                &lt;
              </button>
              {(() => {
                const totalPages = Math.ceil(totalMeetings / pageSize) || 1;
                const pages = [];
                for (let i = 1; i <= Math.min(4, totalPages); i++) {
                  pages.push(
                    <button 
                      key={i} 
                      className={page === i ? styles.pageNumActive : styles.pageNum}
                      onClick={() => setPage(i)}
                    >
                      {i}
                    </button>
                  );
                }
                return pages;
              })()}
              <button 
                className={styles.pageArrow} 
                disabled={page >= Math.ceil(totalMeetings / pageSize)} 
                onClick={() => setPage(typeof page === 'number' ? Math.min(Math.ceil(totalMeetings / pageSize), page + 1) : 1)}
              >
                &gt;
              </button>
            </div>
          </div>
        </div>
      )}

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
                  <h2 style={{ fontSize: '3.5rem', margin: '0.5rem 0', color: '#7c3aed', fontFamily: 'monospace', fontWeight: 700 }}>{countdown}</h2>
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
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════
   View 4 – Forgot Password
   ════════════════════════════════════════════════════ */
function ForgotPasswordView({
  onBack,
  toast,
}: {
  onBack: () => void;
  toast: { show: (t: string) => void };
}) {
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
    const t = email.trim();
    if (!t) { setError('Please enter your email or phone'); return false; }
    setLoading(true);
    setError('');
    try {
      const isPhone = t.startsWith('+');
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: t, type: isPhone ? 1 : 0, intent: 'reset' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to send code');
        return false;
      }
      if (data.code) setDevCode(data.code);
      return true;
    } catch {
      setError('Network error.');
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
    if (verificationCode.length !== 6) { setError('Please enter the 6-digit code'); return; }
    setError('');
    setStep('reset');
  };

  const handleReset = async () => {
    setError('');
    const passwordRe = /^(?![0-9]+$)(?![a-zA-Z]+$)[0-9A-Za-z]{8,30}$/;
    if (!passwordRe.test(password)) {
      setError('Password: 8-30 chars with both letters and numbers');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
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
        setError(data.error || 'Reset failed');
        return;
      }
      toast.show('Password reset successfully!');
      onBack();
    } catch {
      setError('Network error. Please try again.');
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
          <h1 className={styles.loginTitle}>Forgot Password</h1>
          {error && <div className={styles.errorBanner}>⚠ {error}</div>}

          {step === 'email' && (
            <>
              <p className={styles.signupSubtext}>Enter your email or phone to reset your password.</p>
              <label className={styles.fieldLabel}>Email or phone</label>
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
                {loading ? 'Sending code...' : 'Next'}
              </button>
            </>
          )}

          {step === 'verify' && (
            <>
              <p className={styles.signupSubtext}>We sent a code to <strong>{email}</strong></p>
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
              {devCode && <div className={styles.devHint}>Dev mode code: <strong>{devCode}</strong></div>}
              <button
                type="button"
                className={verificationCode.length === 6 ? styles.loginSubmit : styles.loginSubmitLoading}
                disabled={verificationCode.length !== 6}
                onClick={handleVerifyNext}
              >
                Verify Code
              </button>
            </>
          )}

          {step === 'reset' && (
            <>
              <label className={styles.fieldLabel}>New Password</label>
              <div className={styles.passwordWrap}>
                <input
                  className={styles.fieldInput}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="8-30 chars, letters & numbers"
                  maxLength={30}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  style={{ paddingRight: '2.5rem' }}
                />
                <button type="button" className={styles.passwordToggle} onClick={() => setShowPassword(!showPassword)}>{showPassword ? '🙈' : '👁'}</button>
              </div>

              <label className={styles.fieldLabel}>Confirm New Password</label>
              <div className={styles.passwordWrap}>
                <input
                  className={styles.fieldInput}
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Enter password again"
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
                {loading ? 'Resetting...' : 'Reset Password'}
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
        <AnonymousView onSignIn={() => setView('login')} onSignUp={() => { setSignupSource('anonymous'); setView('signup'); }} toast={toast} />
      )}
      {view === 'login' && (
        <LoginView
          onBack={() => setView('anonymous')}
          onLoginSuccess={handleAuthSuccess}
          onSignUp={() => { setSignupSource('login'); setView('signup'); }}
          onForgotPassword={() => setView('forgot-password')}
          toast={toast}
        />
      )}
      {view === 'forgot-password' && (
        <ForgotPasswordView
          onBack={() => setView('login')}
          toast={toast}
        />
      )}
      {view === 'signup' && (
        <SignupView
          onBack={() => setView(signupSource)}
          onSignupSuccess={handleAuthSuccess}
          toast={toast}
        />
      )}
      {view === 'dashboard' && user && (
        <DashboardView user={user} onSignOut={handleSignOut} toast={toast} />
      )}
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
