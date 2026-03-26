'use client';

import { useRouter } from 'next/navigation';
import React, { Suspense, useEffect, useState } from 'react';
import { generateRoomId } from '@/lib/client-utils';
import styles from '../styles/Home.module.css';

/* ────────── Types ────────── */
type PageView = 'anonymous' | 'login' | 'dashboard';

interface MockUser {
  username: string;
  displayName: string;
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
    const roomId = code.trim() || generateRoomId();
    router.push(`/rooms/${roomId}`);
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
   View 2 – Login
   ════════════════════════════════════════════════════ */
function LoginView({
  onBack,
  onLoginSuccess,
  toast,
}: {
  onBack: () => void;
  onLoginSuccess: (user: MockUser) => void;
  toast: { show: (t: string) => void };
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const name = username.trim() || 'User';
    const user: MockUser = { username: name, displayName: name };
    if (typeof window !== 'undefined') {
      localStorage.setItem('kloudUser', JSON.stringify(user));
    }
    onLoginSuccess(user);
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

          <label className={styles.fieldLabel}>Email or login name</label>
          <input
            className={styles.fieldInput}
            type="text"
            placeholder="Email or login name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />

          <label className={styles.fieldLabel}>Password</label>
          <input
            className={styles.fieldInput}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <div className={styles.forgotRow}>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => toast.show('Forgot password coming soon!')}
            >
              Forgot password
            </button>
          </div>

          <button type="submit" className={styles.loginSubmit}>
            Login
          </button>

          <div className={styles.registerRow}>
            <span>Not registered?</span>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => toast.show('Registration coming soon!')}
            >
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
   View 3 – Dashboard (Signed In)
   ════════════════════════════════════════════════════ */
function DashboardView({
  user,
  onSignOut,
  toast,
}: {
  user: MockUser;
  onSignOut: () => void;
  toast: { show: (t: string) => void };
}) {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');
  const [activeTab, setActiveTab] = useState<'scheduled' | 'recent'>('scheduled');

  const handleNewMeeting = () => {
    router.push(`/rooms/${generateRoomId()}`);
  };

  const handleJoinMeeting = () => {
    if (!joinCode.trim()) return;
    router.push(`/rooms/${joinCode.trim()}`);
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
    </div>
  );
}

/* ════════════════════════════════════════════════════
   Main Page (state machine)
   ════════════════════════════════════════════════════ */
function HomeContent() {
  const [view, setView] = useState<PageView>('anonymous');
  const [user, setUser] = useState<MockUser | null>(null);
  const toast = useToast();

  // Restore session from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('kloudUser');
      if (stored) {
        const parsed = JSON.parse(stored) as MockUser;
        setUser(parsed);
        setView('dashboard');
      }
    } catch {}
  }, []);

  const handleLoginSuccess = (u: MockUser) => {
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
          onLoginSuccess={handleLoginSuccess}
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
