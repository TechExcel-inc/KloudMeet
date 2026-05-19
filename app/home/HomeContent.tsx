'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HelpModal } from '@/lib/HelpModal';
import { useDesktopAppLaunch } from '@/lib/useDesktopAppLaunch';
import { handleKloudSessionExpired } from '@/lib/handleKloudSessionExpired';
import { consumeMeetingClosedNotice } from '@/lib/meetingClosedNotice';
import styles from '../../styles/Home.module.css';
import type { AuthUser, PageView } from './types';
import { useToast } from './components/useToast';
import { AnonymousView } from './views/AnonymousView';
import { LoginView } from './views/LoginView';
import { SignupView } from './views/SignupView';
import { DashboardView } from './views/DashboardView';
import { ForgotPasswordView } from './views/ForgotPasswordView';

export function HomeContent() {
  const { openDesktopEntry, desktopLaunchModal } = useDesktopAppLaunch();
  const [view, setView] = useState<PageView>('anonymous');
  const [signupSource, setSignupSource] = useState<PageView>('login');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const toast = useToast();
  const searchParams = useSearchParams();

  useEffect(() => {
    const notice = consumeMeetingClosedNotice();
    if (notice) toast.show(notice);
  }, [toast]);

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
      .then(async (res) => {
        if (res.status === 401) {
          handleKloudSessionExpired();
          return null;
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { __ssoError: (err as { error?: string }).error || 'Failed to get profile' };
        }
        return res.json();
      })
      .then(data => {
        if (data === null) return;
        if (data && typeof data === 'object' && '__ssoError' in data) {
          toast.show((data as { __ssoError: string }).__ssoError);
          return;
        }
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

  // Restore session from localStorage — validate token with /api/auth/profile
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = localStorage.getItem('kloudUser');
        if (!stored) return;
        const parsed = JSON.parse(stored) as AuthUser;
        if (!parsed?.token) {
          if (!cancelled) {
            setUser(parsed);
            setView('dashboard');
          }
          return;
        }
        const res = await fetch('/api/auth/profile', {
          headers: { Authorization: `Bearer ${parsed.token}` },
        });
        if (cancelled) return;
        if (res.status === 401) {
          handleKloudSessionExpired();
          return;
        }
        if (!res.ok) {
          setUser(parsed);
          setView('dashboard');
          return;
        }
        const data = await res.json().catch(() => null);
        if (!data || typeof data !== 'object' || !data.id) {
          setUser(parsed);
          setView('dashboard');
          return;
        }
        const u: AuthUser = {
          id: data.id,
          username: data.username,
          displayName: data.fullName || data.username,
          email: data.email,
          avatarUrl: data.avatarUrl,
          token: parsed.token,
        };
        localStorage.setItem('kloudUser', JSON.stringify(u));
        setUser(u);
        setView('dashboard');
      } catch {
        if (!cancelled) {
          try {
            const stored = localStorage.getItem('kloudUser');
            if (stored) {
              setUser(JSON.parse(stored) as AuthUser);
              setView('dashboard');
            }
          } catch {
            /* ignore */
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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
        <DashboardView
          user={user}
          onSignOut={handleSignOut}
          onUpdateUser={setUser}
          onOpenHelp={() => setShowHelp(true)}
          onOpenDesktopApp={() => openDesktopEntry('outsideMeeting')}
          toast={toast}
        />
      )}

      {desktopLaunchModal}
      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </>
  );
}
