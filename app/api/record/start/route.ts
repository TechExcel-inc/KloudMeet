import { EgressClient, EncodedFileOutput, S3Upload } from 'livekit-server-sdk';
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
      return new NextResponse('Only the meeting host can start recording', { status: 403 });
    }

    const {
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET,
      LIVEKIT_URL,
      S3_KEY_ID,
      S3_KEY_SECRET,
      S3_BUCKET,
      S3_ENDPOINT,
      S3_REGION,
    } = process.env;

    const hostURL = new URL(LIVEKIT_URL!);
    hostURL.protocol = 'https:';

    const egressClient = new EgressClient(hostURL.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    const existingEgresses = await egressClient.listEgress({ roomName });
    if (existingEgresses.length > 0 && existingEgresses.some((e) => e.status < 2)) {
      return new NextResponse('Meeting is already being recorded', { status: 409 });
    }

    const fileOutput = new EncodedFileOutput({
      filepath: `${new Date(Date.now()).toISOString()}-${roomName}.mp4`,
      output: {
        case: 's3',
        value: new S3Upload({
          endpoint: S3_ENDPOINT,
          accessKey: S3_KEY_ID,
          secret: S3_KEY_SECRET,
          region: S3_REGION,
          bucket: S3_BUCKET,
        }),
      },
    });

    await egressClient.startRoomCompositeEgress(
      roomName,
      {
        file: fileOutput,
      },
      {
        layout: 'speaker',
      },
    );

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
  }
}
