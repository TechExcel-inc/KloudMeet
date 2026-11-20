import { NextRequest } from 'next/server';
import { checkCaptionQuotaForRoom } from '@/lib/billing/limits';
import { verifyParticipant } from '@/lib/livekitParticipantAuth';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return runWithLocale(request, async () => {
    const participant = await verifyParticipant(request, { publish: true });
    if (!participant) return apiJson({ error: 'Unauthorized' }, { status: 401 });

    const key = process.env.ASSEMBLYAI_API_KEY?.trim();
    if (!key) return apiJson({ error: 'AssemblyAI is not configured' }, { status: 503 });

    const quotaError = await checkCaptionQuotaForRoom(participant.room);
    if (quotaError) return quotaError;

    try {
      const response = await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=60', {
        headers: { Authorization: key },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      const data = response.ok ? await response.json() : null;
      if (typeof data?.token !== 'string' || !data.token) {
        console.error('[assemblyai-token] AssemblyAI request failed', response.status);
        return apiJson({ error: 'Failed to create AssemblyAI token' }, { status: 502 });
      }
      return apiJson({ token: data.token }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return apiJson({ error: 'Failed to create AssemblyAI token' }, { status: 502 });
    }
  });
}
