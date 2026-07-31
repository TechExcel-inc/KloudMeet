import { NextRequest, NextResponse } from 'next/server';
import { expireStaleIdleMeetings } from '@/lib/meetingRejoin';

/**
 * 扫过宽限期的空会并标记 ENDED。
 * 鉴权：Authorization: Bearer <CRON_SECRET>（未配置 CRON_SECRET 时拒绝）。
 * 建议 crontab 每 5 分钟调用一次。
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7).trim() === secret;
}

async function handleExpire(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const expired = await expireStaleIdleMeetings();
    return NextResponse.json({ success: true, expired });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[cron expire-idle-meetings]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleExpire(request);
}

export async function POST(request: NextRequest) {
  return handleExpire(request);
}
