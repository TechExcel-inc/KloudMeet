import { NextRequest, NextResponse } from 'next/server';
import { publicOrigin } from '@/lib/calendar/server';
import { sendDueReminders } from '@/lib/meetingInvites.server';

/**
 * 发送到点的会议提醒邮件（预约弹窗 → Emails → 提醒）。
 * 鉴权：Authorization: Bearer <CRON_SECRET>（未配置 CRON_SECRET 时拒绝）。
 * 建议 crontab 每 5 分钟调用一次；同一条提醒只会发一次（MeetingReminderLog 唯一键）。
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7).trim() === secret;
}

async function handleReminders(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await sendDueReminders(publicOrigin(request));
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[cron meeting-reminders]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleReminders(request);
}

export async function POST(request: NextRequest) {
  return handleReminders(request);
}
