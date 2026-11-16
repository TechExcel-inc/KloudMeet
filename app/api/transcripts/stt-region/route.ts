/**
 * GET /api/transcripts/stt-region
 *
 * 用客户端公网 IP 判断字幕引擎：中国大陆 bailian，海外 openai。
 * 内网或无法识别时返回 unknown，由浏览器用时区兜底。
 */
import { NextRequest } from 'next/server';
import { classifyIp, pickClientIp } from '@/lib/geo/chinaIp';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return runWithLocale(req, async () => {
  try {
    const ip = pickClientIp(
      req.headers.get('x-forwarded-for'),
      req.headers.get('x-real-ip'),
    );
    const region = classifyIp(ip);
    const provider = region === 'cn' ? 'bailian' : region === 'intl' ? 'openai' : 'unknown';
    return apiJson(
      { provider },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[GET /api/transcripts/stt-region]', err);
    return apiJson({ error: 'Failed to detect region' }, { status: 500 });
  }

  });
}
