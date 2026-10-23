/**
 * POST /api/transcripts/funasr-token
 *
 * 签发一分钟内、仅可使用一次的 Fun-ASR WebSocket 连接凭证。
 */
import { createHmac, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { verifyParticipant } from '@/lib/livekitParticipantAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sign(raw: string, key: string): string {
  return createHmac('sha256', key).update(raw).digest('base64url');
}

export async function POST(req: NextRequest) {
  if (!(await verifyParticipant(req, { publish: true }))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const key = process.env.DASHSCOPE_API_KEY || '';
  if (!key) {
    return NextResponse.json({ error: 'Fun-ASR is not configured' }, { status: 500 });
  }

  try {
    const raw = Buffer.from(JSON.stringify({
      exp: Date.now() + 60000,
      nonce: randomUUID(),
    })).toString('base64url');
    return NextResponse.json(
      { token: `${raw}.${sign(raw, key)}` },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[POST /api/transcripts/funasr-token]', err);
    return NextResponse.json({ error: 'Failed to create Fun-ASR token' }, { status: 500 });
  }
}
