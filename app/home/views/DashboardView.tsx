'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { recordingReplayPath } from '@/lib/recordingReplayPath';
import {
  calendarMenuItems,
  inviteCalendarLines,
  isCalendarEligible,
  toCalendarMeetingFromClient,
} from '@/lib/calendar/menu';
import { ActiveMeetingConflictModal } from '@/lib/ActiveMeetingConflictModal';
import {
  checkMeetingStartGuard,
  endMeetingByHost,
  type ActiveMeetingInfo,
  type MeetingStartIntent,
} from '@/lib/meetingStartGuard';
import { CalendarPlus, Keyboard, Video } from 'lucide-react';
import styles from '../../../styles/Home.module.css';
import type { AuthUser, SignupStep } from '../types';
import { KloudLogo } from '../components/KloudLogo';
import { TopToolbar } from '../components/TopToolbar';
import { useTx } from '../components/ui';

/** How many recent meetings the home page looks at for "Up next" and "Recent replays". */

type MeetingListScope = 'all' | 'hosted';

function meetingsQuery(page: number, size: number, search: string, scope: MeetingListScope): string {
  const qs = new URLSearchParams({
    page: String(page),
    pageSize: String(size),
  });
  const term = search.trim();
  if (term) qs.set('search', term);
  if (scope === 'hosted') qs.set('scope', 'hosted');
  return qs.toString();
}

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
  const { t, locale } = useI18n();
  const tx = useTx();
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
  const [meetingScope, setMeetingScope] = useState<MeetingListScope>('all');
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
  const pageRef = useRef(page);
  pageRef.current = page;
  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;
  const meetingScopeRef = useRef(meetingScope);
  meetingScopeRef.current = meetingScope;
  const meetingsFetchGenRef = useRef(0);
  const prevScopeRef = useRef(meetingScope);

  const fetchMeetings = useCallback((searchTerm?: string, pageOverride?: number) => {
    const term = searchTerm ?? searchQueryRef.current;
    if (!userToken && !userId) return;
    const currentPage = pageOverride ?? pageRef.current;
    const gen = ++meetingsFetchGenRef.current;
    setLoadingMeetings(true);
    const qs = meetingsQuery(currentPage, pageSizeRef.current, term, meetingScopeRef.current);
    fetch(`/api/account/meetings?${qs}`, {
      headers: { Authorization: `Bearer ${userToken}` }
    })
      .then(res => res.json())
      .then(data => {
        if (gen !== meetingsFetchGenRef.current) return;
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
      .finally(() => {
        if (gen === meetingsFetchGenRef.current) setLoadingMeetings(false);
      });
  }, [userId, userToken]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings, page, pageSize]);

  const prevSearchQueryRef = useRef(searchQuery);
  useEffect(() => {
    if (prevSearchQueryRef.current === searchQuery) return;
    prevSearchQueryRef.current = searchQuery;
    const timer = setTimeout(() => {
      if (pageRef.current !== 1) {
        setPage(1);
      } else {
        fetchMeetings(searchQuery, 1);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchMeetings]);

  useEffect(() => {
    if (prevScopeRef.current === meetingScope) return;
    prevScopeRef.current = meetingScope;
    if (pageRef.current !== 1) {
      setPage(1);
      return;
    }
    fetchMeetings(searchQueryRef.current, 1);
  }, [meetingScope, fetchMeetings]);


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
            const qs = meetingsQuery(page, pageSize, searchQueryRef.current, meetingScopeRef.current);
            fetch(`/api/account/meetings?${qs}`, {
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

  // 有 Live 会议时每 30s 静默拉状态，只合并有变化的条目
  const hasLiveMeeting = dbMeetings.some((m) => m.isActive);
  useEffect(() => {
    if (!userToken || !hasLiveMeeting) return;

    const mergeLiveStatus = (prev: any[], freshList: any[]) => {
      const byId = new Map(freshList.map((m) => [m.id, m]));
      let anyChanged = false;
      const next = prev.map((old) => {
        const fresh = byId.get(old.id);
        if (!fresh) return old;
        const same =
          old.status === fresh.status &&
          old.isActive === fresh.isActive &&
          old.isIdle === fresh.isIdle &&
          String(old.endedAt ?? '') === String(fresh.endedAt ?? '') &&
          String(old.actualStartedAt ?? '') === String(fresh.actualStartedAt ?? '') &&
          String(old.rejoinableUntil ?? '') === String(fresh.rejoinableUntil ?? '') &&
          old.roomName === fresh.roomName &&
          old.actualDurationMinutes === fresh.actualDurationMinutes &&
          old.endedReason === fresh.endedReason;
        if (same) return old;
        anyChanged = true;
        return {
          ...old,
          status: fresh.status,
          isActive: fresh.isActive,
          isIdle: fresh.isIdle,
          endedAt: fresh.endedAt,
          endedReason: fresh.endedReason,
          actualStartedAt: fresh.actualStartedAt,
          actualDurationMinutes: fresh.actualDurationMinutes,
          roomName: fresh.roomName,
          rejoinableUntil: fresh.rejoinableUntil,
        };
      });
      return anyChanged ? next : prev;
    };

    const intervalId = setInterval(() => {
      const qs = meetingsQuery(page, pageSize, searchQueryRef.current, meetingScopeRef.current);
      fetch(`/api/account/meetings?${qs}`, {
        headers: { Authorization: `Bearer ${userToken}` },
      })
        .then((res) => res.json())
        .then((d) => {
          if (!d.meetings) return;
          setDbMeetings((prev) => mergeLiveStatus(prev, d.meetings));
        })
        .catch(console.error);
    }, 30000);

    return () => clearInterval(intervalId);
  }, [userToken, hasLiveMeeting, page, pageSize]);

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
    toast.show(t('schedule.linkCopied'));
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
      ...(isCalendarEligible(meeting)
        ? inviteCalendarLines(
            toCalendarMeetingFromClient(meeting, { hostName }),
            window.location.origin,
            t,
          )
        : []),
      '',
      'Please join a few minutes early to test your audio and video setup.',
    ]
      .filter(Boolean)
      .join('\n');
    navigator.clipboard?.writeText(inviteText);
    toast.show(t('schedule.inviteCopied'));
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
      toast.show(t('anon.enterValidCode'));
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
        setWarningMessage(t('anon.meetingEnded'));
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
          toast.show(t('anon.pastStartTime'));
          router.push(`/rooms/${roomId}`);
          return;
        }
      }
      
      // Valid routing
      router.push(`/rooms/${roomId}`);
    } catch(e) {
      console.error(e);
      setWarningMessage(t('anon.apiError'));
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
    return d.toLocaleDateString(locale, { month: 'long', day: 'numeric', timeZone: userTZ });
  };

  const filteredMeetings = dbMeetings.slice();

  const groupedMeetings = filteredMeetings.reduce((acc: Record<string, any[]>, m) => {
    const label = getDisplayDate(m);
    if (!acc[label]) acc[label] = [];
    acc[label].push(m);
    return acc;
  }, {});


  /* ── Display helpers (presentation only) ── */
  const greetingHour = new Date(currentTime).getHours();
  const greeting =
    greetingHour < 12
      ? tx('dash.greeting.morning', 'Good morning, {name}', { name: user.displayName })
      : greetingHour < 18
        ? tx('dash.greeting.afternoon', 'Good afternoon, {name}', { name: user.displayName })
        : tx('dash.greeting.evening', 'Good evening, {name}', { name: user.displayName });
  const todayLabel = new Date(currentTime).toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' });
  // Today's line under the title, from the meetings on this page of the list.
  const liveCount = dbMeetings.filter((m) => m.isActive).length;
  const soonCount = dbMeetings.filter((m) => {
    if (m.isActive || m.status === 'ENDED' || m.status === 'CANCELED' || !m.scheduledFor) return false;
    const diff = new Date(m.scheduledFor).getTime() - currentTime;
    return diff > 0 && diff <= 60 * 60 * 1000;
  }).length;
  const summaryParts = [
    ...(liveCount > 0 ? [{ key: 'live', text: tx('dash.summaryLive', '{n} in progress', { n: liveCount }) }] : []),
    ...(soonCount > 0 ? [{ key: 'soon', text: tx('dash.summarySoon', '{n} starting soon', { n: soonCount }) }] : []),
  ];
  const replayLabel = t('dash.replay').replace(/^[^\p{L}\p{N}]+/u, '').trim() || t('dash.replay');
  const hasJoinCode = joinCode.trim().length > 0;
  const totalPages = Math.ceil(totalMeetings / pageSize) || 1;


  const openRecording = (recording: { id: number | string; shareKey?: string | null }) => {
    window.open(recording.shareKey ? recordingReplayPath(recording.shareKey) : `/recordings/${recording.id}`, '_blank');
  };

  const copyIcon = (size: number) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={size} height={size} aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
    </svg>
  );
  const videoIcon = (size: number) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <rect x="3" y="6" width="12" height="12" rx="3" />
      <path d="M15 10l6-3v10l-6-3z" />
    </svg>
  );
  const playIcon = (size: number) => (
    <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size} aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
  );
  const linkIcon = (size: number) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width={size} height={size} aria-hidden="true">
      <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
    </svg>
  );
  const chatIcon = (size: number) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={size} height={size} aria-hidden="true">
      <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  const trashIcon = (size: number) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );

  const renderInviteMenu = (m: any, alignLeft?: boolean, menuKey: string = m.roomName) =>
    inviteMenuRoomName === menuKey ? (
      <div className={`${styles.dropdownMenu} ${styles.inviteMenu}${alignLeft ? ` ${styles.inviteMenuLeft}` : ''}`} role="menu">
        <button type="button" role="menuitem" className={styles.dropdownItem} onClick={() => copyMeetingLink(m)}>
          {t('schedule.copyLink')}
        </button>
        <button type="button" role="menuitem" className={styles.dropdownItem} onClick={() => copyMeetingInvite(m)}>
          {t('dash.copyInvite')}
        </button>
        {isCalendarEligible(m) && (
          <>
            <div className={styles.dropdownSeparator} role="separator" />
            <div className={styles.dropdownSectionLabel}>{t('calendar.addToCalendar')}</div>
            {calendarMenuItems(
              toCalendarMeetingFromClient(m, {
                hostName:
                  m?.createdByMember?.fullName || m?.createdByMember?.username || user?.displayName || null,
              }),
              window.location.origin,
              t,
            ).map((item) => (
              <a
                key={item.key}
                role="menuitem"
                className={styles.dropdownItem}
                href={item.href}
                {...(item.download ? { download: true } : { target: '_blank', rel: 'noopener noreferrer' })}
                onClick={() => setInviteMenuRoomName(null)}
              >
                {item.label}
              </a>
            ))}
          </>
        )}
      </div>
    ) : null;

  return (
    <div className={`${styles.anonWrapper} ${styles.dashPage}`}>
      <TopToolbar 
        user={user} 
        onSignOut={onSignOut} 
        onOpenSettings={() => setShowSettingsModal(true)}
        onOpenProfile={() => setShowProfileModal(true)}
        onOpenHelp={onOpenHelp}
        onOpenDesktopApp={onOpenDesktopApp}
        hideAvatar={false} 
        tagline={tx('dash.meetingListTagline', 'Where AI agents learn from and work with your teams and customers.')}
      />

      <div className={styles.dashMain}>
        {/* ── Join with a code (or a personal meeting ID) first, then start a new meeting ── */}
        <section className={styles.dashHero}>
          <div className={styles.dashTitleBlock}>
            <h1 className={styles.dashTitle}>{greeting}</h1>
            <p className={styles.dashSummary}>
              {todayLabel}
              {summaryParts.length > 0 && (
                <>
                  <span className={styles.dashSummaryDot} aria-hidden="true">·</span>
                  {summaryParts.map((part, i) => (
                    <React.Fragment key={part.key}>
                      {i > 0 && tx('dash.listSep', ', ')}
                      <span className={part.key === 'live' ? styles.dashSummaryLive : undefined}>{part.text}</span>
                    </React.Fragment>
                  ))}
                </>
              )}
            </p>
          </div>
          <div className={styles.actionBar}>
            <div className={styles.joinGroup}>
              <label
                className={`${styles.joinField}${warningMessage ? ` ${styles.joinFieldError}` : ''}`}
                htmlFor="dash-join-code"
              >
                <Keyboard size={18} aria-hidden="true" />
                <span className={styles.srOnly}>{t('dash.joinWithCode')}</span>
                <input
                  id="dash-join-code"
                  className={styles.joinFieldInput}
                  placeholder={tx('dash.joinAnyCode', 'Code, link or personal ID')}
                  value={joinCode}
                  autoComplete="off"
                  aria-invalid={!!warningMessage}
                  aria-describedby={warningMessage ? 'dash-join-error' : undefined}
                  onChange={(e) => {
                    setJoinCode(e.target.value);
                    if (warningMessage) setWarningMessage(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoinMeeting()}
                />
                <button
                  type="button"
                  className={`${styles.joinTextBtn}${hasJoinCode ? ` ${styles.joinTextBtnReady}` : ''}`}
                  onClick={handleJoinMeeting}
                  disabled={!hasJoinCode}
                  aria-busy={isJoining}
                >
                  {isJoining ? t('common.joining') : t('common.join')}
                </button>
              </label>
            </div>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
              onClick={handleNewMeeting}
              disabled={isCreatingMeeting}
              aria-busy={isCreatingMeeting}
              title={t('dash.newMeetingHint')}
            >
              <Video size={18} aria-hidden="true" />
              {isCreatingMeeting ? t('common.loading') : t('dash.newMeeting')}
            </button>
          </div>

          {/* Join errors — inline instead of a blocking dialog */}
          {warningMessage && (
            <div className={styles.anonAlert} role="alert" id="dash-join-error">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9"></circle>
                <path d="M12 8v5M12 16h.01"></path>
              </svg>
              <span className={styles.anonAlertText}>{warningMessage}</span>
              <button
                type="button"
                className={`${styles.iconBtn} ${styles.anonAlertClose}`}
                onClick={() => setWarningMessage(null)}
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          )}
        </section>

        <section className={styles.meetingListSection}>
          <div className={styles.meetingListHeader}>
            <h2 className={styles.srOnly}>{t('dash.yourMeetings')}</h2>
            {/* All meetings / hosted by me: the two filter choices as tabs */}
            <div className={styles.scopeTabs} role="group" aria-label={t('dash.filterShow')}>
              {([
                ['all', 'dash.filterAll', 'dash.filterAllHint'],
                ['hosted', 'dash.filterHosted', 'dash.filterHostedHint'],
              ] as const).map(([scope, labelKey, hintKey]) => {
                const selected = meetingScope === scope;
                return (
                  <button
                    key={scope}
                    type="button"
                    aria-pressed={selected}
                    title={t(hintKey)}
                    className={`${styles.scopeTab}${selected ? ` ${styles.scopeTabActive}` : ''}`}
                    onClick={() => setMeetingScope(scope)}
                  >
                    {t(labelKey)}
                    {selected && !loadingMeetings && <span className={styles.scopeCount}>{totalMeetings}</span>}
                  </button>
                );
              })}
            </div>

            <label className={styles.meetingSearchWrapper}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="17" height="17" className={styles.meetingSearchIcon} aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <span className={styles.srOnly}>{t('dash.searchMeetings')}</span>
              <input
                type="search"
                className={styles.meetingSearchInput}
                placeholder={t('dash.searchMeetings')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </label>

            <button
              type="button"
              className={styles.scheduleBtn}
              onClick={() => setShowScheduleModal(true)}
              title={t('dash.scheduleHint')}
              aria-label={tx('dash.scheduleAction', 'Schedule')}
            >
              <CalendarPlus size={16} aria-hidden="true" />
              <span className={styles.scheduleBtnText}>{tx('dash.scheduleAction', 'Schedule')}</span>
            </button>
          </div>

          {loadingMeetings ? (
            <div className={styles.meetingLoadingState} role="status">
              <div className={styles.meetingLoadingSpinner} aria-hidden="true" />
              <p className={styles.meetingLoadingTitle}>{t('dash.loadingMeetings')}</p>
            </div>
          ) : Object.keys(groupedMeetings).length === 0 ? (
            <div className={styles.meetingEmptyState}>
              <span className={styles.meetingEmptyIcon} aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="16" rx="3" />
                  <path d="M3 10h18M8 3v4M16 3v4" />
                </svg>
              </span>
              <p className={styles.meetingEmptyTitle}>{t('dash.noMeetings')}</p>
              <p className={styles.meetingEmptyText}>{t('dash.emptyMeetingsHint')}</p>
            </div>
          ) : (
            <div className={styles.meetingCardsList}>
              {Object.entries(groupedMeetings).map(([dateLabel, meetings]) => (
                <div key={dateLabel} className={styles.meetingDateGroup}>
                  <h3 className={styles.meetingDateLabel}>
                    {dateLabel}
                    {(() => {
                      const first = (meetings as any[])[0];
                      const d = new Date(first?.scheduledFor || first?.createdAt || Date.now());
                      const full = d.toLocaleDateString(locale, { month: 'long', day: 'numeric', timeZone: userTZ });
                      // Only "Today" / "Yesterday" / "Tomorrow" get the date beside them
                      return full !== dateLabel ? <span className={styles.meetingDateSub}>{full}</span> : null;
                    })()}
                  </h3>

                  <div className={styles.meetingCardsGroup}>
                    {(meetings as any[]).map((m, i) => {
                      const d = m.scheduledFor ? new Date(m.scheduledFor) : new Date(m.createdAt);
                      const recording = m.recordings?.find((r: any) => r.status === 'READY');
                      const processingRecording = !recording && m.recordings?.find((r: any) => ['PROCESSING', 'UPLOADING'].includes(r.status));
                      const diffMs = m.scheduledFor ? new Date(m.scheduledFor).getTime() - currentTime : -1;
                      const isHost = m.createdByMemberId === user.id;
                      const isLive = m.isActive;
                      const cardMenuOpen = inviteMenuRoomName === m.roomName;
                      const timeText = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
                      const canJoinOrStart = !isLive && m.status !== 'ENDED' && m.status !== 'CANCELED';
                      const startLabel = isHost && !m.isActive;

                      const statusClass = isLive
                        ? styles.statusInProgress
                        : m.status === 'ENDED' ? styles.statusFinished
                        : m.status === 'CANCELED' ? styles.statusCanceled
                        : diffMs < 0 && m.scheduledFor ? styles.statusPastDue
                        : m.scheduledFor ? styles.statusScheduled
                        : styles.statusFinished;
                      const statusLabel = isLive
                        ? t('dash.statusInProgress')
                        : m.status === 'ENDED' ? t('dash.statusFinished')
                        : m.status === 'CANCELED' ? t('dash.statusCanceled')
                        : diffMs < 0 && m.scheduledFor ? t('dash.statusPastDue')
                        : m.scheduledFor ? t('dash.statusScheduled')
                        : t('dash.statusCreated');

                      const elapsedMin =
                        isLive && m.actualStartedAt
                          ? Math.max(0, Math.floor((currentTime - new Date(m.actualStartedAt).getTime()) / 60000))
                          : null;
                      // The "In progress" chip already says it is live; the time column just counts minutes.
                      const durationText =
                        elapsedMin !== null
                          ? tx('dash.elapsed', '{n} min in', { n: elapsedMin })
                          : m.durationMinutes
                            ? t('dash.mins', { n: m.durationMinutes })
                            : '';
                      const showCountdown =
                        canJoinOrStart && !!m.scheduledFor && diffMs > 0 && diffMs <= 60 * 60 * 1000;
                      const countdownText = showCountdown
                        ? t('dash.startsIn', { time: t('dash.mins', { n: Math.max(1, Math.ceil(diffMs / 60000)) }) })
                        : '';
                      const openReplay = () => openRecording(recording);
                      const onJoinOrStart = () => {
                        if (isHost) {
                          handleStartMeetingClick(m);
                        } else {
                          router.push(`/rooms/${m.roomName}`);
                        }
                      };
                      const copyCode = (e: React.MouseEvent) => {
                        e.stopPropagation();
                        navigator.clipboard?.writeText(m.roomName);
                        toast.show(tx('dash.codeCopied', 'Meeting code copied'));
                      };
                      const hostLabel = m.createdByMember?.fullName || m.createdByMember?.username || '';
                      // Instant meetings have no title: name them after the host instead of repeating the code.
                      const displayTitle =
                        m.title ||
                        (hostLabel
                          ? tx('dash.instantMeetingOf', "{name}'s instant meeting", { name: hostLabel })
                          : m.roomName || t('dash.untitledMeeting'));

                      return (
                        <article
                          key={m.id || i}
                          className={`${isLive ? styles.meetingCardLive : styles.meetingCard}${
                            cardMenuOpen ? ` ${styles.meetingCardInviteMenuOpen}` : ''
                          }`}
                          onDoubleClick={() => {
                            if (isHost) setEditingMeeting(m);
                          }}
                        >
                          {/* Time + duration */}
                          <div className={styles.meetingCardTime}>
                            <div className={styles.meetingCardClock}>{timeText}</div>
                            {durationText && <div className={styles.meetingCardDuration}>{durationText}</div>}
                          </div>

                          {/* Title, status, meta */}
                          <div className={styles.meetingCardInfo}>
                            <div className={styles.meetingCardTitleRow}>
                              <h4 className={styles.meetingCardTitle}>{displayTitle}</h4>
                              {/* One status: "Starts in 24 min" replaces "Scheduled" in the last hour */}
                              {countdownText ? (
                                <span className={`${styles.statusBadge} ${styles.statusSoon}`}>{countdownText}</span>
                              ) : (
                                <span className={`${styles.statusBadge} ${statusClass}`}>
                                  {isLive && <span className={styles.liveDot} aria-hidden="true" />}
                                  {statusLabel}
                                </span>
                              )}
                            </div>

                            <div className={styles.meetingCardMeta}>
                              <span>{tx('dash.hostedBy', 'Host: {name}', { name: hostLabel || t('common.unknown') })}</span>
                              {m._count?.participants > 0 && (
                                <span className={styles.meetingCardMetaItem} title={t('dash.attendees')}>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                  {m._count.participants}
                                </span>
                              )}
                              {m.roomName && (
                                <button
                                  type="button"
                                  className={styles.meetingCodeBtn}
                                  onClick={copyCode}
                                  title={tx('dash.copyCode', 'Copy meeting code')}
                                >
                                  {m.roomName}
                                  {copyIcon(13)}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Replay + access */}
                          {(recording || processingRecording) && (
                            <div className={styles.meetingReplay}>
                              {recording && (
                                <span
                                  className={
                                    recording.visibility === 'PUBLIC'
                                      ? styles.recordingPublicBadge
                                      : styles.recordingPrivateBadge
                                  }
                                  title={
                                    recording.visibility === 'PUBLIC'
                                      ? t('dash.recordingPublicHint')
                                      : t('dash.recordingPrivateHint')
                                  }
                                >
                                  {recording.visibility === 'PUBLIC' ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg>
                                  ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
                                  )}
                                  {recording.visibility === 'PUBLIC'
                                    ? t('dash.recordingPublic')
                                    : t('dash.recordingPrivate')}
                                </span>
                              )}
                              {recording && (
                                <button
                                  type="button"
                                  className={styles.rowAction}
                                  onClick={openReplay}
                                  title={t('dash.replayTitle')}
                                >
                                  {playIcon(12)}
                                  {replayLabel}
                                </button>
                              )}
                              {processingRecording && (
                                <div className={styles.recordingProcessing}>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                  {t('common.processing')}
                                </div>
                              )}
                            </div>
                          )}

                          {/* ── Desktop actions ── */}
                          <div className={styles.meetingCardActions}>
                            {isLive && (
                              <button
                                type="button"
                                className={`${styles.rowAction} ${styles.rowActionPrimary}`}
                                onClick={() => router.push(`/rooms/${m.roomName}`)}
                              >
                                {videoIcon(15)}
                                {t('common.join')}
                              </button>
                            )}

                            {canJoinOrStart && (
                              <button
                                type="button"
                                className={styles.rowAction}
                                onClick={onJoinOrStart}
                              >
                                {startLabel ? (
                                  <>
                                    {playIcon(12)}
                                    {t('common.start')}
                                  </>
                                ) : (
                                  <>
                                    {videoIcon(14)}
                                    {t('common.join')}
                                  </>
                                )}
                              </button>
                            )}

                            {m.roomName && (
                              <div data-invite-menu-anchor="true" className={styles.anchor}>
                                <button
                                  type="button"
                                  title={t('dash.copyInvite')}
                                  aria-label={t('dash.copyInvite')}
                                  aria-haspopup="menu"
                                  aria-expanded={cardMenuOpen}
                                  className={styles.iconBtn}
                                  onClick={() =>
                                    setInviteMenuRoomName((prev) => (prev === m.roomName ? null : m.roomName))
                                  }
                                >
                                  {linkIcon(18)}
                                </button>
                                {renderInviteMenu(m)}
                              </div>
                            )}


                            {m.status === 'ENDED' && (
                              <button
                                type="button"
                                title={t('chatHistory.open')}
                                aria-label={t('chatHistory.open')}
                                className={styles.iconBtn}
                                onClick={() => router.push(`/meeting/${m.id}/chat`)}
                              >
                                {chatIcon(18)}
                              </button>
                            )}

                            {isHost && (
                              <button
                                type="button"
                                title={t('dash.editMeeting')}
                                aria-label={t('dash.editMeeting')}
                                className={styles.iconBtn}
                                onClick={() => setEditingMeeting(m)}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
                                  <path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z" />
                                </svg>
                              </button>
                            )}

                            {isHost && !m.isActive && (
                              <button
                                type="button"
                                title={t('dash.deleteMeeting')}
                                aria-label={t('dash.deleteMeeting')}
                                className={styles.iconBtnDanger}
                                onClick={() => setDeletingMeeting(m)}
                              >
                                {trashIcon(18)}
                              </button>
                            )}
                          </div>

                          {/* ── Mobile-only action bar ── */}
                          <div className={styles.meetingCardMobileActions}>
                            {isLive && (
                              <button
                                type="button"
                                className={styles.mobileJoinBtn}
                                onClick={() => router.push(`/rooms/${m.roomName}`)}
                              >
                                {videoIcon(14)}
                                {t('common.join')}
                              </button>
                            )}
                            {canJoinOrStart && (
                              <button
                                type="button"
                                className={isHost && !m.isActive && m.scheduledFor ? styles.mobileStartBtn : styles.mobileJoinBtn}
                                onClick={onJoinOrStart}
                              >
                                {startLabel ? (
                                  <>
                                    {playIcon(14)}
                                    {t('common.start')}
                                  </>
                                ) : (
                                  <>
                                    {videoIcon(14)}
                                    {t('common.join')}
                                  </>
                                )}
                              </button>
                            )}
                            {m.roomName && (
                              <div data-invite-menu-anchor="true" className={styles.anchor}>
                                <button
                                  type="button"
                                  className={styles.mobileCopyBtn}
                                  aria-haspopup="menu"
                                  aria-expanded={cardMenuOpen}
                                  onClick={() =>
                                    setInviteMenuRoomName((prev) => (prev === m.roomName ? null : m.roomName))
                                  }
                                >
                                  {linkIcon(14)}
                                  {tx('dash.invite', 'Invite')}
                                </button>
                                {renderInviteMenu(m, true)}
                              </div>
                            )}
                            {m.status === 'ENDED' && (
                              <button
                                type="button"
                                className={styles.mobileCopyBtn}
                                onClick={() => router.push(`/meeting/${m.id}/chat`)}
                              >
                                {chatIcon(14)}
                                {t('chatHistory.shortTitle')}
                              </button>
                            )}
                            {isHost && !m.isActive && (
                              <button
                                type="button"
                                className={styles.mobileDeleteBtn}
                                onClick={() => setDeletingMeeting(m)}
                              >
                                {trashIcon(14)}
                                {t('common.delete')}
                              </button>
                            )}
                          </div>
                        </article>
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
                    aria-label={t('dash.page', { n: pageSize })}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  >
                    <option value={15}>{t('dash.page', { n: 15 })}</option>
                    <option value={25}>{t('dash.page', { n: 25 })}</option>
                    <option value={50}>{t('dash.page', { n: 50 })}</option>
                    <option value={100}>{t('dash.page', { n: 100 })}</option>
                  </select>
                  <span className={styles.totalFiles}>{totalMeetings} {t('dash.totalRecords')}</span>
                </div>
                <div className={styles.paginationRight}>
                  <button
                    type="button"
                    className={styles.pageArrow}
                    disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    aria-label={tx('dash.prevPage', 'Previous page')}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
                  </button>
                  {(() => {
                    const pages = [];
                    for (let i = 1; i <= Math.min(4, totalPages); i++) {
                      pages.push(
                        <button
                          key={i}
                          type="button"
                          className={page === i ? styles.pageNumActive : styles.pageNum}
                          aria-current={page === i ? 'page' : undefined}
                          onClick={() => setPage(i)}
                        >
                          {i}
                        </button>
                      );
                    }
                    return pages;
                  })()}
                  <button
                    type="button"
                    className={styles.pageArrow}
                    disabled={page >= Math.ceil(totalMeetings / pageSize)}
                    onClick={() => setPage(p => Math.min(Math.ceil(totalMeetings / pageSize), p + 1))}
                    aria-label={tx('dash.nextPage', 'Next page')}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>{/* end dashMain */}

      {scheduledModalData && (
        <div className={styles.dashModalOverlay}>
          <div className={styles.dashModalContent} role="dialog" aria-modal="true" aria-labelledby="dash-scheduled-title">
            <h2 id="dash-scheduled-title" className={styles.dialogTitle}>{t('anon.scheduledMeeting')}</h2>
            <p className={styles.dialogText}>
              {t('anon.hostedBy', { title: scheduledModalData.title || scheduledModalData.roomName, host: scheduledModalData.createdByMember?.fullName || 'Host' })}
            </p>
            {(() => {
              const diffMs = new Date(scheduledModalData.scheduledFor).getTime() - Date.now();
              return diffMs > 60 * 60 * 1000 ? (
                <div className={styles.dialogInfo}>
                  <p className={`${styles.dialogText} ${styles.dialogTextMuted}`}>{t('anon.scheduledFor')} <strong>{new Date(scheduledModalData.scheduledFor).toLocaleString()}</strong></p>
                  <p className={styles.dialogText} style={{ marginTop: 6 }}>{t('anon.moreThanHour')}</p>
                </div>
              ) : (
                <div className={styles.dialogCountdown}>
                  <div className={styles.dialogCountdownLabel}>{t('anon.startingIn')}</div>
                  <div className={styles.dialogCountdownValue}>{countdown}</div>
                </div>
              );
            })()}
            <div className={styles.dialogActions}>
              <button 
                type="button"
                onClick={() => setScheduledModalData(null)} 
                className={`${styles.btn} ${styles.btnSm} ${styles.btnText}`}
              >
                {t('common.close')}
              </button>
              {new Date(scheduledModalData.scheduledFor).getTime() - Date.now() <= 60 * 60 * 1000 && (
                <button 
                  type="button"
                  onClick={() => {
                    setScheduledModalData(null);
                    router.push(`/rooms/${scheduledModalData.roomName}`);
                  }} 
                  className={`${styles.btn} ${styles.btnSm} ${styles.btnFill} ${styles.btnFlat}`}
                >
                  {scheduledModalData.createdByMemberId === user.id ? t('dash.startMeetingBtn') : t('anon.joinAnyway')}
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
          <div className={styles.dashModalContent} role="dialog" aria-modal="true" aria-labelledby="dash-early-title">
            <h2 id="dash-early-title" className={styles.dialogTitle}>{t('dash.earlyStart.title')}</h2>
            <p className={styles.dialogText}>
              {t('dash.earlyStart.message', { time: new Date(earlyStartMeeting.scheduledFor).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) })}
            </p>
            <p className={styles.dialogText}>{t('dash.earlyStart.confirm')}</p>
            <div className={styles.dialogActions}>
              <button 
                type="button"
                onClick={() => setEarlyStartMeeting(null)}
                className={`${styles.btn} ${styles.btnSm} ${styles.btnText}`}
              >
                {t('common.cancel')}
              </button>
              <button 
                type="button"
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
                className={`${styles.btn} ${styles.btnSm} ${styles.btnFill} ${styles.btnFlat}`}
              >
                {t('dash.earlyStart.yes')}
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
            toast.show(t('dash.settingsSaved'));
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

      {/* ── Delete Confirmation Dialog ── */}
      {deletingMeeting && (
        <div className={styles.dashModalOverlay} style={{ zIndex: 9999 }}>
          <div className={styles.dashModalContent} role="alertdialog" aria-modal="true" aria-labelledby="dash-delete-title">
            <h2 id="dash-delete-title" className={styles.dialogTitle}>{t('dash.deleteMeetingConfirm')}</h2>
            <p className={styles.dialogText}>
              {t('dash.willBeDeleted', { name: deletingMeeting.title || deletingMeeting.roomName })}
            </p>
            <div className={styles.dialogActions}>
              <button
                type="button"
                onClick={() => setDeletingMeeting(null)}
                className={`${styles.btn} ${styles.btnSm} ${styles.btnText}`}
                disabled={deleteLoading}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteMeeting(deletingMeeting.roomName)}
                className={`${styles.btn} ${styles.btnSm} ${styles.btnDanger}`}
                disabled={deleteLoading}
                aria-busy={deleteLoading}
              >
                {deleteLoading ? t('common.deleting') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
