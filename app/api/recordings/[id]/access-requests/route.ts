import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { canManageRecording, forbidden, isAuthError, requireSession } from '@/lib/apiAuth';
import { publicOrigin } from '@/lib/calendar/server';
import { sendMail } from '@/lib/mail';
import { ensureShareKey, findRecordingByKey, newShareKey } from '@/lib/recordingShare';
import { recordingReplayPath } from '@/lib/recordingReplayPath';
import { evaluateRecordingView, meetUserIdForEmail } from '@/lib/meetingAccess.server';
import { recordingAnswerEmail, recordingRequestEmail } from '@/lib/recordingAccessEmails';
import { KNOCK_RETRY_AFTER_MS } from '@/lib/meetingAccess';

/**
 * Asking to watch a recording of a Protected meeting (lib/meetingAccess.ts → decideRecordingView).
 * Person asking: POST → { status: PENDING | APPROVED }. The host gets an email.
 * Host / recorder: GET pending requests · PATCH { ids | all, action: approve | deny } (emails the answer).
 */

async function loadRecording(params: Promise<{ id: string }>) {
  const { id } = await params;
  const recording = await findRecordingByKey(id);
  if (!recording || recording.deletedAt) return null;
  return recording;
}

function meetingTitle(meeting: { title: string | null } | null): string {
  return meeting?.title?.trim() || 'Kloud Meet meeting';
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireSession(req);
    if (isAuthError(member)) return member;
    const recording = await loadRecording(params);
    if (!recording) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });

    const decision = await evaluateRecordingView(recording, member);
    if (decision.kind === 'watch') return NextResponse.json({ status: 'APPROVED' });
    if (decision.kind !== 'request') {
      return NextResponse.json({ code: 'ATTENDEES_ONLY', error: 'Only attendees can watch this recording' }, { status: 403 });
    }
    if (!member.email) {
      return NextResponse.json({ error: 'Your account has no email address for the answer' }, { status: 400 });
    }

    const requesterName = member.fullName || member.username;
    const meetUserId = await meetUserIdForEmail(member.email, requesterName);
    const existing = await prisma.recordingAccessRequest.findFirst({
      where: { recordingId: recording.id, meetUserId },
      orderBy: { id: 'desc' },
    });
    if (existing?.status === 'PENDING') return NextResponse.json({ status: 'PENDING' });
    if (existing?.status === 'DENIED' && existing.respondedAt && Date.now() - existing.respondedAt.getTime() < KNOCK_RETRY_AFTER_MS) {
      return NextResponse.json({ code: 'TOO_SOON', status: 'DENIED' }, { status: 429 });
    }

    const now = new Date();
    if (existing) {
      await prisma.recordingAccessRequest.update({
        where: { id: existing.id },
        data: { status: 'PENDING', requestedAt: now, respondedAt: null, respondedByMemberId: null },
      });
    } else {
      await prisma.recordingAccessRequest.create({
        data: {
          recordingId: recording.id,
          meetingId: recording.meetingId,
          meetUserId,
          status: 'PENDING',
          accessToken: newShareKey(),
          requestedAt: now,
        },
      });
    }

    const meeting = await prisma.meeting.findUnique({
      where: { id: recording.meetingId },
      select: { title: true, createdByMember: { select: { email: true } } },
    });
    const hostEmail = meeting?.createdByMember?.email;
    if (hostEmail) {
      const shareKey = await ensureShareKey(recording);
      const replayUrl = `${publicOrigin(req)}${recordingReplayPath(shareKey)}`;
      const sent = await sendMail(
        recordingRequestEmail(hostEmail, {
          requester: requesterName,
          requesterEmail: member.email,
          title: meetingTitle(meeting),
          replayUrl,
        }),
      );
      if (!sent.ok) console.error('[recording access-requests] host email failed', sent.provider);
    }
    return NextResponse.json({ status: 'PENDING' });
  } catch (error) {
    console.error('[recording access-requests POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireSession(req);
    if (isAuthError(member)) return member;
    const recording = await loadRecording(params);
    if (!recording) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    if (!(await canManageRecording(member.id, recording))) return forbidden('Only the host can see requests');

    const rows = await prisma.recordingAccessRequest.findMany({
      where: { recordingId: recording.id, status: 'PENDING' },
      include: { meetUser: { select: { email: true, displayName: true } } },
      orderBy: { requestedAt: 'asc' },
      take: 50,
    });
    return NextResponse.json({
      requests: rows.map((r) => ({
        id: r.id,
        name: r.meetUser.displayName || r.meetUser.email,
        email: r.meetUser.email,
        requestedAt: r.requestedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[recording access-requests GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireSession(req);
    if (isAuthError(member)) return member;
    const recording = await loadRecording(params);
    if (!recording) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    if (!(await canManageRecording(member.id, recording))) return forbidden('Only the host can answer requests');

    const body = await req.json().catch(() => ({}));
    const status = body?.action === 'approve' ? 'APPROVED' : body?.action === 'deny' ? 'DENIED' : null;
    if (!status) return NextResponse.json({ error: 'action must be approve or deny' }, { status: 400 });
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id: unknown): id is number => Number.isSafeInteger(id) && (id as number) > 0).slice(0, 100)
      : [];
    if (body?.all !== true && ids.length === 0) {
      return NextResponse.json({ error: 'ids or all is required' }, { status: 400 });
    }

    const rows = await prisma.recordingAccessRequest.findMany({
      where: { recordingId: recording.id, status: 'PENDING', ...(body?.all === true ? {} : { id: { in: ids } }) },
      include: { meetUser: { select: { email: true } } },
    });
    if (rows.length === 0) return NextResponse.json({ updated: 0 });
    await prisma.recordingAccessRequest.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status, respondedAt: new Date(), respondedByMemberId: member.id },
    });

    const meeting = await prisma.meeting.findUnique({ where: { id: recording.meetingId }, select: { title: true } });
    const shareKey = await ensureShareKey(recording);
    const replayUrl = `${publicOrigin(req)}${recordingReplayPath(shareKey)}`;
    const hostName = member.fullName || member.username;
    for (const row of rows) {
      const sent = await sendMail(
        recordingAnswerEmail(row.meetUser.email, { approved: status === 'APPROVED', title: meetingTitle(meeting), hostName, replayUrl }),
      );
      if (!sent.ok) console.error('[recording access-requests] answer email failed', sent.provider);
    }
    return NextResponse.json({ updated: rows.length });
  } catch (error) {
    console.error('[recording access-requests PATCH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
