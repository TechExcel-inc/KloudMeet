/**
 * GET /api/billing/summary — Plan & billing page data.
 * Returns `{ enabled: false }` when BILLING_ENABLED is off (the UI hides billing).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { buildBillingSummary } from '@/lib/billing/summary';

export async function GET(request: NextRequest) {
  try {
    const member = await requireSession(request);
    if (isAuthError(member)) return member;
    const summary = await buildBillingSummary(member.id);
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[billing summary GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
