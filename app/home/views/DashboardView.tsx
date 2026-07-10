'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { generateRoomId } from '@/lib/client-utils';
import { ScheduleMeetingModal } from '@/lib/ScheduleMeetingModal';
import { SystemSettingsModal } from '@/lib/SystemSettingsModal';
import { MyProfileModal } from '@/lib/MyProfileModal';
import { useI18n } from '@/lib/i18n';
import { HelpModal } from '@/lib/HelpModal';
import { useDesktopAppLaunch } from '@/lib/useDesktopAppLaunch';
import { handleKloudSessionExpired } from '@/lib/handleKloudSessionExpired';
import { authFetch, authHeaders, getKloudSessionBearer } from '@/lib/kloudSession';
import { ActiveMeetingConflictModal } from '@/lib/ActiveMeetingConflictModal';
import {
  checkMeetingStartGuard,
  endMeetingByHost,
  type ActiveMeetingInfo,
  type MeetingStartIntent,
} from '@/lib/meetingStartGuard';
import styles from '../../../styles/Home.module.css';
import type { AuthUser, SignupStep } from '../types';
import { KloudLogo } from '../components/KloudLogo';
import { TopToolbar } from '../components/TopToolbar';
import { MOCK_RECENT, MOCK_SCHEDULED } from '../mockData';

