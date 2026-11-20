/**
 * POST /api/meeting-summary/[meetingId]/generate
 *
 * 从字幕生成结构化会议摘要：
 *   1. 读取该会议所有 MeetingTranscript（按时间排序）
 *   2. 调用 DeepSeek（OpenAI 备用）按 lib/meetingSummary 的规则起草：主题、概览、分节要点、待办；
 *      长会议分段起草（每段一次调用），最后一次调用写主题 / 概览并合并重复的待办
 *   3. normalizeSummary 把每个时间对到真实字幕，对不上的要点 / 待办丢掉
 *   4. 每节写一行 MeetingSummaryItem（章节卡片也用它），主题 / 概览 / 待办写 MeetingSummary
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { checkAiSummaryQuota } from '@/lib/billing/limits';
import { meterAiSummary, meterSafely } from '@/lib/billing/usage';
import { writeMeetingSummary } from '@/lib/meetingSummaryServer';
import { schedulePresentation } from '@/lib/meetingPresentationServer';
import { isInternalMember } from '@/lib/internalStaff.server';
import { requireMeetingAccess } from '@/lib/meetingAccessGuards';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

// ── Auth helper ──────────────────────────────────────────────
async function getSession(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  return prisma.session.findUnique({
    where: { token },
    select: { id: true, expiresAt: true, teamMemberId: true },
  });
}

// ── Main handler ─────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  return runWithLocale(req, async () => {
  try {
    const session = await getSession(req);
    if (!session || session.expiresAt < new Date()) {
      return apiJson({ error: 'Unauthorized' }, { status: 401 });
    }

    const { meetingId } = await params;
    const localMeetingId = parseInt(meetingId);
    if (isNaN(localMeetingId)) {
      return apiJson({ error: 'Invalid meetingId' }, { status: 400 });
    }

    // Only the host or members who attended may spend AI quota / overwrite the summary.
    const access = await requireMeetingAccess(req, localMeetingId);
    if (access instanceof NextResponse) return access;
    if (access.memberId == null) {
      return apiJson({ error: 'Unauthorized' }, { status: 401 });
    }

    const meeting = await prisma.meeting.findUnique({
      where: { id: localMeetingId },
      select: { id: true, title: true, roomName: true, actualStartedAt: true },
    });
    if (!meeting) {
      return apiJson({ error: 'Meeting not found' }, { status: 404 });
    }

    const transcripts = await prisma.meetingTranscript.findMany({
      where: { meetingId: localMeetingId },
      orderBy: { captionTime: 'asc' },
    });

    if (transcripts.length === 0) {
      return apiJson({ error: 'No transcript yet, so a summary cannot be generated.' }, { status: 422 });
    }

    // Billing (no-op when disabled): Free includes a few AI summaries per month.
    const quotaError = await checkAiSummaryQuota(session.teamMemberId);
    if (quotaError) return quotaError;

    const meetingName = meeting.title || meeting.roomName || `Meeting #${localMeetingId}`;

    // Drafted by the model, checked against the transcript, then stored (lib/meetingSummaryServer.ts)
    const saved = await writeMeetingSummary(localMeetingId, meetingName, transcripts);
    if ('failed' in saved) {
      return apiJson(
        {
          error: saved.failed === 'ai_failed'
            ? 'The AI service failed. Please try again.'
            : 'The AI service returned no usable summary. Please try again.',
        },
        { status: 502 },
      );
    }
    const ai = saved.ai;
    // A presentation made from the earlier summary no longer matches: make it again.
    schedulePresentation(localMeetingId, { force: true });

    await meterSafely(`ai:${localMeetingId}`, () => meterAiSummary(session.teamMemberId, localMeetingId));

    // Which model wrote it is an internal note: only staff on INTERNAL_STAFF_EMAILS get it
    const { updatedAt, ...head } = saved.head;
    const generation = (await isInternalMember(session.teamMemberId))
      ? { model: ai.model, fallbackReason: ai.fallbackReason, at: updatedAt }
      : undefined;
    return apiJson({ success: true, items: saved.items, summary: { ...head, generation } });
  } catch (err) {
    console.error('[meeting-summary generate]', err);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
