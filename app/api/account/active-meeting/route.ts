import { NextRequest, NextResponse } from 'next/server';
import { resolveHostActiveMeeting } from '@/lib/hostActiveMeeting';
import { isAuthError, requireSession } from '@/lib/apiAuth';

export async function GET(request: NextRequest) {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;

    const preferredRoomName =
      request.nextUrl.searchParams.get('roomName')?.trim() || null;

    const meeting = await resolveHostActiveMeeting(member.id, preferredRoomName);

    if (!meeting) {
      return NextResponse.json({ hasActive: false });
    }

    return NextResponse.json({
      hasActive: true,
      meeting: {
        ...meeting,
        isActive: meeting.isActive ?? true,
        actualStartedAt:
          meeting.actualStartedAt instanceof Date
            ? meeting.actualStartedAt.toISOString()
            : meeting.actualStartedAt,
        scheduledFor:
          meeting.scheduledFor instanceof Date
            ? meeting.scheduledFor.toISOString()
            : meeting.scheduledFor,
      },
    });
  } catch (error) {
    console.error('[account active-meeting GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
