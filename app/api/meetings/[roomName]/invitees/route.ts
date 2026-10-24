import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { canManageMeeting, forbidden, isAuthError, requireSession } from '@/lib/apiAuth';
import { publicOrigin } from '@/lib/calendar/server';
import { getInviteSettings, saveInviteSettings } from '@/lib/meetingInvites.server';

/**
 * Schedule dialog → attendees and email settings (host only).
 * GET: { emails, inviteEmails, reminderEmails, reminderOffsets }
 * PUT: same fields (all optional); saves, then emails attendees who haven't been invited for
 * the current start time. Returns the saved settings plus { sent, failed }.
 */
async function loadForHost(request: NextRequest, params: Promise<{ roomName: string }>) {
  const member = await requireSession(request);
  if (isAuthError(member)) return { error: member };
  const { roomName } = await params;
  const meeting = await prisma.meeting.findUnique({
    where: { roomName },
    select: { id: true, createdByMemberId: true },
  });
  if (!meeting) return { error: NextResponse.json({ error: 'Meeting not found' }, { status: 404 }) };
  if (!canManageMeeting(member.id, meeting)) return { error: forbidden('Only the meeting host can manage attendees') };
  return { meeting };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ roomName: string }> }) {
  try {
    const found = await loadForHost(request, params);
    if ('error' in found) return found.error;
    return NextResponse.json(await getInviteSettings(found.meeting.id));
  } catch (error) {
    console.error('[meetings invitees GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ roomName: string }> }) {
  try {
    const found = await loadForHost(request, params);
    if ('error' in found) return found.error;
    const body = await request.json().catch(() => ({}));
    const saved = await saveInviteSettings(found.meeting.id, body ?? {}, publicOrigin(request));
    return NextResponse.json({ success: true, ...saved });
  } catch (error) {
    console.error('[meetings invitees PUT]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
