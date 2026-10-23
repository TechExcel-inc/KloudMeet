import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { generateCalendarFeedToken } from '@/lib/calendar/feed';

/**
 * Manage the signed-in member's private calendar feed token.
 *   GET    → { token }  (null when the feed is off)
 *   POST   → { token }  creates a token, or replaces it (old subscriptions stop working)
 *   DELETE → { token: null }  turns the feed off
 */
const noStore = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const member = await requireSession(request);
  if (isAuthError(member)) return member;
  return NextResponse.json({ token: member.calendarFeedToken ?? null }, { headers: noStore });
}

export async function POST(request: NextRequest) {
  const member = await requireSession(request);
  if (isAuthError(member)) return member;
  try {
    const token = generateCalendarFeedToken();
    await prisma.teamMember.update({
      where: { id: member.id },
      data: { calendarFeedToken: token },
    });
    return NextResponse.json({ token }, { headers: noStore });
  } catch (error) {
    console.error('[calendar-feed POST]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const member = await requireSession(request);
  if (isAuthError(member)) return member;
  try {
    await prisma.teamMember.update({
      where: { id: member.id },
      data: { calendarFeedToken: null },
    });
    return NextResponse.json({ token: null }, { headers: noStore });
  } catch (error) {
    console.error('[calendar-feed DELETE]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
