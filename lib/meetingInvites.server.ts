/**
 * Database side of attendees, invitation and reminder emails (see lib/meetingInvites.ts).
 * Migration: prisma/add_meeting_invitees.sql. Reminders are sent by /api/cron/meeting-reminders.
 */
import { prisma } from './db';
import { sendMail } from './mail';
import { toCalendarMeeting } from './calendar/server';
import { isCanceledStatus } from './calendar/ics';
import { ensureInviteJoinTokens, inviteJoinUrl } from './meetingInviteLinks';
import {
  MAX_REMINDER_MINUTES,
  cancellationEmail,
  dueReminderOffsets,
  invitationEmail,
  joinNowEmail,
  normalizeEmails,
  parseReminderOffsets,
  reminderEmail,
} from './meetingInvites';

export interface InviteSettings {
  emails: string[];
  inviteEmails: boolean;
  reminderEmails: boolean;
  reminderOffsets: number[];
}

const hostSelect = { select: { fullName: true, username: true, email: true } } as const;

/** Statuses after which no invitation or reminder goes out (scheduled meetings are ACTIVE). */
function isClosed(status: string | null | undefined): boolean {
  return (status || '').toUpperCase() === 'ENDED' || isCanceledStatus(status);
}

export async function getInviteSettings(meetingId: number): Promise<InviteSettings> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      inviteEmails: true,
      reminderEmails: true,
      reminderOffsets: true,
      invitees: { select: { email: true }, orderBy: { id: 'asc' } },
    },
  });
  if (!meeting) return { emails: [], inviteEmails: true, reminderEmails: true, reminderOffsets: parseReminderOffsets(null) };
  return {
    emails: meeting.invitees.map((i) => i.email),
    inviteEmails: meeting.inviteEmails,
    reminderEmails: meeting.reminderEmails,
    reminderOffsets: parseReminderOffsets(meeting.reminderOffsets),
  };
}

/**
 * Save the attendee list and email settings, then send invitations: to attendees not invited
 * yet, and an "updated" email to those invited for a different start time.
 */
export async function saveInviteSettings(
  meetingId: number,
  input: {
    emails?: unknown;
    inviteEmails?: unknown;
    reminderEmails?: unknown;
    reminderOffsets?: unknown;
    /** Pre-join invite box: email attendees who haven't been invited a "join now" link. */
    notifyNow?: unknown;
  },
  origin: string,
): Promise<InviteSettings & { sent: number; failed: string[] }> {
  const data: { inviteEmails?: boolean; reminderEmails?: boolean; reminderOffsets?: number[] } = {};
  if (typeof input.inviteEmails === 'boolean') data.inviteEmails = input.inviteEmails;
  if (typeof input.reminderEmails === 'boolean') data.reminderEmails = input.reminderEmails;
  if (input.reminderOffsets !== undefined) data.reminderOffsets = parseReminderOffsets(input.reminderOffsets);
  if (Object.keys(data).length > 0) await prisma.meeting.update({ where: { id: meetingId }, data });

  if (input.emails !== undefined) {
    const emails = normalizeEmails(input.emails);
    await prisma.$transaction([
      prisma.meetingInvitee.deleteMany({ where: { meetingId, email: { notIn: emails } } }),
      prisma.meetingInvitee.createMany({
        data: emails.map((email) => ({ meetingId, email })),
        skipDuplicates: true,
      }),
    ]);
    await ensureInviteJoinTokens(meetingId);
  }

  const result =
    input.notifyNow === true
      ? await sendJoinNowInvitations(meetingId, origin)
      : await sendPendingInvitations(meetingId, origin);
  return { ...(await getInviteSettings(meetingId)), ...result };
}

/** Pre-join invite box: a meeting starting now. Emails attendees not invited yet, once each. */
async function sendJoinNowInvitations(meetingId: number, origin: string): Promise<{ sent: number; failed: string[] }> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { invitees: { where: { invitedAt: null } }, createdByMember: hostSelect },
  });
  const failed: string[] = [];
  if (!meeting || meeting.deletedAt || isClosed(meeting.status)) return { sent: 0, failed };
  const hostName = meeting.createdByMember?.fullName || meeting.createdByMember?.username || null;
  let sent = 0;
  for (const invitee of meeting.invitees) {
    const joinUrl = inviteJoinUrl(origin, meeting.roomName, invitee.joinToken);
    const result = await sendMail(joinNowEmail(invitee.email, { title: meeting.title, roomName: meeting.roomName, hostName }, joinUrl));
    if (!result.ok) {
      failed.push(invitee.email);
      continue;
    }
    sent += 1;
    await prisma.meetingInvitee.update({ where: { id: invitee.id }, data: { invitedAt: new Date() } });
  }
  return { sent, failed };
}

