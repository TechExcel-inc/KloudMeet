import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { generateCalendarFeedToken } from '@/lib/calendar/feed';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

/**
 * Manage the signed-in member's private calendar feed token.
 *   GET    → { token }  (null when the feed is off)
 *   POST   → { token }  creates a token, or replaces it (old subscriptions stop working)
 *   DELETE → { token: null }  turns the feed off
 */
const noStore = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  return runWithLocale(request, async () => {
  const member = await requireSession(request);
  if (isAuthError(member)) return member;
  return apiJson({ token: member.calendarFeedToken ?? null }, { headers: noStore });

  });
}

export async function POST(request: NextRequest) {
  return runWithLocale(request, async () => {
  const member = await requireSession(request);
  if (isAuthError(member)) return member;
  try {
    const token = generateCalendarFeedToken();
    await prisma.teamMember.update({
      where: { id: member.id },
      data: { calendarFeedToken: token },
    });
    return apiJson({ token }, { headers: noStore });
  } catch (error) {
    console.error('[calendar-feed POST]', error instanceof Error ? error.message : error);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}

export async function DELETE(request: NextRequest) {
  return runWithLocale(request, async () => {
  const member = await requireSession(request);
  if (isAuthError(member)) return member;
  try {
    await prisma.teamMember.update({
      where: { id: member.id },
      data: { calendarFeedToken: null },
    });
    return apiJson({ token: null }, { headers: noStore });
  } catch (error) {
    console.error('[calendar-feed DELETE]', error instanceof Error ? error.message : error);
    return apiJson({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
