import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAuthError, requireSession } from '@/lib/apiAuth';

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;

/** GET — 登录用户按会议 ID 分页读取会后聊天记录。 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> },
): Promise<NextResponse> {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;

    const { meetingId } = await params;
    const parsedMeetingId = Number.parseInt(meetingId, 10);
    if (!Number.isInteger(parsedMeetingId) || parsedMeetingId <= 0) {
      return NextResponse.json({ error: 'Invalid meeting ID' }, { status: 400 });
    }

    const pageParam = Number.parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10);
    const pageSizeParam = Number.parseInt(
      request.nextUrl.searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE),
      10,
    );
    const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
    const pageSize =
      Number.isInteger(pageSizeParam) && pageSizeParam > 0
        ? Math.min(pageSizeParam, MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE;

    const meeting = await prisma.meeting.findUnique({
      where: { id: parsedMeetingId },
      select: {
        id: true,
        title: true,
        roomName: true,
        startedAt: true,
        endedAt: true,
      },
    });
    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const [total, messages] = await Promise.all([
      prisma.meetingChatMessage.count({
        where: { meetingId: parsedMeetingId },
      }),
      prisma.meetingChatMessage.findMany({
        where: { meetingId: parsedMeetingId },
        orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          clientMessageId: true,
          senderIdentity: true,
          senderName: true,
          content: true,
          sentAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      meeting,
      messages: messages.map((message) => ({
        clientMessageId: message.clientMessageId,
        senderIdentity: message.senderIdentity,
        senderName: message.senderName,
        message: message.content,
        timestamp: message.sentAt.getTime(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error('[GET /api/meeting-chat/[meetingId]]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