export function DashboardView({
  user,
  onSignOut,
  onUpdateUser,
  onOpenHelp,
  onOpenDesktopApp,
  toast,
}: {
  user: AuthUser;
  onSignOut: () => void;
  onUpdateUser: (u: AuthUser) => void;
  onOpenHelp: () => void;
  onOpenDesktopApp: () => void;
  toast: { show: (t: string) => void };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<any>(null);
  const [personalRoomId, setPersonalRoomId] = useState<string | null>(null);
  
  const [isJoining, setIsJoining] = useState(false);
  const [isCreatingMeeting, setIsCreatingMeeting] = useState(false);
  const creatingMeetingRef = useRef(false);
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
  // meetingView removed — all meetings shown together
  const [searchQuery, setSearchQuery] = useState('');
  const [inviteMenuRoomName, setInviteMenuRoomName] = useState<string | null>(null);
  const [meetingConflict, setMeetingConflict] = useState<{
    activeMeeting: ActiveMeetingInfo;
    pendingIntent: MeetingStartIntent;
  } | null>(null);
  const [endingActiveMeeting, setEndingActiveMeeting] = useState(false);
  const userToken = user.token;
  const userId = user.id;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!inviteMenuRoomName) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-invite-menu-anchor="true"]')) {
        setInviteMenuRoomName(null);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [inviteMenuRoomName]);

  // Fetch personal room ID from profile
  useEffect(() => {
    if (!userToken) return;
    fetch('/api/account/profile', {
      headers: { Authorization: `Bearer ${userToken}` }
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.personalRoomId) setPersonalRoomId(data.personalRoomId);
      })
      .catch(() => {});
  }, [userToken]);

  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  const fetchMeetings = useCallback((searchTerm?: string) => {
    const term = searchTerm ?? searchQueryRef.current;
    if (!userToken && !userId) return;
    setLoadingMeetings(true);
    const qs = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      ...(term.trim() ? { search: term.trim() } : {}),
    });
    fetch(`/api/account/meetings?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${userToken}` }
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
  }, [userId, userToken, page, pageSize]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  // Debounced search: reset to page 1 and re-fetch when searchQuery changes
  const isFirstSearchRender = React.useRef(true);
  useEffect(() => {
    if (isFirstSearchRender.current) {
      isFirstSearchRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setPage(1);
      fetchMeetings(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchMeetings]);

  // Polling fallback to check processing recordings
  useEffect(() => {
    if (!userToken) return;
    
    // Check if any meetings in the current list have a PROCESSING/UPLOADING recording
    const hasProcessing = dbMeetings.some(m => 
      m.recordings?.some((r: any) => ['PROCESSING', 'UPLOADING'].includes(r.status))
    );

    if (!hasProcessing) return;

    const intervalId = setInterval(() => {
      fetch('/api/account/recordings/sync', {
        headers: { Authorization: `Bearer ${userToken}` }
      })
      .then(res => res.json())
      .then(data => {
        if (data.updatedCount > 0) {
          // Re-fetch meetings silently without setting loading state
            fetch(`/api/account/meetings?page=${page}&pageSize=${pageSize}`, {
              headers: { Authorization: `Bearer ${userToken}` }
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
  }, [userToken, dbMeetings, page, pageSize]);

  useEffect(() => {
    if (!scheduledModalData?.scheduledFor) return;
    const tick = () => {
      const target = new Date(scheduledModalData.scheduledFor).getTime();
      const diffMs = target - Date.now();
      if (diffMs <= 0) {
        setCountdown("00:00");
        toast.show(t('dash.meetingStarting'));
        router.push(`/rooms/${scheduledModalData.roomName}`);
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
  }, [scheduledModalData, router, userId, toast, t]);

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

  const formatInviteWhen = (meeting: any): string => {
    if (!meeting?.scheduledFor) return 'To be announced';
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: meeting.timezone || undefined,
      }).format(new Date(meeting.scheduledFor));
    } catch {
      return new Date(meeting.scheduledFor).toLocaleString();
    }
  };

  const copyMeetingLink = (meeting: any) => {
    const link = `${window.location.origin}/?code=${meeting.roomName}`;
    navigator.clipboard?.writeText(link);
    toast.show('Meeting link copied!');
    setInviteMenuRoomName(null);
  };

  const copyMeetingInvite = (meeting: any) => {
    const link = `${window.location.origin}/?code=${meeting.roomName}`;
    const hostName =
      meeting?.createdByMember?.fullName ||
      meeting?.createdByMember?.username ||
      user?.displayName ||
      user?.username ||
      'Host';
    const description = typeof meeting?.description === 'string' ? meeting.description.trim() : '';
    const inviteText = [
      `You are invited to a Kloud Meeting`,
      '',
      `${meeting.title || meeting.roomName || 'Untitled Meeting'}`,
      `Host: ${hostName}`,
      `When: ${formatInviteWhen(meeting)}`,
      meeting?.timezone ? `Time Zone: ${meeting.timezone}` : '',
      meeting?.durationMinutes ? `Duration: ${meeting.durationMinutes} minutes` : '',
      description ? `Description: ${description}` : '',
      `Meeting ID: ${meeting.roomName}`,
      `Join meeting: ${link}`,
      '',
      'Please join a few minutes early to test your audio and video setup.',
    ]
      .filter(Boolean)
      .join('\n');
    navigator.clipboard?.writeText(inviteText);
    toast.show('Invite copied!');
    setInviteMenuRoomName(null);
  };

  const executeMeetingIntent = useCallback(
    async (intent: MeetingStartIntent) => {
      if (intent.type === 'personalRoom') {
        router.push(`/rooms/${intent.roomName}`);
        return;
      }
      if (intent.type === 'startScheduled') {
        router.push(`/rooms/${intent.roomName}`);
        return;
      }

      if (creatingMeetingRef.current || isCreatingMeeting) return;
      creatingMeetingRef.current = true;
      setIsCreatingMeeting(true);

      const roomId = generateRoomId();
      try {
        if (userToken) {
          const res = await authFetch('/api/meetings', {
            method: 'POST',
            headers: authHeaders({
              'Content-Type': 'application/json',
              Authorization: `Bearer ${userToken}`,
            }),
            body: JSON.stringify({ roomName: roomId }),
          });
          if (!res.ok) {
            toast.show(t('dash.networkError'));
            creatingMeetingRef.current = false;
            setIsCreatingMeeting(false);
            return;
          }
        }
        router.push(`/rooms/${roomId}`);
      } catch (e) {
        console.error('Failed to register meeting:', e);
        toast.show(t('dash.networkError'));
        creatingMeetingRef.current = false;
        setIsCreatingMeeting(false);
      }
    },
    [isCreatingMeeting, router, t, toast, userToken],
  );

  const runMeetingStartGuard = useCallback(
    async (intent: MeetingStartIntent): Promise<boolean> => {
      const token = userToken ?? getKloudSessionBearer();
      if (!token) {
        await executeMeetingIntent(intent);
        return true;
      }
      try {
        const result = await checkMeetingStartGuard(token, intent);
        if (result.action === 'redirect') {
          if (result.meetingId) {
            try {
              localStorage.setItem('activeMeetingId', String(result.meetingId));
            } catch {
              /* ignore */
            }
          }
          router.push(`/rooms/${result.roomName}`);
          return true;
        }
        if (result.action === 'conflict') {
          setMeetingConflict({
            activeMeeting: result.activeMeeting,
            pendingIntent: result.pendingIntent,
          });
          return false;
        }
        await executeMeetingIntent(intent);
        return true;
      } catch (e) {
        console.error('[meetingStartGuard]', e);
        toast.show(t('dash.networkError'));
        return false;
      }
    },
    [executeMeetingIntent, router, t, toast, userToken],
  );

  const handleNewMeeting = () => {
    void runMeetingStartGuard({ type: 'newMeeting' });
  };

  const handleMyRoomClick = () => {
    if (!personalRoomId) return;
    void runMeetingStartGuard({ type: 'personalRoom', roomName: personalRoomId });
  };

  const handleStartMeetingClick = (m: { roomName: string; scheduledFor?: string | null }) => {
    const intent: MeetingStartIntent = {
      type: 'startScheduled',
      roomName: m.roomName,
    };

    void (async () => {
      if (m.scheduledFor) {
        const diff = new Date(m.scheduledFor).getTime() - Date.now();
        if (Math.abs(diff) > 15 * 60 * 1000) {
          setEarlyStartMeeting(m);
          return;
        }
      }
      await runMeetingStartGuard(intent);
    })();
  };

  const handleConflictContinue = () => {
    if (!meetingConflict) return;
    const { roomName, id } = meetingConflict.activeMeeting;
    setMeetingConflict(null);
    try {
      if (id) localStorage.setItem('activeMeetingId', String(id));
    } catch {
      /* ignore */
    }
    router.push(`/rooms/${roomName}`);
  };

  const handleConflictStartNew = async () => {
    if (!meetingConflict) return;
    const token = user?.token ?? getKloudSessionBearer();
    if (!token) return;
    setEndingActiveMeeting(true);
    const { activeMeeting, pendingIntent } = meetingConflict;
    const ok = await endMeetingByHost(token, activeMeeting.roomName);
    if (!ok) {
      toast.show(t('dash.conflict.endFailed'));
      setEndingActiveMeeting(false);
      return;
    }
    try {
      localStorage.removeItem('activeMeetingId');
      localStorage.removeItem('activeMeetingStartedAt');
    } catch {
      /* ignore */
    }
    setMeetingConflict(null);
    setEndingActiveMeeting(false);
    fetchMeetings();

    if (pendingIntent.type === 'startScheduled') {
      const meeting =
        dbMeetings.find((x) => x.roomName === pendingIntent.roomName) ?? {
          roomName: pendingIntent.roomName,
        };
      if (meeting.scheduledFor) {
        const diff = new Date(meeting.scheduledFor).getTime() - Date.now();
        if (Math.abs(diff) > 15 * 60 * 1000) {
          setEarlyStartMeeting(meeting);
          return;
        }
      }
    }
    await executeMeetingIntent(pendingIntent);
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
      const res = await fetch(`/api/meetings/${encodeURIComponent(roomId)}`, {
        headers: authHeaders(),
      });
      
      // 1. Non-Existing
      if (!res.ok) {
        setWarningMessage(t('dash.meetingNotFoundDash'));
        setIsJoining(false);
        return;
      }
      
      const data = await res.json();
      // 2. Already Finished（专属会议室归档后仍可由主持人再开新场）
      if (data.status === 'ENDED' && !data.isPersonalRoom) {
        setWarningMessage('This meeting has already ended and is no longer available.');
        setIsJoining(false);
        return;
      }
      
      // 6. Already In Progress
      if (data.isActive) {
        router.push(`/rooms/${roomId}`);
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
          router.push(`/rooms/${roomId}`);
          return;
        }
      }
      
      // Valid routing
      router.push(`/rooms/${roomId}`);
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

  const filteredMeetings = dbMeetings.slice();

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
        onOpenDesktopApp={onOpenDesktopApp}
        hideAvatar={false} 
      />

      <div className={styles.dashboardTopTaglineWrap}>
        <p className={styles.dashboardTopTagline}>{t('dash.meetingListTagline')}</p>
      </div>

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
            <div className={styles.quickActionsSecondary}>
              {/* {personalRoomId && (
                <button
                  type="button"
                  className={styles.quickPersonalRoomBtn}
                  onClick={handleMyRoomClick}
                  title={`${t('dash.myRoom')}: ${personalRoomId}`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points="9 22 9 12 15 12 15 22" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t('dash.myRoom')}
                </button>
              )} */}
              <button
                type="button"
                className={styles.quickNewBtn}
                onClick={handleNewMeeting}
                disabled={isCreatingMeeting}
                aria-busy={isCreatingMeeting}
                style={
                  isCreatingMeeting
                    ? { opacity: 0.7, cursor: 'not-allowed', pointerEvents: 'none' }
                    : undefined
                }
              >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden>
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {isCreatingMeeting ? t('common.loading') : t('dash.newMeeting')}
            </button>
            </div>
          </div>
        </div>

        {/* ── Meeting List Header ── */}
        <div className={styles.meetingListHeader}>
          {/* Title */}
          <div className={styles.meetingListTitleRow}>
            <h1 className={styles.meetingListTitle}>{t('dash.yourMeetings')}</h1>
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
              title={t('dash.scheduleMeeting')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>

        </div>
      </div>
      <div className={styles.dashContainer}>

        {/* ── Meeting Cards ── */}
        {loadingMeetings ? (
          <div className={styles.meetingLoadingState}>
            <div className={styles.meetingLoadingSpinner} />
            <p className={styles.meetingLoadingTitle}>{t('dash.loadingMeetings')}</p>
          </div>
        ) : Object.keys(groupedMeetings).length === 0 ? (
          <div className={styles.meetingEmptyState}>
            <Image
              src="/images/kloud-header-logo.svg"
              alt="Kloud Meet"
              className={styles.meetingEmptyLogo}
              width={120}
              height={36}
              style={{ display: 'block', transform: 'translateY(4px)' }}
            />
            <p className={styles.meetingEmptyTitle}>{t('dash.noMeetings')}</p>
            <p className={styles.meetingEmptyText}>{t('dash.emptyMeetingsHint')}</p>
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
                        className={`${isLive ? styles.meetingCardLive : styles.meetingCard}${
                          inviteMenuRoomName === m.roomName ? ` ${styles.meetingCardInviteMenuOpen}` : ''
                        }`}
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
                                onClick={() => router.push(`/rooms/${m.roomName}`)}
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
                                title={t('dash.replayTitle')}
                              >
                                <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M8 5v14l11-7z" /></svg>
                                {t('dash.replay')}
                              </button>
                            )}
                            {processingRecording && (
                              <div className={styles.recordingProcessing}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                {t('common.processing')}
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
                                    if (isHost) {
                                      handleStartMeetingClick(m);
                                    } else {
                                      router.push(`/rooms/${m.roomName}`);
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
                                <div data-invite-menu-anchor="true" style={{ position: 'relative' }}>
                                  <button
                                    title="Copy meeting invite"
                                    className={styles.iconBtn}
                                    onClick={() =>
                                      setInviteMenuRoomName((prev) => (prev === m.roomName ? null : m.roomName))
                                    }
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round"/>
                                      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  </button>
                                  {inviteMenuRoomName === m.roomName && (
                                    <div
                                      style={{
                                        position: 'absolute',
                                        top: 'calc(100% + 8px)',
                                        right: 0,
                                        minWidth: '170px',
                                        background: '#fff',
                                        border: '1px solid #e5e7eb',
                                        borderRadius: '8px',
                                        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.15)',
                                        zIndex: 60,
                                        padding: '6px',
                                      }}
                                    >
                                      <button
                                        type="button"
                                        className={styles.dropdownItem}
                                        onClick={() => copyMeetingLink(m)}
                                        style={{ borderRadius: '6px', padding: '8px 10px' }}
                                      >
                                        Copy Link
                                      </button>
                                      <button
                                        type="button"
                                        className={styles.dropdownItem}
                                        onClick={() => copyMeetingInvite(m)}
                                        style={{ borderRadius: '6px', padding: '8px 10px' }}
                                      >
                                        Copy Invite
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* 🎬 Replay 摘要 — 已结束且有录制的会议 */}
                              {recording && m.status === 'ENDED' && (
                                <button
                                  title={t('dash.replaySummaryTitle')}
                                  className={styles.iconBtn}
                                  style={{ color: '#818cf8' }}
                                  onClick={() => window.open(`/recordings/${recording.id}`, '_blank')}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                                    <polyline points="10 8 16 12 10 16"/>
                                  </svg>
                                </button>
                              )}

                              {m.status === 'ENDED' && (
                                <button
                                  title={t('chatHistory.open')}
                                  className={styles.iconBtn}
                                  onClick={() => router.push(`/meeting/${m.id}/chat`)}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                    <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" strokeLinecap="round" strokeLinejoin="round"/>
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

                          {/* ── Mobile-only bottom action bar ── */}
                          <div className={styles.meetingCardMobileActions}>
                            {/* Join / Start button */}
                            {!isLive && m.status !== 'ENDED' && m.status !== 'CANCELED' && (
                              <button
                                className={isHost && !m.isActive && m.scheduledFor ? styles.mobileStartBtn : styles.mobileJoinBtn}
                                onClick={() => {
                                  if (isHost) {
                                    handleStartMeetingClick(m);
                                  } else {
                                    router.push(`/rooms/${m.roomName}`);
                                  }
                                }}
                              >
                                {isHost && !m.isActive ? (
                                  <>
                                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z" /></svg>
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
                              <div data-invite-menu-anchor="true" style={{ position: 'relative' }}>
                                <button
                                  className={styles.mobileCopyBtn}
                                  onClick={() =>
                                    setInviteMenuRoomName((prev) => (prev === m.roomName ? null : m.roomName))
                                  }
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                  Invite
                                </button>
                                {inviteMenuRoomName === m.roomName && (
                                  <div
                                    style={{
                                      position: 'absolute',
                                      top: 'calc(100% + 8px)',
                                      left: 0,
                                      minWidth: '160px',
                                      background: '#fff',
                                      border: '1px solid #e5e7eb',
                                      borderRadius: '8px',
                                      boxShadow: '0 10px 24px rgba(15, 23, 42, 0.15)',
                                      zIndex: 60,
                                      padding: '6px',
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className={styles.dropdownItem}
                                      onClick={() => copyMeetingLink(m)}
                                      style={{ borderRadius: '6px', padding: '8px 10px' }}
                                    >
                                      Copy Link
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.dropdownItem}
                                      onClick={() => copyMeetingInvite(m)}
                                      style={{ borderRadius: '6px', padding: '8px 10px' }}
                                    >
                                      Copy Invite
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                            {m.status === 'ENDED' && (
                              <button
                                className={styles.mobileCopyBtn}
                                onClick={() => router.push(`/meeting/${m.id}/chat`)}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                  <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                {t('chatHistory.shortTitle')}
                              </button>
                            )}
                            {/* Delete */}
                            {isHost && !m.isActive && (
                              <button
                                className={styles.mobileDeleteBtn}
                                onClick={() => setDeletingMeeting(m)}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                  <polyline points="3 6 5 6 21 6" strokeLinecap="round" strokeLinejoin="round"/>
                                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" strokeLinecap="round" strokeLinejoin="round"/>
                                  <path d="M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round"/>
                                  <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                Delete
                              </button>
                            )}
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
                Close
              </button>
              {new Date(scheduledModalData.scheduledFor).getTime() - Date.now() <= 60 * 60 * 1000 && (
                <button 
                  onClick={() => {
                    setScheduledModalData(null);
                    router.push(`/rooms/${scheduledModalData.roomName}`);
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

      {meetingConflict && (
        <ActiveMeetingConflictModal
          activeMeeting={meetingConflict.activeMeeting}
          ending={endingActiveMeeting}
          onContinue={handleConflictContinue}
          onStartNew={() => void handleConflictStartNew()}
          onCancel={() => {
            if (!endingActiveMeeting) setMeetingConflict(null);
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
                onClick={() => {
                  const m = earlyStartMeeting;
                  setEarlyStartMeeting(null);
                  if (m) {
                    void runMeetingStartGuard({
                      type: 'startScheduled',
                      roomName: m.roomName,
                    });
                  }
                }}
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
          onSave={({ personalRoomId: newId, avatarUrl: newAvatar, displayName: newName }) => {
            setPersonalRoomId(newId || null);
            // Update user state so top-right avatar + name refresh immediately
            if (newAvatar || newName) {
              const updated = {
                ...user,
                ...(newAvatar ? { avatarUrl: newAvatar } : {}),
                ...(newName ? { displayName: newName } : {}),
              };
              // Keep localStorage in sync
              try { localStorage.setItem('kloudUser', JSON.stringify(updated)); } catch {}
              onUpdateUser(updated);
            }
          }}
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
