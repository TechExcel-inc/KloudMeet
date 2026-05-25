'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { generateRoomId } from '@/lib/client-utils';
import { ScheduleMeetingModal } from '@/lib/ScheduleMeetingModal';
import { SystemSettingsModal } from '@/lib/SystemSettingsModal';
import { MyProfileModal } from '@/lib/MyProfileModal';
import { useI18n } from '@/lib/i18n';
import { HelpModal } from '@/lib/HelpModal';
import { useDesktopAppLaunch } from '@/lib/useDesktopAppLaunch';
import { handleKloudSessionExpired } from '@/lib/handleKloudSessionExpired';
import { authFetch, authHeaders } from '@/lib/kloudSession';
import styles from '../../../styles/Home.module.css';
import type { AuthUser, SignupStep } from '../types';
import { KloudLogo } from '../components/KloudLogo';
import { TopToolbar } from '../components/TopToolbar';
import { MOCK_RECENT, MOCK_SCHEDULED } from '../mockData';

export function AnonymousView({
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
      const res = await fetch(`/api/meetings/${encodeURIComponent(roomId)}`);
      
      // 1. Non-Existing
      if (!res.ok) {
        setWarningMessage(t('anon.meetingNotFound'));
        setIsJoining(false);
        return;
      }
      
      const data = await res.json();
      
      // 2. Already Finished
      if (data.status === 'ENDED' && !data.isPersonalRoom) {
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

      <div className={styles.anonContainer}>
        <h1 className={styles.anonTitle}>{t('anon.joinMeeting')}</h1>
        <p className={styles.anonSubtitle}>
          {t('anon.hostPrivilege')}
        </p>

        <div className={styles.anonActionCard}>
          <div className={styles.anonJoinGroup}>
            <input
              className={styles.anonJoinInput}
              placeholder={t('anon.enterMeetingCode')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
            <button
              type="button"
              className={styles.anonJoinBtn}
              onClick={handleJoin}
              disabled={isJoining}
              aria-busy={isJoining}
            >
              {isJoining ? t('common.joining') : t('common.join')}
            </button>
          </div>
          <button type="button" className={styles.anonSignInBtn} onClick={onSignIn}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden>
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('nav.signIn')}
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

      </div>

      <div className={styles.registerRow} style={{ marginTop: 'auto', marginBottom: '1rem', width: '100%', textAlign: 'center' }}>
        <span>{t('anon.noAccount')}</span>
        <button type="button" className={styles.linkBtn} onClick={onSignUp} style={{ marginLeft: '0.5rem' }}>
          {t('nav.signUp')}
        </button>
      </div>

      {/* Download Desktop App - hidden on mobile */}
      <div className={`${styles.downloadRow} ${styles.mobileHidden}`} style={{ gap: '0.75rem', flexWrap: 'wrap', margin: '0 auto 0 auto', paddingBottom: '2rem', justifyContent: 'center', width: '100%' }}>
        <a
          href="/api/download?os=win"
          className={styles.downloadBtn}
          id="download-desktop-app-btn"
          title="Download Kloud Meet for Windows"
        >
          {/* Windows Logo */}
          <svg className={styles.downloadBtnIcon} viewBox="0 0 24 24" width="16" height="16" fill="#5227D3">
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
            <circle cx="12" cy="12" r="12" fill="#5227D3" />
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

      {/* Warning Message Overlay */}
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

      {/* Scheduled Meeting Overlay */}
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
                  <h2 style={{ fontSize: '3.5rem', margin: '0.5rem 0', color: '#5227D3', fontFamily: 'monospace', fontWeight: 700 }}>{countdown}</h2>
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

