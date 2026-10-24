import React, { useEffect, useMemo, useRef, useState } from 'react';
import { generateRoomId } from '@/lib/client-utils';
import { authFetch, authHeaders } from '@/lib/kloudSession';
import styles from '../styles/ScheduleMeetingModal.module.css';
import { useI18n } from './i18n';
import {
  getTimezoneOffsetMinutes,
  toDateAndTimeInTimezone,
  zonedDateTimeToUtcIso,
} from '@/lib/calendar/timezone';
import {
  calendarMenuItems,
  inviteCalendarLines,
  isCalendarEligible,
  toCalendarMeetingFromClient,
  type CalendarMenuItem,
} from '@/lib/calendar/menu';
import {
  DEFAULT_REMINDER_OFFSETS,
  MAX_INVITEES,
  invitationEmail,
  isValidEmail,
  reminderEmail,
} from '@/lib/meetingInvites';

/** Email / AI assistant / linked-event tabs (enterprise features; shown as before — not saved yet). */
const SHOW_ENTERPRISE_TABS = true;

type TabType = 'general' | 'emails' | 'ai' | 'linked';

interface ScheduleMeetingModalProps {
  user: any;
  existingMeeting?: any;
  onClose: () => void;
  onSave: () => void;
}

type RecordingVisibility = 'PUBLIC' | 'PRIVATE';

function readyRecording(meeting: {
  recordings?: { status?: string; visibility?: string; shareKey?: string | null }[];
} | null | undefined) {
  const rows = meeting?.recordings;
  if (!Array.isArray(rows)) return null;
  return rows.find((row) => row.status === 'READY' && row.shareKey) ?? null;
}

const FALLBACK_TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'Europe/London',
  'Europe/Paris',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Australia/Sydney',
];

function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function formatTimezoneLabel(timezone: string): string {
  const offset = getTimezoneOffsetMinutes(timezone, new Date());
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `(GMT${sign}${hh}:${mm}) ${timezone}`;
}

function formatInviteDateTime(scheduledFor?: string, timezone?: string): string {
  if (!scheduledFor) return 'To be announced';
  try {
    const date = new Date(scheduledFor);
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: timezone || undefined,
    }).format(date);
  } catch {
    return scheduledFor;
  }
}

type ReminderUnit = 'hours' | 'days';
interface ReminderRow {
  amount: number;
  unit: ReminderUnit;
}
const REMINDER_AMOUNTS: Record<ReminderUnit, number[]> = {
  hours: [1, 2, 3, 4, 6, 8, 12],
  days: [1, 2, 3, 7],
};
const MAX_REMINDERS = 5;

function offsetsToRows(offsets: number[]): ReminderRow[] {
  return offsets.map((minutes) =>
    minutes % 1440 === 0
      ? { amount: minutes / 1440, unit: 'days' as const }
      : { amount: Math.max(1, Math.round(minutes / 60)), unit: 'hours' as const },
  );
}

function rowsToOffsets(rows: ReminderRow[]): number[] {
  return rows.map((row) => row.amount * (row.unit === 'days' ? 1440 : 60));
}

/** Emails typed or pasted together: "a@x.com, b@y.com; c@z.com" */
function splitEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/** "90min(1.5h)" → 90 */
function durationMinutesFrom(durationStr: string): number {
  const match = /^(\d+)min/.exec(durationStr);
  return match ? Number(match[1]) : 30;
}

