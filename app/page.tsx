'use client';

import { useRouter } from 'next/navigation';
import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { generateRoomId } from '@/lib/client-utils';
import styles from '../styles/Home.module.css';

/* ────────── Types ────────── */
type PageView = 'anonymous' | 'login' | 'signup' | 'dashboard';
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
function KloudLogo({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
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
   View 1 – Anonymous Join
   ════════════════════════════════════════════════════ */
function AnonymousView({
  onSignIn,
  toast,
}: {
  onSignIn: () => void;
  toast: { show: (t: string) => void };
}) {
  const router = useRouter();
  const [code, setCode] = useState('');

  const handleJoin = () => {
    const raw = code.trim();
    if (!raw) {
      router.push(`/rooms/${generateRoomId()}`);
      return;
    }

    // Parse input for any 9-character room ID matching xxxx-xxxx pattern
    const match = raw.match(/[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}/);
    if (!match) {
      toast.show('Please enter a valid 9-character meeting code');
      return;
    }
    
    const roomId = match[0].toLowerCase();
    
    // Preserve query string if they pasted a full URL with ?action=...
    let query = '';
    if (raw.includes('?')) {
      query = raw.substring(raw.indexOf('?'));
    }

    router.push(`/rooms/${roomId}${query}`);
  };

  return (
    <div className={styles.anonContainer}>
      <div className={styles.anonHeader}>
        <KloudLogo />
        <button className={styles.signInBtn} onClick={onSignIn}>
          Sign In
        </button>
      </div>

      <h1 className={styles.anonTitle}>Join Meeting</h1>
      <p className={styles.anonSubtitle}>
        Enter a meeting code below or start a quick meeting
      </p>

      <div className={styles.joinRow}>
        <input
          className={styles.joinInput}
          placeholder="Enter meeting code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
        />
        <button className={styles.joinBtn} onClick={handleJoin}>
          Join
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
            <div>
              <div className={styles.recentCardDate}>{m.date}</div>
              <div className={styles.recentCardTime}>{m.start}</div>
            </div>
            <div className={styles.recentCardName}>{m.host}</div>
            <div className={styles.recentCardTime}>{m.end}</div>
          </div>
        ))}
      </div>
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
  toast,
}: {
  onBack: () => void;
  onLoginSuccess: (user: AuthUser) => void;
  onSignUp: () => void;
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
    <div className={styles.loginContainer}>
      {/* Left brand panel */}
      <div className={styles.loginBrand}>
        <div className={styles.loginBrandLogo}>
          <KloudLogo size="lg" />
        </div>
        <p className={styles.loginBrandTagline}>
          Where your team, customer and AI digital human meet and collaborate
        </p>
      </div>

      {/* Right form */}
      <div className={styles.loginForm}>
        <form className={styles.loginFormInner} onSubmit={handleLogin}>
          <h1 className={styles.loginTitle}>Login</h1>

          {error && <div className={styles.errorBanner}>⚠ {error}</div>}

          <label className={styles.fieldLabel}>Email or login name</label>
          <input
            className={styles.fieldInput}
            type="text"
            placeholder="Email or login name"
            value={identifier}
            onChange={(e) => { setIdentifier(e.target.value); setError(''); }}
            autoFocus
          />

          <label className={styles.fieldLabel}>Password</label>
          <div className={styles.passwordWrap}>
            <input
              className={styles.fieldInput}
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
              onClick={() => toast.show('Forgot password coming soon!')}
            >
              Forgot password
            </button>
          </div>

          <button
            type="submit"
            className={loading ? styles.loginSubmitLoading : styles.loginSubmit}
            disabled={loading}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>

          <div className={styles.registerRow}>
            <span>Not registered?</span>
            <button type="button" className={styles.linkBtn} onClick={onSignUp}>
              Register now
            </button>
          </div>

          <button type="button" className={styles.anonLink} onClick={onBack}>
            Join meeting anonymously
          </button>
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
    <div className={styles.loginContainer}>
      {/* Left brand panel */}
      <div className={styles.loginBrand}>
        <div className={styles.loginBrandLogo}>
          <KloudLogo size="lg" />
        </div>
        <p className={styles.loginBrandTagline}>
          Where your team, customer and AI digital human meet and collaborate
        </p>
      </div>

      {/* Right form */}
      <div className={styles.loginForm}>
        <div className={styles.loginFormInner}>
          <button type="button" className={styles.signupBackBtn} onClick={handleBack}>
            ← Back
          </button>

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
                className={styles.fieldInput}
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
                {loading ? 'Sending code...' : 'Next'}
              </button>

              <div className={styles.registerRow}>
                <span>Already a registered user?</span>
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
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>

              <p style={{ fontSize: '0.78rem', color: '#9ca3af', textAlign: 'center', marginTop: '0.5rem' }}>
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
  const [activeTab, setActiveTab] = useState<'scheduled' | 'recent'>('scheduled');
  
  const [isJoining, setIsJoining] = useState(false);
  const [scheduledModalData, setScheduledModalData] = useState<any>(null);
  const [countdown, setCountdown] = useState<string | null>(null);

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
    if (!joinCode.trim() || isJoining) return;
    
    // Parse input for any 9-character room ID matching xxxx-xxxx pattern
    const match = joinCode.trim().match(/[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}/);
    if (!match) {
      toast.show('Please enter a valid 9-character meeting code');
      return;
    }
    const roomId = match[0].toLowerCase();
    setIsJoining(true);

    try {
      const res = await fetch(`/api/meetings/${roomId}`);
      if (!res.ok) {
        router.push(`/rooms/${roomId}?action=join`);
        setIsJoining(false);
        return;
      }
      
      const data = await res.json();
      
      // If active, route immediately
      if (data.isActive) {
        router.push(`/rooms/${roomId}?action=join`);
        return;
      }

      // If scheduled in the future, show modal
      if (data.scheduledFor) {
        const diffMs = new Date(data.scheduledFor).getTime() - Date.now();
        if (diffMs > 0) {
          setScheduledModalData(data);
          setIsJoining(false);
          return;
        }
      }
      
      // Default fallback
      router.push(`/rooms/${roomId}?action=join`);
    } catch(e) {
      console.error(e);
      router.push(`/rooms/${roomId}?action=join`);
    }
  };

  const today = new Date();
  const dateStr = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
  const meetings = activeTab === 'scheduled' ? MOCK_SCHEDULED : MOCK_RECENT;

  return (
    <div className={styles.dashContainer}>
      <div className={styles.dashHeader}>
        <h1 className={styles.dashUser}>Signed in as {user.displayName}</h1>
        <p className={styles.dashOrg}>@ Kloud Corporation</p>
        <button className={styles.dashSignOut} onClick={onSignOut}>
          Sign Out
        </button>
      </div>

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

      {/* Date + Search + Schedule */}
      <div className={styles.dashInfoRow}>
        <div>
          <div className={styles.dashDate}>{dateStr}</div>
          <div className={styles.dashDateSub}>Your meetings for today</div>
        </div>
        <input
          className={styles.dashSearchInput}
          placeholder="Search"
          onChange={() => toast.show('Search coming soon!')}
        />
        <button
          className={styles.scheduleBtn}
          onClick={() => toast.show('Schedule meeting coming soon!')}
        >
          + Schedule Meeting
        </button>
      </div>

      {/* Tabs */}
      <div className={styles.tabBar}>
        <button
          className={activeTab === 'scheduled' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('scheduled')}
        >
          Scheduled Meeting
        </button>
        <button
          className={activeTab === 'recent' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('recent')}
        >
          Recent Meeting
        </button>
      </div>

      {/* Meeting list */}
      {meetings.map((m, i) => (
        <div
          key={i}
          className={styles.recentCard}
          onClick={() => toast.show('Meeting details coming soon!')}
        >
          <div>
            <div className={styles.recentCardDate}>{m.date}</div>
            <div className={styles.recentCardTime}>{m.start}</div>
          </div>
          <div className={styles.recentCardName}>{m.host}</div>
          <div className={styles.recentCardTime}>{m.end}</div>
        </div>
      ))}

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
                    setScheduledModalData(null);
                    router.push(`/rooms/${scheduledModalData.roomName}?action=join`);
                  }} 
                  className={styles.dashJoinBtn} 
                  style={{ flex: 1, padding: '0.75rem', borderRadius: '12px', width: 'auto' }}
                  disabled={new Date(scheduledModalData.scheduledFor).getTime() - Date.now() > 0}
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
   Main Page (state machine)
   ════════════════════════════════════════════════════ */
function HomeContent() {
  const [view, setView] = useState<PageView>('anonymous');
  const [user, setUser] = useState<AuthUser | null>(null);
  const toast = useToast();

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
        <AnonymousView onSignIn={() => setView('login')} toast={toast} />
      )}
      {view === 'login' && (
        <LoginView
          onBack={() => setView('anonymous')}
          onLoginSuccess={handleAuthSuccess}
          onSignUp={() => setView('signup')}
          toast={toast}
        />
      )}
      {view === 'signup' && (
        <SignupView
          onBack={() => setView('login')}
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