async function sendPendingInvitations(meetingId: number, origin: string): Promise<{ sent: number; failed: string[] }> {
  await ensureInviteJoinTokens(meetingId);
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { invitees: true, createdByMember: hostSelect },
  });
  const failed: string[] = [];
  if (!meeting || meeting.deletedAt || !meeting.inviteEmails || !meeting.scheduledFor) return { sent: 0, failed };
  if (isClosed(meeting.status) || meeting.scheduledFor.getTime() <= Date.now()) return { sent: 0, failed };

  const scheduledFor = meeting.scheduledFor;
  const calendar = { ...toCalendarMeeting({ ...meeting, scheduledFor }), scheduledFor };
  let sent = 0;
  for (const invitee of meeting.invitees) {
    if (invitee.invitedFor && invitee.invitedFor.getTime() === scheduledFor.getTime()) continue;
    const kind = invitee.invitedAt ? 'updated' : 'new';
    const joinUrl = inviteJoinUrl(origin, meeting.roomName, invitee.joinToken);
    const result = await sendMail(invitationEmail(invitee.email, calendar, origin, kind, joinUrl));
    if (!result.ok) {
      failed.push(invitee.email);
      continue;
    }
    sent += 1;
    await prisma.meetingInvitee.update({
      where: { id: invitee.id },
      data: { invitedAt: new Date(), invitedFor: scheduledFor },
    });
  }
  return { sent, failed };
}

/**
 * After the host cancels or deletes the meeting: tell every attendee who received an invitation. Skipped for
 * meetings whose start time has passed (nothing left to cancel for them).
 */
export async function sendCancellationEmails(meetingId: number, origin: string): Promise<{ sent: number; failed: string[] }> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { invitees: { where: { invitedAt: { not: null } } }, createdByMember: hostSelect },
  });
  const failed: string[] = [];
  if (!meeting?.scheduledFor || meeting.scheduledFor.getTime() <= Date.now()) return { sent: 0, failed };
  const scheduledFor = meeting.scheduledFor;
  const calendar = { ...toCalendarMeeting({ ...meeting, scheduledFor }), scheduledFor };
  let sent = 0;
  for (const invitee of meeting.invitees) {
    const result = await sendMail(cancellationEmail(invitee.email, calendar, origin));
    if (result.ok) sent += 1;
    else failed.push(invitee.email);
  }
  return { sent, failed };
}

/** Called by the cron: send every reminder that is due, to the attendees and the host. */
export async function sendDueReminders(origin: string, now = new Date()): Promise<{ meetings: number; emails: number }> {
  const meetings = await prisma.meeting.findMany({
    where: {
      reminderEmails: true,
      deletedAt: null,
      scheduledFor: { gt: now, lte: new Date(now.getTime() + MAX_REMINDER_MINUTES * 60000) },
      invitees: { some: {} },
    },
    include: { invitees: true, reminderLogs: true, createdByMember: hostSelect },
  });

  let meetingCount = 0;
  let emails = 0;
  for (const meeting of meetings) {
    const scheduledFor = meeting.scheduledFor;
    if (!scheduledFor || isClosed(meeting.status)) continue;
    const offsets = parseReminderOffsets(meeting.reminderOffsets);
    const sent = meeting.reminderLogs
      .filter((log) => log.scheduledFor.getTime() === scheduledFor.getTime())
      .map((log) => log.offsetMinutes);
    const due = dueReminderOffsets({
      now,
      scheduledFor,
      // A rescheduled meeting counts from the edit, so a reminder that was already past isn't sent.
      createdAt: meeting.modifiedAt ?? meeting.createdAt,
      offsets,
      sent,
    });
    if (due.length === 0) continue;

    const calendar = { ...toCalendarMeeting({ ...meeting, scheduledFor }), scheduledFor };
    const recipients = normalizeEmails([...meeting.invitees.map((i) => i.email), meeting.createdByMember?.email]);
    // Attendees get their own join link; the host the plain one.
    if (meeting.invitees.some((i) => !i.joinToken)) {
      await ensureInviteJoinTokens(meeting.id);
      meeting.invitees = await prisma.meetingInvitee.findMany({ where: { meetingId: meeting.id } });
    }
    const tokenByEmail = new Map(meeting.invitees.map((i) => [i.email.toLowerCase(), i.joinToken]));
    for (const offsetMinutes of due) {
      // Log first: the unique key stops a second cron run from sending the same reminder.
      try {
        await prisma.meetingReminderLog.create({ data: { meetingId: meeting.id, offsetMinutes, scheduledFor } });
      } catch {
        continue;
      }
      meetingCount += 1;
      for (const to of recipients) {
        const joinUrl = inviteJoinUrl(origin, meeting.roomName, tokenByEmail.get(to) ?? null);
        const result = await sendMail(reminderEmail(to, calendar, origin, offsetMinutes, joinUrl));
        if (result.ok) emails += 1;
        else console.error(`[meeting-reminders] ${meeting.roomName}: send failed (${result.provider})`);
      }
    }
  }
  return { meetings: meetingCount, emails };
}
