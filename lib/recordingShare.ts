import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { Recording } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  canManageRecording,
  forbidden,
  isAuthError,
  requireSession,
  unauthorized,
} from '@/lib/apiAuth';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { evaluateRecordingView } from '@/lib/meetingAccess.server';

export type RecordingVisibility = 'PRIVATE' | 'PUBLIC';

const NUMERIC_KEY = /^\d+$/;

export function newShareKey(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function isRecordingVisibility(value: unknown): value is RecordingVisibility {
  return value === 'PRIVATE' || value === 'PUBLIC';
}

export function readVisibility(body: unknown): RecordingVisibility | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = Reflect.get(body, 'visibility');
  return isRecordingVisibility(value) ? value : null;
}

export async function findRecordingByKey(key: string): Promise<Recording | null> {
  if (NUMERIC_KEY.test(key)) {
    const id = Number(key);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return prisma.recording.findUnique({ where: { id } });
  }
  return prisma.recording.findUnique({ where: { shareKey: key } });
}

export async function ensureShareKey(recording: {
  id: number;
  shareKey: string | null;
}): Promise<string> {
  if (recording.shareKey) return recording.shareKey;
  const shareKey = newShareKey();
  await prisma.recording.update({
    where: { id: recording.id },
    data: { shareKey },
  });
  return shareKey;
}

export async function fillShareKeys<T extends { id: number; shareKey: string | null }>(
  rows: T[],
): Promise<T[]> {
  const missing = rows.filter((row) => !row.shareKey);
  if (missing.length === 0) return rows;

  const assigned = new Map<number, string>();
  for (const row of missing) {
    assigned.set(row.id, await ensureShareKey(row));
  }

  return rows.map((row) => {
    const shareKey = assigned.get(row.id);
    return shareKey ? { ...row, shareKey } : row;
  });
}

export function recordingSharePayload(recording: { shareKey: string; visibility: string }) {
  return {
    shareKey: recording.shareKey,
    visibility: recording.visibility,
    sharePath: `/recordings/${recording.shareKey}`,
  };
}

/**
 * Who may watch follows the meeting's access level (lib/meetingAccess.ts → decideRecordingView):
 * PUBLIC recordings (the host's "Anyone with the link") and Public meetings: anyone.
 * Otherwise sign in; then attendees, the recorder and host; for Protected meetings also the
 * company and invitees; everyone else asks the host (Private: attendees only).
 * 403 bodies carry `code` (REQUEST_ACCESS | ATTENDEES_ONLY) for the replay page.
 */
export async function authorizeRecordingView(
  req: NextRequest,
  recording: Recording,
): Promise<NextResponse | { memberId: number | null }> {
  if (recording.deletedAt) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  }

  const member = await getSessionTeamMember(req);
  const decision = await evaluateRecordingView(recording, member);
  if (decision.kind === 'watch') return { memberId: member?.id ?? null };
  if (decision.kind === 'sign_in') return unauthorized();

  // The replay page explains why: the meeting's title, host and date (never who attended),
  // and whether this person's request is already waiting.
  const meeting = await prisma.meeting.findUnique({
    where: { id: recording.meetingId },
    select: {
      title: true,
      startedAt: true,
      actualStartedAt: true,
      createdByMember: { select: { fullName: true, username: true } },
    },
  });
  const card = {
    title: meeting?.title ?? null,
    hostName: meeting?.createdByMember?.fullName || meeting?.createdByMember?.username || null,
    date: (meeting?.actualStartedAt ?? meeting?.startedAt ?? recording.createdAt).toISOString(),
  };
  const signedInAs = member?.email ?? null;
  if (decision.kind === 'request') {
    const latest = member?.email
      ? await prisma.recordingAccessRequest.findFirst({
          where: { recordingId: recording.id, meetUser: { email: member.email.trim().toLowerCase() } },
          orderBy: { id: 'desc' },
          select: { status: true },
        })
      : null;
    return NextResponse.json(
      {
        error: 'You do not have access to this recording',
        code: 'REQUEST_ACCESS',
        requestStatus: latest?.status ?? null,
        meeting: card,
        signedInAs,
      },
      { status: 403 },
    );
  }
  return NextResponse.json(
    { error: 'Only people who attended this meeting can watch it', code: 'ATTENDEES_ONLY', meeting: card, signedInAs },
    { status: 403 },
  );
}

export async function loadManagedRecording(
  req: NextRequest,
  key: string,
): Promise<NextResponse | { memberId: number; recording: Recording; shareKey: string }> {
  const member = await requireSession(req);
  if (isAuthError(member)) return member;

  const recording = await findRecordingByKey(key);
  if (!recording || recording.deletedAt) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  }

  const allowed = await canManageRecording(member.id, recording);
  if (!allowed) return forbidden('You cannot change this recording');

  const shareKey = await ensureShareKey(recording);
  return { memberId: member.id, recording: { ...recording, shareKey }, shareKey };
}

/**
 * loadAccessibleRecording — 已登录且能观看该录像的用户（主持、录制者、参会者，或公开链接）。
 * 用于解析字幕；改公开范围仍走 loadManagedRecording。
 */
export async function loadAccessibleRecording(
  req: NextRequest,
  key: string,
): Promise<NextResponse | { memberId: number; recording: Recording; shareKey: string }> {
  const member = await requireSession(req);
  if (isAuthError(member)) return member;

  const recording = await findRecordingByKey(key);
  if (!recording || recording.deletedAt) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  }

  const access = await authorizeRecordingView(req, recording);
  if (isRecordingResponse(access) || access.memberId === null) {
    return isRecordingResponse(access) ? access : unauthorized();
  }

  const shareKey = await ensureShareKey(recording);
  return { memberId: member.id, recording: { ...recording, shareKey }, shareKey };
}

export function isRecordingResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
