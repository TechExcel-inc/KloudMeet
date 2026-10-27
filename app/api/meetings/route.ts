import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { resolveMemberAccountId } from '@/lib/peerTimeCompany';
import { parseAccessLevel } from '@/lib/meetingAccess';
import { newMeetingAccessLevel } from '@/lib/meetingAccess.server';

export async function POST(request: NextRequest) {
  const member = await requireSession(request);
  if (isAuthError(member)) return member;

  try {
    const body = await request.json();
    const {
      roomName,
      title,
      description,
      scheduledFor,
      durationMinutes,
      timezone,
      status,
    } = body;
    // Schedule dialog → Access; left out, the host's default from My Profile (Public when unset).
    const requestedLevel = parseAccessLevel(body.accessLevel);

    if (!roomName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const accountId = await resolveMemberAccountId(member.id);
    if (requestedLevel === 'PRIVATE' && !accountId) {
      return NextResponse.json({ error: 'Private meetings need a company account', code: 'NEEDS_COMPANY' }, { status: 400 });
    }
    const accessLevel = requestedLevel ?? (await newMeetingAccessLevel(member.id, accountId));

    const meeting = await prisma.meeting.create({
      data: {
        roomName,
        createdByMemberId: member.id,
        accountId: accountId ?? undefined,
        title,
        description,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
        durationMinutes,
        timezone,
        status: status || 'ACTIVE',
        accessLevel,
      },
    });

    return NextResponse.json(meeting);
  } catch (error) {
    console.error('[meetings POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
