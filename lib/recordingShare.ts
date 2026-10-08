import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { Recording } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  canAccessRecording,
  canManageRecording,
  forbidden,
  isAuthError,
  requireSession,
} from '@/lib/apiAuth';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';

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
 * PUBLIC: anyone with the key.
 * PRIVATE: logged-in member who can access the recording.
 */
export async function authorizeRecordingView(
  req: NextRequest,
  recording: Recording,
): Promise<NextResponse | { memberId: number | null }> {
  if (recording.deletedAt) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  }

  if (recording.visibility === 'PUBLIC') {
    const member = await getSessionTeamMember(req);
    return { memberId: member?.id ?? null };
  }

  const member = await requireSession(req);
  if (isAuthError(member)) return member;

  const allowed = await canAccessRecording(member.id, recording);
  if (!allowed) return forbidden('You do not have access to this recording');
  return { memberId: member.id };
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

export function isRecordingResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
