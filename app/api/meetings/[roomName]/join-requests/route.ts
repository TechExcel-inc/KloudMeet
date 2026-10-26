import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ensurePersonalRoomMeeting } from '@/lib/meetingRoomIsActive';
import { forbidden, isAuthError, requireSession } from '@/lib/apiAuth';
import { KNOCK_RETRY_AFTER_MS, KNOCK_STALE_AFTER_MS, mayKnockAgain, parseAccessLevel } from '@/lib/meetingAccess';
import {
  companyNameOf,
  evaluateJoin,
  hostIsPresent,
  mayAdmit,
  nudgeJoinRequests,
  resolveAccessTarget,
} from '@/lib/meetingAccess.server';

/**
 * Knocking on a Protected meeting (lib/meetingAccess.ts).
 * Person waiting:  POST ask (again) · GET ?mine=1 poll (also keeps the request fresh) · DELETE cancel.
 * Host / co-hosts: GET waiting list · PATCH { ids | all, action: admit | deny }.
 */

async function loadTarget(params: Promise<{ roomName: string }>, opts: { startPersonalSession?: boolean } = {}) {
  const { roomName } = await params;
  let target = await resolveAccessTarget(roomName ?? '');
  // Knocks belong to a session row. A personal ID with no open session gets one, as joining
  // it would (connection-details); only asking to join does this, not polling.
  if (target?.upcomingPersonalSession && opts.startPersonalSession) {
    await ensurePersonalRoomMeeting(target.roomName);
    target = await resolveAccessTarget(target.roomName);
  }
  if (!target || !target.id) return null;
  return target;
}

function cleanName(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? value.trim().slice(0, 80) : '';
  return name || fallback;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ roomName: string }> }) {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;
    const target = await loadTarget(params, { startPersonalSession: true });
    if (!target) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const { decision } = await evaluateJoin({ meeting: target, member });
    if (decision.kind === 'join') return NextResponse.json({ status: 'ADMITTED' });
    if (decision.kind === 'refused' && decision.reason === 'NOT_INVITED') {
      return NextResponse.json({ code: 'NOT_INVITED', error: 'This meeting is invite-only' }, { status: 403 });
    }
    if (decision.kind === 'sign_in') return NextResponse.json({ code: 'SIGN_IN_REQUIRED' }, { status: 403 });

    const key = { meetingId_teamMemberId: { meetingId: target.id, teamMemberId: member.id } };
    const existing = await prisma.meetingJoinRequest.findUnique({ where: key });
    if (existing?.status === 'DENIED' && !mayKnockAgain(existing.respondedAt)) {
      const retryAfterMs = KNOCK_RETRY_AFTER_MS - (Date.now() - (existing.respondedAt?.getTime() ?? Date.now()));
      return NextResponse.json({ code: 'TOO_SOON', retryAfterMs }, { status: 429 });
    }

    const now = new Date();
    const displayName = cleanName(body?.displayName, member.fullName || member.username);
    const fresh = !existing || existing.status !== 'PENDING';
    await prisma.meetingJoinRequest.upsert({
      where: key,
      create: { meetingId: target.id, teamMemberId: member.id, displayName, status: 'PENDING', requestedAt: now, lastSeenAt: now },
      update: {
        displayName,
        status: 'PENDING',
        lastSeenAt: now,
        ...(fresh ? { requestedAt: now, respondedAt: null, respondedByMemberId: null } : {}),
      },
    });
    if (fresh) void nudgeJoinRequests(target.roomName);
    return NextResponse.json({ status: 'PENDING' });
  } catch (error) {
    console.error('[join-requests POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ roomName: string }> }) {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;
    const target = await loadTarget(params);
    if (!target) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });

    if (request.nextUrl.searchParams.get('mine') === '1') {
      const key = { meetingId_teamMemberId: { meetingId: target.id, teamMemberId: member.id } };
      const row = await prisma.meetingJoinRequest.findUnique({ where: key });
      if (row?.status === 'PENDING') {
        await prisma.meetingJoinRequest.update({ where: key, data: { lastSeenAt: new Date() } });
      }
      const presence = row?.status === 'PENDING' ? await hostIsPresent(target) : null;
      return NextResponse.json({
        status: row?.status ?? null,
        hostPresent: presence?.hostPresent ?? null,
        participantCount: presence?.participantCount ?? null,
        retryAfterMs:
          row?.status === 'DENIED' && !mayKnockAgain(row.respondedAt)
            ? KNOCK_RETRY_AFTER_MS - (Date.now() - (row.respondedAt?.getTime() ?? Date.now()))
            : 0,
      });
    }

    if (!mayAdmit(member.id, target)) return forbidden('Only the host or a co-host can see who is waiting');
    if (parseAccessLevel(target.accessLevel) !== 'PROTECTED') {
      return NextResponse.json({ requests: [], companyName: null });
    }
    const rows = await prisma.meetingJoinRequest.findMany({
      where: {
        meetingId: target.id,
        status: 'PENDING',
        lastSeenAt: { gt: new Date(Date.now() - KNOCK_STALE_AFTER_MS) },
      },
      orderBy: { requestedAt: 'asc' },
      take: 50,
    });
    const people = rows.length
      ? await prisma.teamMember.findMany({
          where: { id: { in: rows.map((r) => r.teamMemberId) } },
          select: { id: true, email: true, avatarUrl: true },
        })
      : [];
    const byId = new Map(people.map((p) => [p.id, p]));
    return NextResponse.json({
      companyName: await companyNameOf(target.accountId),
      requests: rows.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        email: byId.get(r.teamMemberId)?.email ?? null,
        avatarUrl: byId.get(r.teamMemberId)?.avatarUrl ?? null,
        requestedAt: r.requestedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[join-requests GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ roomName: string }> }) {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;
    const target = await loadTarget(params);
    if (!target) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    if (!mayAdmit(member.id, target)) return forbidden('Only the host or a co-host can admit people');

    const body = await request.json().catch(() => ({}));
    const action = body?.action === 'admit' ? 'ADMITTED' : body?.action === 'deny' ? 'DENIED' : null;
    if (!action) return NextResponse.json({ error: 'action must be admit or deny' }, { status: 400 });
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id: unknown): id is number => Number.isSafeInteger(id) && (id as number) > 0).slice(0, 100)
      : [];
    if (body?.all !== true && ids.length === 0) {
      return NextResponse.json({ error: 'ids or all is required' }, { status: 400 });
    }

    const result = await prisma.meetingJoinRequest.updateMany({
      where: { meetingId: target.id, status: 'PENDING', ...(body?.all === true ? {} : { id: { in: ids } }) },
      data: { status: action, respondedAt: new Date(), respondedByMemberId: member.id },
    });
    if (result.count > 0) void nudgeJoinRequests(target.roomName);
    return NextResponse.json({ updated: result.count });
  } catch (error) {
    console.error('[join-requests PATCH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ roomName: string }> }) {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;
    const target = await loadTarget(params);
    if (!target) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    const result = await prisma.meetingJoinRequest.updateMany({
      where: { meetingId: target.id, teamMemberId: member.id, status: 'PENDING' },
      data: { status: 'CANCELED' },
    });
    if (result.count > 0) void nudgeJoinRequests(target.roomName);
    return NextResponse.json({ canceled: result.count });
  } catch (error) {
    console.error('[join-requests DELETE]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
