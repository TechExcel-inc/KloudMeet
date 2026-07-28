import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { resolveMemberAccountId } from '@/lib/peerTimeCompany';

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

    if (!roomName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const accountId = await resolveMemberAccountId(member.id);

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
      },
    });

    return NextResponse.json(meeting);
  } catch (error) {
    console.error('[meetings POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
