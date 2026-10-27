import { NextRequest, NextResponse } from 'next/server';
import { getSessionTeamMember } from '@/lib/getSessionTeamMember';
import { parseAccessLevel, mayKnockAgain, KNOCK_RETRY_AFTER_MS } from '@/lib/meetingAccess';
import {
  INVITE_PARAM,
  companyNameOf,
  evaluateJoin,
  hostIsPresent,
  meetingHasStarted,
  resolveAccessTarget,
} from '@/lib/meetingAccess.server';
import { prisma } from '@/lib/db';

/**
 * Pre-join: what this person may do with the meeting the link leads to.
 * { level, isHost, decision: join | sign_in | knock | refused, reason?, meeting card, ... }
 * Shows only the title, the host and (for someone waiting) a head count — never who is in it.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ roomName: string }> }) {
  try {
    const { roomName } = await params;
    const target = await resolveAccessTarget(roomName ?? '');
    if (!target) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });

    const member = await getSessionTeamMember(request);
    const isHost = Boolean(member && member.id === target.createdByMemberId);
    const { decision } = await evaluateJoin({
      meeting: target,
      member,
      inviteToken: request.nextUrl.searchParams.get(INVITE_PARAM),
    });

    let retryAfterMs: number | null = null;
    if (decision.kind === 'refused' && decision.reason === 'DENIED' && member && target.id) {
      const row = await prisma.meetingJoinRequest.findUnique({
        where: { meetingId_teamMemberId: { meetingId: target.id, teamMemberId: member.id } },
        select: { respondedAt: true },
      });
      const respondedAt = row?.respondedAt ?? null;
      retryAfterMs = mayKnockAgain(respondedAt)
        ? 0
        : KNOCK_RETRY_AFTER_MS - (Date.now() - (respondedAt?.getTime() ?? Date.now()));
    }

    const presence = decision.kind === 'knock' ? await hostIsPresent(target) : null;
    return NextResponse.json({
      roomName: target.roomName,
      level: parseAccessLevel(target.accessLevel),
      isHost,
      // false: the host hasn't started it yet; the pre-join page waits and joins when it has
      started: isHost || (await meetingHasStarted(target)),
      decision: decision.kind,
      ...(decision.kind === 'refused' ? { reason: decision.reason, retryAfterMs } : {}),
      ...(decision.kind === 'knock' ? { pending: decision.pending } : {}),
      meeting: {
        title: target.title,
        hostName: target.host.fullName || target.host.username,
        hostAvatarUrl: target.host.avatarUrl,
        companyName: await companyNameOf(target.accountId),
        hostPresent: presence?.hostPresent ?? null,
        participantCount: presence?.participantCount ?? null,
      },
      signedInAs: member ? { email: member.email, name: member.fullName || member.username } : null,
    });
  } catch (error) {
    console.error('[meetings access GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
