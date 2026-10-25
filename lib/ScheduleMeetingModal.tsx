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

/** AI assistant / repeat / linked events (enterprise features; shown under "More options" — not saved yet). */
const SHOW_ENTERPRISE_OPTIONS = true;

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

/** "GMT+09:00" */
function gmtOffsetLabel(timezone: string): string {
  const offset = getTimezoneOffsetMinutes(timezone, new Date());
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `GMT${sign}${hh}:${mm}`;
}

function formatTimezoneLabel(timezone: string): string {
  return `(${gmtOffsetLabel(timezone)}) ${timezone}`;
}

/** "Korean Standard Time (GMT+09:00)", in the UI language when the browser knows the zone's name. */
function friendlyTimezone(timezone: string, locale: string): string {
  let name = timezone;
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone: timezone, timeZoneName: 'long' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    if (part?.value && !/^GMT/.test(part.value)) name = part.value;
  } catch {}
  return `${name} (${gmtOffsetLabel(timezone)})`;
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
/** Every offset the "+ Add" menu offers, in minutes, nearest first. */
const REMINDER_CHOICES = [
  ...REMINDER_AMOUNTS.hours.map((n) => n * 60),
  ...REMINDER_AMOUNTS.days.map((n) => n * 1440),
];

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

const QUICK_DURATIONS = [30, 45, 60];
const DURATION_CHOICES = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420];

/** "14:00" + 45 → "14:45"; past midnight gets "(+1)". */
function endTimeFrom(time: string, minutes: number): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return '';
  const total = Number(match[1]) * 60 + Number(match[2]) + minutes;
  const days = Math.floor(total / 1440);
  const rest = total % 1440;
  const text = `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`;
  return days > 0 ? `${text} (+${days})` : text;
}

