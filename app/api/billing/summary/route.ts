/**
 * GET /api/billing/summary — Plan & billing page data.
 * Returns `{ enabled: false }` when BILLING_ENABLED is off (the UI hides billing).
 */
import { NextRequest } from 'next/server';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { buildBillingSummary } from '@/lib/billing/summary';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

export async function GET(request: NextRequest) {
  return runWithLocale(request, async () => {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;
    const summary = await buildBillingSummary(member.id);
    return apiJson(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[billing summary GET]', error);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
