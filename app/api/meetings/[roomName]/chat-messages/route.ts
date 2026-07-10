import { NextRequest, NextResponse } from 'next/server';
import { TokenVerifier } from 'livekit-server-sdk';
import { prisma } from '@/lib/db';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 500;
const MAX_CLIENT_MESSAGE_ID_LENGTH = 191;

interface ChatMessageBody {
  clientMessageId?: unknown;
  message?: unknown;
}

interface VerifiedParticipant {
  identity: string;
  name: string;
}

interface SerializedChatMessage {
  clientMessageId: string;
  senderIdentity: string;
  senderName: string;
  message: string;
  timestamp: number;
}

function getBearerToken(request: NextRequest): string {
  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

async function verifyRoomParticipant(
  request: NextRequest,
  roomName: string,
): Promise<VerifiedParticipant | null> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const token = getBearerToken(request);
  if (!apiKey || !apiSecret || !token) return null;

  try {
    const claims = await new TokenVerifier(apiKey, apiSecret).verify(token);
    const identity = claims.sub;
    if (
      typeof identity !== 'string' ||
      !identity ||
      claims.video?.room !== roomName ||
      claims.video?.roomJoin !== true ||
      claims.video?.canPublishData !== true
    ) {
      return null;
    }

    const name = typeof claims.name === 'string' && claims.name.trim()
      ? claims.name.trim()
      : identity;
    return {
      identity: identity.slice(0, 191),
      name: name.slice(0, 191),
    };
  } catch {
    return null;
  }
}

function serializeMessage(message: {
  clientMessageId: string;
  senderIdentity: string;
  senderName: string;
  content: string;
  sentAt: Date;
}): SerializedChatMessage {
  return {
    clientMessageId: message.clientMessageId,
    senderIdentity: message.senderIdentity,
    senderName: message.senderName,
    message: message.content,
    timestamp: message.sentAt.getTime(),
  };
}

/** GET — 返回当前会议最近的聊天记录。 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
): Promise<NextResponse> {
  try {
    const { roomName } = await params;
    if (!roomName) {
      return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });
    }

    const participant = await verifyRoomParticipant(request, roomName);
    if (!participant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const meeting = await prisma.meeting.findUnique({
      where: { roomName },
      select: { id: true },
    });
    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const messages = await prisma.meetingChatMessage.findMany({
      where: { meetingId: meeting.id },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: MAX_HISTORY_MESSAGES,
      select: {
        clientMessageId: true,
        senderIdentity: true,
        senderName: true,
        content: true,
        sentAt: true,
      },
    });

    return NextResponse.json({
      messages: messages.reverse().map(serializeMessage),
    });
  } catch (error) {
    console.error('[GET /api/meetings/[roomName]/chat-messages]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST — 保存一条由当前 LiveKit 参与者发送的聊天消息。 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> },
): Promise<NextResponse> {
  try {
    const { roomName } = await params;
    if (!roomName) {
      return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });
    }

    const participant = await verifyRoomParticipant(request, roomName);
    if (!participant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as ChatMessageBody;
    const clientMessageId =
      typeof body.clientMessageId === 'string' ? body.clientMessageId.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!clientMessageId || clientMessageId.length > MAX_CLIENT_MESSAGE_ID_LENGTH) {
      return NextResponse.json({ error: 'Invalid client message ID' }, { status: 400 });
    }
    if (!message || message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
    }

    const meeting = await prisma.meeting.findUnique({
      where: { roomName },
      select: { id: true },
    });
    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const saved = await prisma.meetingChatMessage.upsert({
      where: {
        meetingId_clientMessageId: {
          meetingId: meeting.id,
          clientMessageId,
        },
      },
      update: {},
      create: {
        meetingId: meeting.id,
        clientMessageId,
        senderIdentity: participant.identity,
        senderName: participant.name,
        content: message,
        sentAt: new Date(),
      },
      select: {
        clientMessageId: true,
        senderIdentity: true,
        senderName: true,
        content: true,
        sentAt: true,
      },
    });

    return NextResponse.json({ message: serializeMessage(saved) }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/meetings/[roomName]/chat-messages]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