export function ScheduleMeetingModal({ user, existingMeeting, onClose, onSave }: ScheduleMeetingModalProps) {
  const { t, locale } = useI18n();
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
  const attendeeInputRef = useRef<HTMLInputElement | null>(null);
  const [showTimezone, setShowTimezone] = useState(false);
  const [showMore, setShowMore] = useState(false);
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
  const [durationMinutes, setDurationMinutes] = useState<number>(
    Number(existingMeeting?.durationMinutes) > 0 ? Number(existingMeeting.durationMinutes) : 30,
  );

  const [isSaving, setIsSaving] = useState(false);

  const isFinished = existingMeeting?.status === 'ENDED' || existingMeeting?.status === 'FINISHED';
  const isCanceled = existingMeeting?.status === 'CANCELED';
  const isReadOnly = isFinished || isCanceled;
  const recording = readyRecording(existingMeeting);
  const [recordingVisibility, setRecordingVisibility] = useState<RecordingVisibility>(
    recording?.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
  );

  // Attendees and invitation / reminder emails; saved after the meeting.
  const [attendees, setAttendees] = useState<string[]>([]);
  /** Attendees as loaded, to tell whether saving will email anyone. */
  const [savedAttendees, setSavedAttendees] = useState<string[]>([]);
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
        const emails = Array.isArray(data.emails) ? data.emails : [];
        setAttendees(emails);
        setSavedAttendees(emails);
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
    const upcoming =
      !isReadOnly && !!existingMeeting?.scheduledFor && new Date(existingMeeting.scheduledFor).getTime() > Date.now();
    const notifyLine = upcoming && attendees.length > 0
      ? `\n\n${tf('schedule.cancelNotifyAttendees', 'Attendees who were invited will get a cancellation email.')}`
      : '';
    if (!confirm(`${t('schedule.deleteConfirm')}${notifyLine}`)) return;
    setIsSaving(true);
    try {
      const res = await authFetch(`/api/meetings/${existingMeeting.roomName}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => null);
      const failed: string[] = Array.isArray(data?.cancelNotice?.failed) ? data.cancelNotice.failed : [];
      if (failed.length > 0) alert(tf('schedule.invitesFailed', "Couldn't email: {list}", { list: failed.join(', ') }));
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

  const durationLabel = (minutes: number) =>
    minutes < 60
      ? tf('schedule.minutesShort', '{n} min', { n: minutes })
      : tf('schedule.hoursShort', '{n} h', { n: Number((minutes / 60).toFixed(1)) });
  const reminderLabel = (minutes: number) =>
    minutes % 1440 === 0
      ? tf('schedule.daysBefore', '{n}d before', { n: minutes / 1440 })
      : tf('schedule.hoursBefore', '{n}h before', { n: Math.round(minutes / 60) });

  const reminderOffsets = rowsToOffsets(reminders);
  const sortedReminderOffsets = [...reminderOffsets].sort((a, b) => b - a);
  const freeReminderChoices = REMINDER_CHOICES.filter((m) => !reminderOffsets.includes(m));

  // Mirrors the server: invites go to attendees not yet emailed for this start time, if it's still ahead.
  const startMs = (() => {
    try {
      return new Date(zonedDateTimeToUtcIso(date, time, timezone)).getTime();
    } catch {
      return NaN;
    }
  })();
  const allAttendees = Array.from(new Set([...attendees, ...splitEmails(attendeeDraft).filter(isValidEmail)]));
  const startChanged =
    !!existingMeeting?.scheduledFor &&
    Math.floor(startMs / 60000) !== Math.floor(new Date(existingMeeting.scheduledFor).getTime() / 60000);
  const willSendInvites =
    !isReadOnly &&
    inviteEmails &&
    allAttendees.length > 0 &&
    startMs > Date.now() &&
    (!existingMeeting || startChanged || allAttendees.some((email) => !savedAttendees.includes(email)));

  const visibilityDesc = recordingVisibility === 'PUBLIC' ? t('schedule.publicDesc') : t('schedule.privateDesc');

  const copyGlyph = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 012-2h10" />
    </svg>
  );
  const chevronGlyph = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" width="14" height="14" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );

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
            <h2 id="kloud-schedule-meeting-title" className={styles.title}>
              {savedMeeting
                ? savedKind === 'updated'
                  ? t('calendar.updatedTitle')
                  : t('calendar.scheduledTitle')
                : existingMeeting
                  ? t('schedule.editMeeting')
                  : tf('schedule.scheduleMeeting', 'Schedule meeting')}
            </h2>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={savedMeeting ? onSave : onClose}
              disabled={isSaving}
              aria-label={t('common.close')}
              title={t('common.close')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

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
                    className={`${styles.hint}${inviteResult?.error || inviteResult?.failed.length ? ` ${styles.hintError}` : ''}`}
                    role="status"
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

          {!savedMeeting && (
            <div className={styles.content}>
              {/* Title */}
              <input
                type="text"
                className={styles.titleInput}
                placeholder={t('schedule.titlePlaceholder')}
                aria-label={t('schedule.title')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              {existingMeeting && (
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
              )}

              {/* Time */}
              <div className={styles.row}>
                <svg className={styles.rowIcon} viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                <div className={styles.stack}>
                  <span className={styles.srOnly}>{t('schedule.setTime')}</span>
                  <div className={styles.timeRow}>
                    <input
                      type="date"
                      className={`${styles.field} ${styles.dateField}`}
                      aria-label={tf('schedule.date', 'Date')}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      disabled={isReadOnly}
                    />
                    <span className={styles.timeRange}>
                      <input
                        type="time"
                        className={`${styles.field} ${styles.timeField}`}
                        aria-label={tf('schedule.startTime', 'Start time')}
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        disabled={isReadOnly}
                      />
                      <span className={styles.timeArrow} aria-hidden="true">→</span>
                      <span className={styles.endTime}>{endTimeFrom(time, durationMinutes)}</span>
                    </span>
                    <span className={styles.segmented} role="radiogroup" aria-label={tf('schedule.duration', 'Duration')}>
                      {QUICK_DURATIONS.map((minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          role="radio"
                          aria-checked={durationMinutes === minutes}
                          className={durationMinutes === minutes ? styles.segmentOn : styles.segment}
                          onClick={() => setDurationMinutes(minutes)}
                          disabled={isReadOnly}
                        >
                          {durationLabel(minutes)}
                        </button>
                      ))}
                      <select
                        className={`${styles.segmentSelect}${QUICK_DURATIONS.includes(durationMinutes) ? '' : ` ${styles.segmentSelectOn}`}`}
                        aria-label={tf('schedule.duration', 'Duration')}
                        value={QUICK_DURATIONS.includes(durationMinutes) ? '' : String(durationMinutes)}
                        onChange={(e) => e.target.value && setDurationMinutes(Number(e.target.value))}
                        disabled={isReadOnly}
                      >
                        <option value="" disabled hidden>{tf('schedule.durationMore', 'More')}</option>
                        {Array.from(new Set([...DURATION_CHOICES, durationMinutes]))
                          .sort((a, b) => a - b)
                          .map((minutes) => (
                            <option key={minutes} value={minutes}>{durationLabel(minutes)}</option>
                          ))}
                      </select>
                    </span>
                  </div>
                  {showTimezone ? (
                    <label className={styles.inlineField}>
                      <span className={styles.inlineLabel}>{t('schedule.timeZone')}</span>
                      <select
                        className={`${styles.field} ${styles.select}`}
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
                  ) : (
                    <div className={styles.hint}>
                      {friendlyTimezone(timezone, locale)}
                      {!isReadOnly && (
                        <>
                          {' · '}
                          <button type="button" className={styles.linkBtn} onClick={() => setShowTimezone(true)}>
                            {tf('schedule.changeTimezone', 'Change time zone')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Attendees */}
              <div className={styles.row}>
                <svg className={styles.rowIcon} viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="9" cy="8" r="3.5" />
                  <path d="M2.5 20v-1a6 6 0 0113 0v1M16 4.5a3.5 3.5 0 010 7M21.5 20v-1a6 6 0 00-4-5.6" />
                </svg>
                <div className={styles.stack}>
                  <div
                    className={`${styles.chipField}${attendeeError ? ` ${styles.chipFieldError}` : ''}${isReadOnly ? ` ${styles.chipFieldReadOnly}` : ''}`}
                    onClick={() => attendeeInputRef.current?.focus()}
                  >
                    {attendees.map((email) => (
                      <span key={email} className={styles.chip}>
                        <span className={styles.chipAvatar} aria-hidden="true">{email.charAt(0).toUpperCase()}</span>
                        {email}
                        {!isReadOnly && (
                          <button
                            type="button"
                            className={styles.chipRemove}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeAttendee(email);
                            }}
                            aria-label={`${tf('schedule.removeAttendee', 'Remove')} ${email}`}
                            title={tf('schedule.removeAttendee', 'Remove')}
                          >×</button>
                        )}
                      </span>
                    ))}
                    {!isReadOnly && attendees.length < MAX_INVITEES && (
                      <input
                        ref={attendeeInputRef}
                        type="email"
                        className={styles.chipInput}
                        placeholder={attendees.length === 0 ? tf('schedule.attendeesPlaceholder', 'Add attendee emails, press Enter') : ''}
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
                    )}
                    {isReadOnly && attendees.length === 0 && (
                      <span className={styles.chipPlaceholder}>{tf('schedule.inviteNoRecipients', 'No attendees yet.')}</span>
                    )}
                  </div>
                  {attendeeError ? (
                    <p role="alert" className={`${styles.hint} ${styles.hintError}`}>{attendeeError}</p>
                  ) : (
                    <p className={styles.hint}>
                      {tf('schedule.attendeeHintHost', "You're the host · attendees get the invitation and reminder emails")}
                    </p>
                  )}
                </div>
              </div>

              {/* Invitation and reminder emails */}
              <div className={styles.row}>
                <svg className={styles.rowIcon} viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2.5" />
                  <path d="M3.5 7l8.5 6 8.5-6" />
                </svg>
                <div className={styles.stack}>
                  <div className={styles.toggleLine}>
                    <Switch
                      checked={inviteEmails}
                      disabled={isReadOnly}
                      label={tf('schedule.sendInviteToggle', 'Email the invitation to attendees when you save')}
                      onChange={(next) => {
                        setInviteEmails(next);
                        setInvitesTouched(true);
                      }}
                    />
                    <button type="button" className={styles.linkBtn} onClick={() => setSubModal('invite')}>
                      {tf('schedule.preview', 'Preview')}
                    </button>
                  </div>
                  <div className={styles.toggleLine}>
                    <Switch
                      checked={reminderEmails}
                      disabled={isReadOnly}
                      label={tf('schedule.reminderToggle', 'Reminder before the meeting')}
                      onChange={(next) => {
                        setReminderEmails(next);
                        setInvitesTouched(true);
                      }}
                    />
                    <button type="button" className={styles.linkBtn} onClick={() => setSubModal('reminder')}>
                      {tf('schedule.preview', 'Preview')}
                    </button>
                  </div>
                  {reminderEmails && (
                    <div className={styles.reminderChips}>
                      {sortedReminderOffsets.map((minutes) => (
                        <span key={minutes} className={styles.reminderChip}>
                          {reminderLabel(minutes)}
                          {!isReadOnly && (
                            <button
                              type="button"
                              className={styles.chipRemove}
                              aria-label={`${tf('schedule.removeReminder', 'Remove reminder')} ${reminderLabel(minutes)}`}
                              title={tf('schedule.removeReminder', 'Remove reminder')}
                              onClick={() => updateReminders(offsetsToRows(reminderOffsets.filter((m) => m !== minutes)))}
                            >×</button>
                          )}
                        </span>
                      ))}
                      {!isReadOnly && reminders.length < MAX_REMINDERS && freeReminderChoices.length > 0 && (
                        <span className={styles.addReminder}>
                          <span aria-hidden="true">+ {tf('schedule.addReminderShort', 'Add')}</span>
                          <select
                            aria-label={t('schedule.addReminder')}
                            value=""
                            onChange={(e) => {
                              const minutes = Number(e.target.value);
                              if (minutes) updateReminders(offsetsToRows([...reminderOffsets, minutes]));
                            }}
                          >
                            <option value="" disabled hidden>{t('schedule.addReminder')}</option>
                            {freeReminderChoices.map((minutes) => (
                              <option key={minutes} value={minutes}>{reminderLabel(minutes)}</option>
                            ))}
                          </select>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              <div className={styles.row}>
                <svg className={styles.rowIcon} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 6h16M4 11h16M4 16h10" />
                </svg>
                <textarea
                  className={`${styles.field} ${styles.textarea}`}
                  placeholder={tf('schedule.descOptional', 'Add an agenda or notes (optional)')}
                  aria-label={t('schedule.description')}
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {/* Recording replay visibility */}
              <div className={styles.row}>
                <svg className={styles.rowIcon} viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V8a4 4 0 018 0v3" />
                </svg>
                <div className={styles.stack}>
                  <div className={styles.toggleLine}>
                    <span className={styles.fieldLabel} id="kloud-schedule-access-label">
                      {tf('schedule.replayAccess', 'Replay')}
                    </span>
                    <span className={styles.segmented} role="radiogroup" aria-labelledby="kloud-schedule-access-label">
                      {(['PRIVATE', 'PUBLIC'] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={recordingVisibility === value}
                          className={recordingVisibility === value ? styles.segmentOn : styles.segment}
                          onClick={() => setRecordingVisibility(value)}
                          disabled={!recording?.shareKey}
                        >
                          {value === 'PRIVATE' ? t('schedule.private') : t('schedule.public')}
                        </button>
                      ))}
                    </span>
                  </div>
                  <p className={styles.hint}>
                    {visibilityDesc}
                    {!recording?.shareKey && ` ${tf('schedule.accessNeedsRecording', 'You can change this once a recording is ready.')}`}
                  </p>
                </div>
              </div>

              {isFinished && existingMeeting?.recordings && existingMeeting.recordings.length > 0 && (
                <div className={styles.row}>
                  <svg className={styles.rowIcon} viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="6" width="12" height="12" rx="3" />
                    <path d="M15 10l6-3v10l-6-3z" />
                  </svg>
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

              {/* Enterprise options — shown as before, not saved yet. */}
              {SHOW_ENTERPRISE_OPTIONS && (
                <div className={styles.moreSection}>
                  <button
                    type="button"
                    className={styles.moreToggle}
                    aria-expanded={showMore}
                    onClick={() => setShowMore((prev) => !prev)}
                  >
                    <svg className={showMore ? styles.moreChevronOpen : styles.moreChevron} viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                    {tf('schedule.moreOptions', 'More options: AI assistant, repeat, linked events')}
                    <span className={styles.badge}>{tf('schedule.enterpriseBadge', 'Enterprise')}</span>
                  </button>
                  {showMore && (
                    <div className={styles.morePanel}>
                      <div className={styles.moreRow}>
                        <span className={styles.fieldLabel}>{t('schedule.aiAssistant')}</span>
                        <button type="button" className={styles.btnOutlineSmall}>{t('common.add')}</button>
                      </div>
                      <div className={styles.moreRow}>
                        <span className={styles.fieldLabel}>{t('schedule.occurrence')}</span>
                        <select className={`${styles.field} ${styles.select} ${styles.moreSelect}`} aria-label={t('schedule.occurrence')}>
                          <option>{t('schedule.oneTime')}</option>
                          <option>{t('schedule.daily')}</option>
                          <option>{t('schedule.weekly')}</option>
                        </select>
                      </div>
                      <div className={styles.moreRow}>
                        <span className={styles.fieldLabel}>{t('schedule.linkedEvents')}</span>
                        <span className={styles.hint}>
                          <strong className={styles.moreStrong}>{t('schedule.workflowTitle')}</strong> · {t('schedule.workflowDesc')}
                        </span>
                      </div>
                    </div>
                  )}
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
          </div>

          {/* Footer */}
          <div className={styles.footer}>
            {savedMeeting ? (
              <>
                <button type="button" className={styles.btnGhost} onClick={() => copyMeetingInvite(savedMeeting)}>
                  {copyGlyph}
                  {t('schedule.copyInvite')}
                </button>
                <span className={styles.footerSpacer} />
                <button type="button" className={styles.btnSolid} onClick={onSave}>
                  {t('calendar.done')}
                </button>
              </>
            ) : (
              <>
                {existingMeeting && !isCanceled && (
                  <div ref={inviteMenuRef} className={styles.menuAnchor}>
                    <button
                      className={styles.btnGhost}
                      onClick={() => {
                        setShowCalendarMenu(false);
                        setShowInviteMenu((prev) => !prev);
                      }}
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={showInviteMenu}
                      aria-label={t('schedule.copyInvite')}
                    >
                      {copyGlyph}
                      <span className={styles.hideNarrow}>{t('schedule.copyInvite')}</span>
                      {chevronGlyph}
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
                {existingMeeting && calendarItemsFor(existingMeeting).length > 0 && (
                  <div ref={calendarMenuRef} className={styles.menuAnchor}>
                    <button
                      className={styles.btnGhost}
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
                      {chevronGlyph}
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
                <span className={styles.footerSpacer} />
                <button type="button" className={styles.btnOutline} onClick={onClose} disabled={isSaving}>
                  {t('common.cancel')}
                </button>
                <button type="button" className={styles.btnSolid} onClick={handleSave} disabled={isSaving}>
                  {willSendInvites && !isSaving && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" aria-hidden="true">
                      <path d="M4 12l16-8-6 16-2.5-6.5z" />
                    </svg>
                  )}
                  {isSaving
                    ? t('common.saving')
                    : willSendInvites
                      ? tf('schedule.saveAndSend', 'Save & send invites')
                      : t('common.save')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Email previews */}
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
          durationMinutes,
          timezone: tz,
          hostName: hostDisplayName(existingMeeting),
        };
        const to = attendees[0] || 'attendee@example.com';
        const mail =
          subModal === 'invite'
            ? invitationEmail(to, preview, window.location.origin, 'new')
            : reminderEmail(to, preview, window.location.origin, sortedReminderOffsets[0] ?? DEFAULT_REMINDER_OFFSETS[0]);
        return (
          <EmailPreviewModal
            type={subModal === 'invite' ? t('schedule.invitationEmail') : t('schedule.reminderEmail')}
            title={mail.subject}
            body={
              <iframe
                title={mail.subject}
                srcDoc={mail.html}
                sandbox=""
                className={styles.previewFrame}
              />
            }
            onClose={() => setSubModal(null)}
          />
        );
      })()}
    </>
  );
}

function Switch({ checked, disabled, label, onChange }: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className={`${styles.switchLabel}${disabled ? ` ${styles.switchLabelDisabled}` : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={checked ? styles.switchOn : styles.switch}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
      <span>{label}</span>
    </label>
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
      <div className={`${styles.modal} ${styles.previewModal}`} role="dialog" aria-modal="true" aria-label={type}>
        <div className={styles.header}>
          <h2 className={styles.title}>{type}</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label={t('common.close')} title={t('common.close')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className={styles.bodyScroll}>
          <div className={styles.previewBody}>
            <div className={styles.fieldLabel}>{t('schedule.emailTitle')}</div>
            <p className={styles.previewSubject}>{title}</p>
            <div className={styles.fieldLabel}>{t('schedule.emailBody')}</div>
            <div className={styles.previewMail}>{body}</div>
          </div>
        </div>
        <div className={styles.footer}>
          <span className={styles.footerSpacer} />
          <button type="button" className={styles.btnGhost}>{t('common.reset')}</button>
          <button type="button" className={styles.btnOutline}>{t('common.edit')}</button>
          <button type="button" className={styles.btnSolid} onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