export function ScheduleMeetingModal({ user, existingMeeting, onClose, onSave }: ScheduleMeetingModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const { t } = useI18n();
  /** Translation with an English fallback for keys not yet added to the locale files. */
  const tf = (key: string, fallback: string, params?: Record<string, string | number>) => {
    const value = t(key, params);
    if (value !== key) return value;
    return Object.entries(params ?? {}).reduce((text, [k, v]) => text.split(`{${k}}`).join(String(v)), fallback);
  };
  const [subModal, setSubModal] = useState<'invite' | 'reminder' | null>(null);
  const [showInviteMenu, setShowInviteMenu] = useState(false);
  const inviteMenuRef = useRef<HTMLDivElement | null>(null);
  const [showCalendarMenu, setShowCalendarMenu] = useState(false);
  const calendarMenuRef = useRef<HTMLDivElement | null>(null);
  /** Set after a successful create/update: the dialog switches to the "add to calendar" step. */
  const [savedMeeting, setSavedMeeting] = useState<any>(null);
  const [savedKind, setSavedKind] = useState<'created' | 'updated'>('created');

  const [title, setTitle] = useState(existingMeeting?.title || `${user?.displayName || 'User'}'s Meeting`);
  const [description, setDescription] = useState(existingMeeting?.description || '');

  const initialTimezone = existingMeeting?.timezone || getUserTimezone();
  const initialDateTime = existingMeeting?.scheduledFor
    ? toDateAndTimeInTimezone(new Date(existingMeeting.scheduledFor), initialTimezone)
    : toDateAndTimeInTimezone(new Date(), initialTimezone);

  const [timezone, setTimezone] = useState(initialTimezone);
  const timezoneOptions = useMemo(() => {
    const supportedValuesOf = (Intl as typeof Intl & {
      supportedValuesOf?: (key: string) => string[];
    }).supportedValuesOf;
    const tzList =
      typeof supportedValuesOf === 'function'
        ? supportedValuesOf('timeZone')
        : FALLBACK_TIMEZONES;
    return Array.from(new Set([...tzList, timezone])).sort((a, b) => a.localeCompare(b));
  }, [timezone]);

  const initDate = initialDateTime.date;
  const initTime = existingMeeting?.scheduledFor ? initialDateTime.time : '20:00';

  const [date, setDate] = useState(initDate);
  const [time, setTime] = useState(initTime);
  
  let initDurStr = '30min';
  if (existingMeeting?.durationMinutes) {
     if (existingMeeting.durationMinutes === 15) initDurStr = '15min';
     if (existingMeeting.durationMinutes === 30) initDurStr = '30min';
     if (existingMeeting.durationMinutes === 45) initDurStr = '45min';
     if (existingMeeting.durationMinutes === 60) initDurStr = '60min';
     if (existingMeeting.durationMinutes === 90) initDurStr = '90min(1.5h)';
     if (existingMeeting.durationMinutes === 120) initDurStr = '120min(2h)';
     if (existingMeeting.durationMinutes === 180) initDurStr = '180min(3h)';
     if (existingMeeting.durationMinutes === 240) initDurStr = '240min(4h)';
  }
  const [durationStr, setDurationStr] = useState(initDurStr);
  
  const [isSaving, setIsSaving] = useState(false);

  const isFinished = existingMeeting?.status === 'ENDED' || existingMeeting?.status === 'FINISHED';
  const isCanceled = existingMeeting?.status === 'CANCELED';
  const isReadOnly = isFinished || isCanceled;
  const recording = readyRecording(existingMeeting);
  const [recordingVisibility, setRecordingVisibility] = useState<RecordingVisibility>(
    recording?.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
  );

  // Attendees (AI tab) and invitation / reminder emails (Emails tab); saved after the meeting.
  const [attendees, setAttendees] = useState<string[]>([]);
  const [attendeeDraft, setAttendeeDraft] = useState('');
  const [attendeeError, setAttendeeError] = useState('');
  const [inviteEmails, setInviteEmails] = useState(true);
  const [reminderEmails, setReminderEmails] = useState(true);
  const [reminders, setReminders] = useState<ReminderRow[]>(() => offsetsToRows(DEFAULT_REMINDER_OFFSETS));
  const [invitesTouched, setInvitesTouched] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ sent: number; failed: string[]; error?: boolean } | null>(null);

  useEffect(() => {
    const roomName = existingMeeting?.roomName;
    if (!roomName) return;
    let cancelled = false;
    authFetch(`/api/meetings/${encodeURIComponent(roomName)}/invitees`, { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setAttendees(Array.isArray(data.emails) ? data.emails : []);
        setInviteEmails(data.inviteEmails !== false);
        setReminderEmails(data.reminderEmails !== false);
        if (Array.isArray(data.reminderOffsets)) setReminders(offsetsToRows(data.reminderOffsets));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [existingMeeting?.roomName]);

  /** Adds the valid addresses; invalid ones stay in the input with an error. */
  const addAttendees = (text: string) => {
    const parts = splitEmails(text);
    const valid = parts.filter(isValidEmail);
    const invalid = parts.filter((part) => !isValidEmail(part));
    if (valid.length > 0) {
      setAttendees((prev) => Array.from(new Set([...prev, ...valid])).slice(0, MAX_INVITEES));
      setInvitesTouched(true);
    }
    setAttendeeDraft(invalid.join(', '));
    setAttendeeError(invalid.length > 0 ? tf('schedule.attendeeInvalid', 'Enter a valid email address') : '');
  };

  const removeAttendee = (email: string) => {
    setAttendees((prev) => prev.filter((item) => item !== email));
    setInvitesTouched(true);
  };

  const updateReminders = (next: ReminderRow[]) => {
    setReminders(next);
    setInvitesTouched(true);
  };

  /** Saves attendees + email settings; the server emails attendees not yet invited for this time. */
  const saveInvites = async (roomName: string) => {
    const pending = splitEmails(attendeeDraft).filter(isValidEmail);
    const emails = Array.from(new Set([...attendees, ...pending]));
    if (!invitesTouched && emails.length === 0) return null;
    try {
      const res = await authFetch(`/api/meetings/${encodeURIComponent(roomName)}/invitees`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ emails, inviteEmails, reminderEmails, reminderOffsets: rowsToOffsets(reminders) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) return { sent: 0, failed: [], error: true };
      return { sent: Number(data.sent) || 0, failed: Array.isArray(data.failed) ? data.failed : [] };
    } catch {
      return { sent: 0, failed: [], error: true };
    }
  };

  const inviteResultText = (result: { sent: number; failed: string[]; error?: boolean } | null): string => {
    if (!result) return '';
    if (result.error) return tf('schedule.invitesSaveFailed', "Attendees couldn't be saved. Open the meeting and save again.");
    const lines: string[] = [];
    if (result.sent > 0) lines.push(tf('schedule.invitesSent', 'Invitation sent to {n} attendee(s).', { n: result.sent }));
    if (result.failed.length > 0)
      lines.push(tf('schedule.invitesFailed', "Couldn't email: {list}", { list: result.failed.join(', ') }));
    return lines.join(' ');
  };

  useEffect(() => {
    if (!showInviteMenu && !showCalendarMenu) return;
    const handleOutside = (event: MouseEvent) => {
      if (!inviteMenuRef.current?.contains(event.target as Node)) {
        setShowInviteMenu(false);
      }
      if (!calendarMenuRef.current?.contains(event.target as Node)) {
        setShowCalendarMenu(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowInviteMenu(false);
        setShowCalendarMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showInviteMenu, showCalendarMenu]);

  const hostDisplayName = (meeting: any): string =>
    meeting?.createdByMember?.fullName ||
    meeting?.createdByMember?.username ||
    user?.displayName ||
    user?.username ||
    'Host';

  /** Calendar data for a persisted meeting (the .ics endpoint serves the same values). */
  const calendarItemsFor = (meeting: any): CalendarMenuItem[] =>
    isCalendarEligible(meeting)
      ? calendarMenuItems(
          toCalendarMeetingFromClient(meeting, { hostName: hostDisplayName(meeting) }),
          window.location.origin,
          t,
        )
      : [];

  const copyMeetingLink = async (meeting: any = existingMeeting) => {
    if (!meeting?.roomName) return;
    const url = `${window.location.origin}/rooms/${meeting.roomName}`;
    await navigator.clipboard.writeText(url);
    setShowInviteMenu(false);
    alert(t('schedule.linkCopied'));
  };

  const copyMeetingInvite = async (meeting: any = existingMeeting) => {
    if (!meeting?.roomName) return;
    const url = `${window.location.origin}/rooms/${meeting.roomName}`;
    const hostName = hostDisplayName(meeting);
    const timezoneLabel = formatTimezoneLabel(timezone || meeting?.timezone || getUserTimezone());
    const scheduledForForInvite = date && time
      ? zonedDateTimeToUtcIso(date, time, timezone || meeting?.timezone || getUserTimezone())
      : meeting?.scheduledFor;
    const calendarLines = isCalendarEligible(meeting)
      ? inviteCalendarLines(
          toCalendarMeetingFromClient(meeting, { hostName }),
          window.location.origin,
          t,
        )
      : [];
    const inviteText = [
      `You are invited to a Kloud Meeting`,
      '',
      `${meeting.title || 'Untitled Meeting'}`,
      `Host: ${hostName}`,
      `When: ${formatInviteDateTime(scheduledForForInvite, timezone || meeting?.timezone)}`,
      `Time Zone: ${timezoneLabel}`,
      meeting.durationMinutes ? `Duration: ${meeting.durationMinutes} minutes` : '',
      description ? `Description: ${description}` : '',
      `Meeting ID: ${meeting.roomName}`,
      `Join meeting: ${url}`,
      ...calendarLines,
      '',
      'Please join a few minutes early to test your audio and video setup.',
    ]
      .filter(Boolean)
      .join('\n');
    await navigator.clipboard.writeText(inviteText);
    setShowInviteMenu(false);
    alert(t('schedule.inviteCopied'));
  };

  const handleCancelMeeting = async () => {
    const notifyLine = attendees.length > 0
      ? `\n\n${tf('schedule.cancelNotifyAttendees', 'Attendees who were invited will get a cancellation email.')}`
      : '';
    if (!confirm(`${t('schedule.cancelConfirm')}${notifyLine}`)) return;
    setIsSaving(true);
    try {
      const res = await authFetch(`/api/meetings/${existingMeeting.roomName}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status: 'CANCELED' }),
      });
      const data = await res.json().catch(() => null);
      const failed: string[] = Array.isArray(data?.cancelNotice?.failed) ? data.cancelNotice.failed : [];
      if (failed.length > 0) alert(tf('schedule.invitesFailed', "Couldn't email: {list}", { list: failed.join(', ') }));
      onSave();
    } catch (e) {
      alert(t('schedule.cancelFailed'));
      setIsSaving(false);
    }
  };

  const handleDeleteMeeting = async () => {
    if (!confirm(t('schedule.deleteConfirm'))) return;
    setIsSaving(true);
    try {
      await authFetch(`/api/meetings/${existingMeeting.roomName}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      onSave();
    } catch (e) {
      alert(t('schedule.deleteFailed'));
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const scheduledForIso = zonedDateTimeToUtcIso(date, time, timezone);
      
      const durationMinutes = durationMinutesFrom(durationStr);

      if (recording?.shareKey && recording.visibility !== recordingVisibility) {
        const visibilityRes = await authFetch(
          `/api/recordings/${encodeURIComponent(recording.shareKey)}`,
          {
            method: 'PATCH',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ visibility: recordingVisibility }),
          },
        );
        if (!visibilityRes.ok) {
          const err = await visibilityRes.json().catch(() => null);
          alert(err?.code === 'BILLING_LIMIT' ? t('billing.limit.publicReplay') : t('dash.recordingVisibilityFailed'));
          return;
        }
      }

      if (isReadOnly) {
        onSave();
        return;
      }

      let saved: any = null;
      if (existingMeeting?.roomName) {
        const res = await authFetch(`/api/meetings/${existingMeeting.roomName}`, {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            title,
            description,
            scheduledFor: scheduledForIso,
            durationMinutes,
            timezone,
          }),
        });
        if (!res.ok) throw new Error(`Update failed (${res.status})`);
        const data = await res.json().catch(() => null);
        saved = { ...existingMeeting, ...(data?.meeting ?? {}) };
      } else {
        const res = await authFetch('/api/meetings', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            roomName: generateRoomId(),
            title,
            description,
            scheduledFor: scheduledForIso,
            durationMinutes,
            timezone,
            status: 'ACTIVE'
          }),
        });
        if (!res.ok) throw new Error(`Create failed (${res.status})`);
        saved = await res.json().catch(() => null);
      }
      const invites = saved?.roomName ? await saveInvites(saved.roomName) : null;
      setInviteResult(invites);
      if (saved?.roomName && isCalendarEligible(saved)) {
        // Stay open on an "add to calendar" step; Done/close then refreshes the list.
        setSavedKind(existingMeeting?.roomName ? 'updated' : 'created');
        setSavedMeeting(saved);
        return;
      }
      if (invites && (invites.error || invites.failed.length > 0)) alert(inviteResultText(invites));
      onSave();
    } catch (error) {
      console.error('Failed to schedule meeting', error);
      alert(t('schedule.scheduleFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className={styles.overlay}>
        <div
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="kloud-schedule-meeting-title"
        >
          {/* Header */}
          <div className={styles.header}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={savedMeeting ? onSave : onClose}
              disabled={isSaving}
              aria-label={t('common.close')}
              title={t('common.close')}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <h2 id="kloud-schedule-meeting-title" className={styles.title}>
              {savedMeeting
                ? savedKind === 'updated'
                  ? t('calendar.updatedTitle')
                  : t('calendar.scheduledTitle')
                : existingMeeting
                  ? t('schedule.editMeeting')
                  : t('schedule.newMeeting')}
            </h2>
            {savedMeeting ? (
            <div className={styles.headerActions}>
              <button type="button" className={styles.btnOutline} onClick={() => copyMeetingInvite(savedMeeting)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a2 2 0 012-2h10" />
                </svg>
                <span className={styles.hideNarrow}>{t('schedule.copyInvite')}</span>
              </button>
              <button type="button" className={styles.btnSolid} onClick={onSave}>
                {t('calendar.done')}
              </button>
            </div>
            ) : (
            <div className={styles.headerActions}>
              {existingMeeting && calendarItemsFor(existingMeeting).length > 0 && (
                <div ref={calendarMenuRef} className={styles.menuAnchor}>
                  <button
                    className={styles.btnOutline}
                    onClick={() => {
                      setShowInviteMenu(false);
                      setShowCalendarMenu((prev) => !prev);
                    }}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={showCalendarMenu}
                    aria-label={t('calendar.addToCalendar')}
                    title={t('calendar.addToCalendar')}
                  >
                    <CalendarGlyph size={16} />
                    <span className={styles.hideNarrow}>{t('calendar.addToCalendar')}</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" width="14" height="14" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {showCalendarMenu && (
                    <div className={styles.menu} role="menu">
                      {calendarItemsFor(existingMeeting).map((item) => (
                        <a
                          key={item.key}
                          role="menuitem"
                          className={styles.menuItem}
                          href={item.href}
                          {...(item.download
                            ? { download: true }
                            : { target: '_blank', rel: 'noopener noreferrer' })}
                          onClick={() => setShowCalendarMenu(false)}
                        >
                          {item.label}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {existingMeeting && !isCanceled && (
                <div ref={inviteMenuRef} className={styles.menuAnchor}>
                  <button
                    className={styles.btnOutline}
                    onClick={() => {
                      setShowCalendarMenu(false);
                      setShowInviteMenu((prev) => !prev);
                    }}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={showInviteMenu}
                    aria-label={t('schedule.copyInvite')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                      <rect x="9" y="9" width="11" height="11" rx="2" />
                      <path d="M5 15V5a2 2 0 012-2h10" />
                    </svg>
                    <span className={styles.hideNarrow}>{t('schedule.copyInvite')}</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" width="14" height="14" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {showInviteMenu && (
                    <div className={styles.menu} role="menu">
                      <button type="button" role="menuitem" className={styles.menuItem} onClick={() => copyMeetingLink()}>
                        {t('schedule.copyLink')}
                      </button>
                      <button type="button" role="menuitem" className={styles.menuItem} onClick={() => copyMeetingInvite()}>
                        {t('schedule.copyInvite')}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button type="button" className={styles.btnSolid} onClick={handleSave} disabled={isSaving}>
                {isSaving ? t('common.saving') : t('common.save')}
              </button>
            </div>
            )}
          </div>
          
          {/* Tabs — enterprise tabs stay hidden until there is a paid plan to upgrade to. */}
          {SHOW_ENTERPRISE_TABS && !savedMeeting && (
          <div className={styles.tabContainer}>
            <button 
              className={activeTab === 'general' ? styles.tabActive : styles.tab} 
              onClick={() => setActiveTab('general')}
            >
              {t('schedule.general')}
            </button>
            <button 
              className={activeTab === 'emails' ? styles.tabActive : styles.tab} 
              onClick={() => setActiveTab('emails')}
            >
              {t('schedule.emails')}
            </button>
            <button 
              className={activeTab === 'ai' ? styles.tabActive : styles.tab} 
              onClick={() => setActiveTab('ai')}
            >
              {t('schedule.aiAssistant')}
            </button>
            <button 
              className={activeTab === 'linked' ? styles.tabActive : styles.tab} 
              onClick={() => setActiveTab('linked')}
            >
              {t('schedule.linkedEvents')}
            </button>
          </div>
          )}

          <div className={styles.bodyScroll}>
          {/* After save: offer to put the meeting on the user's calendar. */}
          {savedMeeting && (
            <div className={styles.content}>
              <div className={styles.savedPanel}>
                <span className={styles.savedBadge} aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
                <div className={styles.savedMeetingTitle}>{savedMeeting.title || 'Untitled Meeting'}</div>
                <div className={styles.savedMeetingWhen}>
                  {formatInviteDateTime(savedMeeting.scheduledFor, savedMeeting.timezone || undefined)}
                </div>
                {inviteResultText(inviteResult) && (
                  <p
                    className={styles.hint}
                    role="status"
                    style={inviteResult?.error || inviteResult?.failed.length ? { color: '#b91c1c' } : undefined}
                  >
                    {inviteResultText(inviteResult)}
                  </p>
                )}
                <div className={styles.sectionLabel}>{t('calendar.addToCalendar')}</div>
                <div className={styles.calendarGrid}>
                  {calendarItemsFor(savedMeeting).map((item) => (
                    <a
                      key={item.key}
                      className={styles.calendarOption}
                      href={item.href}
                      {...(item.download
                        ? { download: true }
                        : { target: '_blank', rel: 'noopener noreferrer' })}
                    >
                      {item.download ? <DownloadGlyph size={18} /> : <CalendarGlyph size={18} />}
                      {item.label}
                    </a>
                  ))}
                </div>
                <p className={styles.hint}>
                  {savedKind === 'updated' ? t('calendar.updatedHint') : t('calendar.savedHint')}
                </p>
              </div>
            </div>
          )}
          {/* Tab Content: General Information */}
          {!savedMeeting && activeTab === 'general' && (
            <div className={styles.content}>
              {/* Title */}
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden="true" />
                <input
                  type="text"
                  className={styles.titleInput}
                  placeholder={t('schedule.titlePlaceholder')}
                  aria-label={t('schedule.title')}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              {existingMeeting && (
                <div className={styles.row}>
                  <span className={styles.rowIcon} aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
                    </svg>
                  </span>
                  <div className={styles.metaLine}>
                    <span className={styles.metaLabel}>{t('schedule.meetingId')}</span>
                    <span className={styles.meetingId}>{existingMeeting.roomName}</span>
                    <span className={styles.srOnly}>{t('schedule.status')}:</span>
                    <span
                      className={`${styles.statusChip} ${
                        existingMeeting.status === 'ENDED' ? styles.statusEnded :
                        existingMeeting.status === 'CANCELED' ? styles.statusCanceled :
                        existingMeeting.status === 'PAST_DUE' ? styles.statusPastDue :
                        existingMeeting.status === 'ACTIVE' ? styles.statusActive : styles.statusNeutral
                      }`}
                    >
                      {existingMeeting.status === 'ENDED' ? 'Finished' : 
                       existingMeeting.status === 'PAST_DUE' ? 'Past Due' : 
                       existingMeeting.status === 'ACTIVE' ? (new Date(existingMeeting.startedAt) > new Date(existingMeeting.createdAt) ? 'In Progress' : 'Scheduled') : 
                       existingMeeting.status || 'Scheduled'}
                    </span>
                  </div>
                </div>
              )}

              {/* Time */}
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </span>
                <div className={styles.stack}>
                  <span className={styles.srOnly}>{t('schedule.setTime')}</span>
                  <div className={styles.timeRow}>
                    <input 
                      type="date" 
                      className={`${styles.input} ${styles.timeInput}`} 
                      aria-label={tf('schedule.date', 'Date')}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      disabled={isReadOnly}
                    />
                    <input 
                      type="time" 
                      className={`${styles.input} ${styles.timeInput}`} 
                      aria-label={tf('schedule.startTime', 'Start time')}
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      disabled={isReadOnly}
                    />
                    <select 
                      className={`${styles.input} ${styles.select} ${styles.timeInput}`}
                      aria-label={tf('schedule.duration', 'Duration')}
                      value={durationStr}
                      onChange={(e) => setDurationStr(e.target.value)}
                      disabled={isReadOnly}
                    >
                      <option value="15min">15min</option>
                      <option value="30min">30min</option>
                      <option value="45min">45min</option>
                      <option value="60min">60min</option>
                      <option value="90min(1.5h)">90min(1.5h)</option>
                      <option value="120min(2h)">120min(2h)</option>
                      <option value="180min(3h)">180min(3h)</option>
                      <option value="240min(4h)">240min(4h)</option>
                      <option value="300min(5h)">300min(5h)</option>
                      <option value="360min(6h)">360min(6h)</option>
                      <option value="420min(7h)">420min(7h)</option>
                    </select>
                  </div>
                  <label className={styles.inlineField}>
                    <span className={styles.inlineLabel}>{t('schedule.timeZone')}</span>
                    <select
                      className={`${styles.input} ${styles.select} ${styles.inputCompact}`}
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      disabled={isReadOnly}
                    >
                      {timezoneOptions.map((tz) => (
                        <option key={tz} value={tz}>
                          {formatTimezoneLabel(tz)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {/* Description */}
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M4 6h16M4 10h16M4 14h10M4 18h7" />
                  </svg>
                </span>
                <textarea 
                  className={styles.textarea} 
                  placeholder={t('schedule.descPlaceholder')} 
                  aria-label={t('schedule.description')}
                  rows={4} 
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {/* Access option (recording visibility) */}
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V8a4 4 0 018 0v3" />
                  </svg>
                </span>
                <div className={styles.stack}>
                  <span className={styles.sectionLabel} id="kloud-schedule-access-label">
                    {t('schedule.accessOption')}{' '}
                    <span className={styles.sectionLabelMeta}>· {t('schedule.recordings')}</span>
                  </span>
                  <div className={styles.optionGrid} role="radiogroup" aria-labelledby="kloud-schedule-access-label">
                    <label
                      className={`${styles.optionCard}${recordingVisibility === 'PUBLIC' ? ` ${styles.optionCardOn}` : ''}${!recording?.shareKey ? ` ${styles.optionCardDisabled}` : ''}`}
                    >
                      <span className={styles.optionHead}>
                        <input
                          type="radio"
                          name="access"
                          value="public"
                          className={styles.radio}
                          checked={recordingVisibility === 'PUBLIC'}
                          onChange={() => setRecordingVisibility('PUBLIC')}
                          disabled={!recording?.shareKey}
                        />
                        {t('schedule.public')}
                      </span>
                      <span className={styles.optionDesc}>{t('schedule.publicDesc')}</span>
                    </label>
                    <label
                      className={`${styles.optionCard}${recordingVisibility === 'PRIVATE' ? ` ${styles.optionCardOn}` : ''}${!recording?.shareKey ? ` ${styles.optionCardDisabled}` : ''}`}
                    >
                      <span className={styles.optionHead}>
                        <input
                          type="radio"
                          name="access"
                          value="private"
                          className={styles.radio}
                          checked={recordingVisibility === 'PRIVATE'}
                          onChange={() => setRecordingVisibility('PRIVATE')}
                          disabled={!recording?.shareKey}
                        />
                        {t('schedule.private')}
                      </span>
                      <span className={styles.optionDesc}>{t('schedule.privateDesc')}</span>
                    </label>
                  </div>
                  {!recording?.shareKey && (
                    <span className={styles.hint}>
                      {tf('schedule.accessNeedsRecording', 'You can change this once a recording is ready.')}
                    </span>
                  )}
                </div>
              </div>

              {isFinished && existingMeeting?.recordings && existingMeeting.recordings.length > 0 && (
                <div className={styles.row}>
                  <span className={styles.rowIcon} aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="6" width="12" height="12" rx="3" />
                      <path d="M15 10l6-3v10l-6-3z" />
                    </svg>
                  </span>
                  <div className={styles.stack}>
                    <span className={styles.srOnly}>{t('schedule.recordings')}</span>
                    {existingMeeting.recordings.map((r: any) => (
                      <div key={r.id} className={styles.recordingCard}>
                        <span className={styles.recordingThumb} aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </span>
                        <div className={styles.recordingText}>
                          <div className={styles.recordingTitle}>{t('schedule.meetingRecording')}</div>
                          <div className={styles.recordingMeta}>{r.durationSeconds ? `${Math.floor(r.durationSeconds / 60)} mins ${r.durationSeconds % 60} secs` : 'Processing...'}</div>
                        </div>
                        {r.status === 'READY' && r.shareKey && (
                          <a href={`/recordings/${encodeURIComponent(r.shareKey)}`} target="_blank" rel="noreferrer" className={styles.btnOutlineSmall}>{t('common.view')}</a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {existingMeeting && (
                <div className={styles.dangerZone}>
                  {!isFinished && !isCanceled && (
                    <button type="button" className={styles.btnDanger} onClick={handleCancelMeeting} disabled={isSaving}>
                      {tf('schedule.cancelMeeting', 'Cancel meeting')}
                    </button>
                  )}
                  <button type="button" className={styles.btnDanger} onClick={handleDeleteMeeting} disabled={isSaving}>
                    {t('dash.deleteMeeting')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tab Content: Automated Emails */}
          {!savedMeeting && activeTab === 'emails' && (
            <div className={styles.content}>
              <div style={{ background: '#eef2ff', color: '#4f46e5', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '0.5rem', fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                </svg>
                {t('schedule.enterpriseOnly')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                
                {/* Invitation Email */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <input
                      type="checkbox"
                      checked={inviteEmails}
                      disabled={isReadOnly}
                      onChange={(e) => {
                        setInviteEmails(e.target.checked);
                        setInvitesTouched(true);
                      }}
                      aria-label={t('schedule.invitationEmail')}
                      style={{ width: '18px', height: '18px', accentColor: '#4f46e5' }}
                    />
                    <span style={{ fontSize: '0.95rem', color: '#4b5563' }}>{t('schedule.invitationEmail')}</span>
                    <button type="button" className={styles.linkBtn} style={{ color: '#3b82f6', fontWeight: 500, paddingLeft: '2rem' }} onClick={() => setSubModal('invite')}>{t('common.view')}</button>
                  </div>
                  <p style={{ margin: '0.4rem 0 0 2.25rem', fontSize: '0.85rem', color: '#6b7280' }}>
                    {attendees.length > 0
                      ? tf('schedule.inviteRecipients', 'Sent to {n} attendee(s) when you save.', { n: attendees.length })
                      : tf('schedule.inviteNoRecipients', 'No attendees yet.')}{' '}
                    {!isReadOnly && (
                      <button type="button" className={styles.linkBtn} style={{ display: 'inline', padding: 0, fontSize: 'inherit' }} onClick={() => setActiveTab('ai')}>
                        {t('schedule.addAttendee')}
                      </button>
                    )}
                  </p>
                </div>

                {/* Reminder Email */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <input
                      type="checkbox"
                      checked={reminderEmails}
                      disabled={isReadOnly}
                      onChange={(e) => {
                        setReminderEmails(e.target.checked);
                        setInvitesTouched(true);
                      }}
                      aria-label={t('schedule.reminderEmail')}
                      style={{ width: '18px', height: '18px', accentColor: '#4f46e5' }}
                    />
                    <span style={{ fontSize: '0.95rem', color: '#4b5563' }}>{t('schedule.reminderEmail')}</span>
                    <button type="button" className={styles.linkBtn} style={{ color: '#3b82f6', fontWeight: 500, paddingLeft: '1.9rem' }} onClick={() => setSubModal('reminder')}>{t('common.view')}</button>
                  </div>

                  <div style={{ marginLeft: '2.25rem', marginTop: '1rem', opacity: reminderEmails ? 1 : 0.5 }}>
                    <p style={{ fontSize: '0.95rem', color: '#374151', margin: '0 0 1rem 0', fontWeight: 600 }}>{t('schedule.sendBefore')}</p>

                    {reminders.map((row, index) => (
                      <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                        <select
                          className={`${styles.input} ${styles.select}`}
                          style={{ width: '80px', padding: '0.5rem' }}
                          value={row.amount}
                          disabled={isReadOnly || !reminderEmails}
                          aria-label={t('schedule.sendBefore')}
                          onChange={(e) =>
                            updateReminders(reminders.map((r, i) => (i === index ? { ...r, amount: Number(e.target.value) } : r)))
                          }
                        >
                          {Array.from(new Set([...REMINDER_AMOUNTS[row.unit], row.amount]))
                            .sort((x, y) => x - y)
                            .map((n) => (
                              <option key={n} value={n}>{n}</option>
                            ))}
                        </select>
                        <select
                          className={`${styles.input} ${styles.select}`}
                          style={{ width: '130px', padding: '0.5rem' }}
                          value={row.unit}
                          disabled={isReadOnly || !reminderEmails}
                          aria-label={`${t('schedule.hours')} / ${t('schedule.days')}`}
                          onChange={(e) => {
                            const unit = e.target.value as ReminderUnit;
                            const amount = REMINDER_AMOUNTS[unit].includes(row.amount) ? row.amount : 1;
                            updateReminders(reminders.map((r, i) => (i === index ? { amount, unit } : r)));
                          }}
                        >
                          <option value="hours">{t('schedule.hours')}</option>
                          <option value="days">{t('schedule.days')}</option>
                        </select>
                        <button
                          type="button"
                          aria-label={tf('schedule.removeReminder', 'Remove reminder')}
                          title={tf('schedule.removeReminder', 'Remove reminder')}
                          disabled={isReadOnly || !reminderEmails}
                          onClick={() => updateReminders(reminders.filter((_, i) => i !== index))}
                          style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.5rem', display: 'flex', alignItems: 'center' }}
                        >×</button>
                      </div>
                    ))}

                    {reminders.length < MAX_REMINDERS && (
                      <button
                        type="button"
                        className={styles.linkBtn}
                        disabled={isReadOnly || !reminderEmails}
                        onClick={() => {
                          const used = rowsToOffsets(reminders);
                          const next =
                            [60, 120, 1440, 240, 2880].find((m) => !used.includes(m)) ?? 180;
                          updateReminders([...reminders, ...offsetsToRows([next])]);
                        }}
                        style={{ marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                          <line x1="12" y1="5" x2="12" y2="19"></line>
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        {t('schedule.addReminder')}
                      </button>
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* Tab Content: AI Assistant */}
          {!savedMeeting && activeTab === 'ai' && (
            <div className={styles.content}>
              <div style={{ background: '#eef2ff', color: '#4f46e5', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                </svg>
                {t('schedule.enterpriseOnly')}
              </div>
              
              <div className={styles.formRow}>
                <label className={styles.label}>{t('schedule.aiAssistant')}</label>
                <div className={styles.inputWrapper}>
                  <button className={styles.addBtn}>{t('common.add')}</button>
                </div>
              </div>

              <div className={styles.formRow}>
                <label className={styles.label}>{t('schedule.attendee')}</label>
                <div className={styles.inputWrapper}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {/* Host User block */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', padding: '0.4rem 0.75rem', borderRadius: '24px', border: '1px solid #e2e8f0' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg viewBox="0 0 24 24" fill="#9ca3af" width="16" height="16">
                          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                        </svg>
                      </div>
                      <div style={{ fontSize: '0.85rem', lineHeight: '1.2' }}>
                        <strong style={{ color: '#111827' }}>{t('schedule.hostUser')}</strong>
                      </div>
                    </div>
                    
                    {attendees.map((email) => (
                      <span
                        key={email}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#eef2ff', color: '#3730a3', padding: '0.35rem 0.4rem 0.35rem 0.75rem', borderRadius: '24px', border: '1px solid #e0e7ff', fontSize: '0.85rem' }}
                      >
                        {email}
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={() => removeAttendee(email)}
                            aria-label={`${tf('schedule.removeAttendee', 'Remove')} ${email}`}
                            title={tf('schedule.removeAttendee', 'Remove')}
                            style={{ width: '22px', height: '22px', borderRadius: '50%', border: 'none', background: 'transparent', color: '#6366f1', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >×</button>
                        )}
                      </span>
                    ))}
                  </div>
                  {!isReadOnly && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem' }}>
                      <input
                        type="email"
                        className={styles.input}
                        style={{ maxWidth: '300px' }}
                        placeholder={tf('schedule.attendeePlaceholder', 'name@company.com')}
                        aria-label={t('schedule.addAttendee')}
                        aria-invalid={attendeeError ? true : undefined}
                        value={attendeeDraft}
                        onChange={(e) => {
                          setAttendeeDraft(e.target.value);
                          if (attendeeError) setAttendeeError('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
                            e.preventDefault();
                            addAttendees(attendeeDraft);
                          } else if (e.key === 'Backspace' && !attendeeDraft && attendees.length > 0) {
                            removeAttendee(attendees[attendees.length - 1]);
                          }
                        }}
                        onBlur={() => {
                          if (attendeeDraft.trim()) addAttendees(attendeeDraft);
                        }}
                      />
                      <button
                        type="button"
                        className={styles.addBtn}
                        style={{ borderRadius: '50%', width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                        title={t('schedule.addAttendee')}
                        aria-label={t('schedule.addAttendee')}
                        onClick={() => addAttendees(attendeeDraft)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                          <line x1="12" y1="5" x2="12" y2="19"></line>
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                      </button>
                    </div>
                  )}
                  {attendeeError && (
                    <p role="alert" style={{ color: '#dc2626', fontSize: '0.85rem', margin: '0.4rem 0 0' }}>{attendeeError}</p>
                  )}
                  <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
                    {tf('schedule.attendeeHint', 'Attendees get the invitation and reminder emails set in the Emails tab.')}
                  </p>
                </div>
              </div>

              <div className={styles.formRow}>
                <label className={styles.label}>{t('schedule.occurrence')}</label>
                <div className={styles.inputWrapper}>
                  <select className={`${styles.input} ${styles.select}`} style={{ maxWidth: '300px' }}>
                    <option>{t('schedule.oneTime')}</option>
                    <option>{t('schedule.daily')}</option>
                    <option>{t('schedule.weekly')}</option>
                  </select>
                </div>
              </div>

            </div>
          )}

          {/* Tab Content: Linked Event */}
          {!savedMeeting && activeTab === 'linked' && (
            <div className={styles.content} style={{ minHeight: '300px', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
              <div style={{ background: '#eef2ff', color: '#4f46e5', padding: '0.5rem 1rem', borderRadius: '8px', marginBottom: '2rem', fontSize: '0.9rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                </svg>
                {t('schedule.enterpriseOnly')}
              </div>
              <div style={{ width: '72px', height: '72px', background: '#f8fafc', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem', border: '1px solid #e2e8f0' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" width="36" height="36">
                  <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 style={{ fontSize: '1.25rem', color: '#111827', margin: '0 0 1rem 0' }}>{t('schedule.workflowTitle')}</h3>
              <p style={{ color: '#4b5563', fontSize: '1rem', maxWidth: '500px', lineHeight: '1.6' }}>
                {t('schedule.workflowDesc')}
              </p>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Sub Modals for Emails */}
      {subModal && (() => {
        const tz = timezone || getUserTimezone();
        let scheduledFor = new Date();
        try {
          scheduledFor = new Date(zonedDateTimeToUtcIso(date, time, tz));
        } catch {}
        const preview = {
          roomName: existingMeeting?.roomName || 'meeting-id',
          title,
          description,
          scheduledFor,
          durationMinutes: durationMinutesFrom(durationStr),
          timezone: tz,
          hostName: hostDisplayName(existingMeeting),
        };
        const to = attendees[0] || 'attendee@example.com';
        const mail =
          subModal === 'invite'
            ? invitationEmail(to, preview, window.location.origin, 'new')
            : reminderEmail(to, preview, window.location.origin, rowsToOffsets(reminders)[0] ?? DEFAULT_REMINDER_OFFSETS[0]);
        return (
          <EmailPreviewModal
            type={subModal === 'invite' ? t('schedule.invitationEmail') : t('schedule.reminderEmail')}
            title={mail.subject}
            body={
              <iframe
                title={mail.subject}
                srcDoc={mail.html}
                sandbox=""
                style={{ width: '100%', height: '340px', border: 0, background: '#fff', borderRadius: '4px' }}
              />
            }
            onClose={() => setSubModal(null)}
          />
        );
      })()}
    </>
  );
}

function CalendarGlyph({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

function DownloadGlyph({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
    </svg>
  );
}

function EmailPreviewModal({ type, title, body, onClose }: any) {
  const { t } = useI18n();
  return (
    <div className={styles.overlay} style={{ zIndex: 10000 }}>
      <div className={styles.modal} style={{ maxWidth: '650px', padding: '2.5rem' }}>
        <h2 style={{ margin: '0 0 2rem 0', color: '#1e1e2e', fontSize: '1.5rem', fontWeight: 600 }}>{type}</h2>
        
        <div style={{ marginBottom: '2rem' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1.05rem', color: '#374151' }}>{t('schedule.emailTitle')}</h4>
          <p style={{ margin: 0, color: '#4b5563', fontSize: '1rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>{title}</p>
        </div>

        <div style={{ marginBottom: '3rem' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1.05rem', color: '#374151' }}>{t('schedule.emailBody')}</h4>
          <div style={{ color: '#4b5563', fontSize: '1rem', lineHeight: '1.7', padding: '1rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
            {body}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
          <button className={styles.btnSolid} style={{ background: '#4f46e5' }}>{t('common.reset')}</button>
          <button className={styles.btnSolid} style={{ background: '#4338ca' }}>{t('common.edit')}</button>
          <button className={styles.btnOutline} onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
