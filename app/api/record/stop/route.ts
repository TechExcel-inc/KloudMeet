import { EgressClient } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const member = await requireSession(req);
    if (isAuthError(member)) return member;

    const roomName = req.nextUrl.searchParams.get('roomName');

    if (roomName === null) {
      return new NextResponse('Missing roomName parameter', { status: 403 });
    }

    const meeting = await prisma.meeting.findUnique({ where: { roomName } });
    if (!meeting) {
      return new NextResponse('Meeting not found', { status: 404 });
    }
    if (meeting.createdByMemberId !== member.id) {
      return new NextResponse('Only the meeting host can stop recording', { status: 403 });
    }

    const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;

    const hostURL = new URL(LIVEKIT_URL!);
    hostURL.protocol = 'https:';

    const egressClient = new EgressClient(hostURL.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const activeEgresses = (await egressClient.listEgress({ roomName })).filter(
      (info) => info.status < 2,
    );
    if (activeEgresses.length === 0) {
      return new NextResponse('No active recording found', { status: 404 });
    }
    await Promise.all(activeEgresses.map((info) => egressClient.stopEgress(info.egressId)));

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
  }
}
