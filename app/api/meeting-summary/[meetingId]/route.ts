/**
 * GET  /api/meeting-summary/[meetingId]  — 获取摘要（本地 DB → Java Server fallback）
 * POST /api/meeting-summary/[meetingId]  — 保存摘要章节到本地 DB
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const KLOUD_API = process.env.NEXT_PUBLIC_REMOTE_API || 'https://meet.kloud.cn';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  try {
    const { meetingId } = await params;
    const localMeetingId = parseInt(meetingId);
    if (isNaN(localMeetingId)) {
      return NextResponse.json({ error: 'Invalid meetingId' }, { status: 400 });
    }

    // 1. 查本地 summaryItems
    const localItems = await prisma.meetingSummaryItem.findMany({
      where: { meetingId: localMeetingId },
      orderBy: { sortOrder: 'asc' },
    });

    if (localItems.length > 0) {
      return NextResponse.json({ items: localItems, source: 'local' });
    }

    // 2. 查 kloudMeetingId → 去 Java Server 拉取
    const meeting = await prisma.meeting.findUnique({
      where: { id: localMeetingId },
      select: { kloudMeetingId: true },
    });

    const kloudId = (meeting as any)?.kloudMeetingId;
    if (!kloudId) {
      return NextResponse.json({ items: [], source: 'none' });
    }

    const authHeader = req.headers.get('authorization') || '';
    const javaRes = await fetch(
      `${KLOUD_API}/meeting_caption/meeting_caption_summary?meetingId=${kloudId}`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
      }
    );

    if (!javaRes.ok) {
      return NextResponse.json({ items: [], source: 'java-error' });
    }

    const javaData = await javaRes.json();
    const rawItems: any[] = [];

    // timeAxisData 是 JSON 字符串格式的章节数组
    if (javaData?.data?.timeAxisData) {
      try {
        const parsed = JSON.parse(javaData.data.timeAxisData);
        if (Array.isArray(parsed)) rawItems.push(...parsed);
      } catch {}
    }

    if (!rawItems.length) {
      return NextResponse.json({ items: [], source: 'java-empty' });
    }

    // 3. 缓存到本地 DB
    const toInsert = rawItems.map((item: any, idx: number) => ({
      meetingId: localMeetingId,
      title: item.title || `Chapter ${idx + 1}`,
      content: item.summary || item.content || '',
      timeOffset: item.time || '00:00:00',
      sortOrder: idx,
    }));

    await prisma.meetingSummaryItem.createMany({ data: toInsert });

    const saved = await prisma.meetingSummaryItem.findMany({
      where: { meetingId: localMeetingId },
      orderBy: { sortOrder: 'asc' },
    });

    return NextResponse.json({ items: saved, source: 'java' });
  } catch (err) {
    console.error('[meeting-summary GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  try {
    const { meetingId } = await params;
    const localMeetingId = parseInt(meetingId);
    if (isNaN(localMeetingId)) {
      return NextResponse.json({ error: 'Invalid meetingId' }, { status: 400 });
    }

    const body = await req.json();
    const { items }: { items: { title: string; content: string; timeOffset: string }[] } = body;

    if (!Array.isArray(items) || !items.length) {
      return NextResponse.json({ error: 'items array required' }, { status: 400 });
    }

    // 清空旧的再插入
    await prisma.meetingSummaryItem.deleteMany({ where: { meetingId: localMeetingId } });
    await prisma.meetingSummaryItem.createMany({
      data: items.map((item, idx) => ({
        meetingId: localMeetingId,
        title: item.title,
        content: item.content,
        timeOffset: item.timeOffset,
        sortOrder: idx,
      })),
    });

    const saved = await prisma.meetingSummaryItem.findMany({
      where: { meetingId: localMeetingId },
      orderBy: { sortOrder: 'asc' },
    });

    return NextResponse.json({ success: true, items: saved });
  } catch (err) {
    console.error('[meeting-summary POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
