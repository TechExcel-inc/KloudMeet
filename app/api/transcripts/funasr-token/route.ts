/**
 * POST /api/transcripts/funasr-token
 *
 * 签发一分钟内、仅可使用一次的 Fun-ASR WebSocket 连接凭证。
 */
import { createHmac, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { checkCaptionQuotaForRoom } from '@/lib/billing/limits';
import { verifyParticipant } from '@/lib/livekitParticipantAuth';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sign(raw: string, key: string): string {
  return createHmac('sha256', key).update(raw).digest('base64url');
}

export async function POST(request: NextRequest) {
  return runWithLocale(request, async () => {
  if (!(await verifyParticipant(request, { publish: true }))) {
    return apiJson({ error: 'Unauthorized' }, { status: 401 });
  }
  const key = process.env.DASHSCOPE_API_KEY || '';
  if (!key) {
    return apiJson({ error: 'Fun-ASR is not configured' }, { status: 500 });
  }

  // Billing (no-op when disabled): captions count against the meeting host's replay hours.
  const quotaError = await checkCaptionQuotaForRoom(request.nextUrl.searchParams.get('roomName'));
  if (quotaError) return quotaError;

  try {
    const raw = Buffer.from(JSON.stringify({
      exp: Date.now() + 60000,
      nonce: randomUUID(),
    })).toString('base64url');
    return apiJson(
      { token: `${raw}.${sign(raw, key)}` },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[POST /api/transcripts/funasr-token]', err);
    return apiJson({ error: 'Failed to create Fun-ASR token' }, { status: 500 });
  }

  });
}
