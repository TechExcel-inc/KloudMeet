import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePersonalRoomIdForSave } from '@/lib/personalRoom';
import { parseAccessLevel } from '@/lib/meetingAccess';
import { resolveMemberAccountId } from '@/lib/peerTimeCompany';
import { normalizeEmail } from '@/lib/authPolicy';
import { signInMethodsOf } from '@/lib/accountLinking';

async function getAuthMember(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  const session = await prisma.session.findUnique({
    where: { token },
    include: { teamMember: true }
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.teamMember;
}

export async function GET(request: NextRequest) {
  try {
    const member = await getAuthMember(request);
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const { passwordHash, calendarFeedToken, googleId, kloudUserId, ...safeMember } = member;
    return NextResponse.json({ ...safeMember, signInMethods: signInMethodsOf(member) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const member = await getAuthMember(request);
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { firstName, middleName, lastName, biography, personalRoomId, phone, email, avatarUrl } = body;

    // Meeting settings → default access for new meetings; null clears it (= Public)
    let defaultMeetingAccessToSave: string | null | undefined = undefined;
    if (body.defaultMeetingAccess !== undefined) {
      if (body.defaultMeetingAccess === null || body.defaultMeetingAccess === '') {
        defaultMeetingAccessToSave = null;
      } else {
        const level = parseAccessLevel(body.defaultMeetingAccess);
        if (!level) {
          return NextResponse.json({ error: 'Invalid access level', code: 'ACCESS_LEVEL_INVALID' }, { status: 400 });
        }
        if (level === 'PRIVATE' && !(await resolveMemberAccountId(member.id))) {
          return NextResponse.json(
            { error: 'Private meetings need a company account', code: 'NEEDS_COMPANY' },
            { status: 400 },
          );
        }
        defaultMeetingAccessToSave = level;
      }
    }

    // Meeting settings → design links (Figma) in the meetings this person hosts
    if (body.designLinksEnabled !== undefined && typeof body.designLinksEnabled !== 'boolean') {
      return NextResponse.json({ error: 'Invalid design links setting', code: 'DESIGN_LINKS_INVALID' }, { status: 400 });
    }
    const designLinksEnabledToSave: boolean | undefined = body.designLinksEnabled;

    // Validate personalRoomId
    let personalRoomIdToSave: string | null | undefined = undefined;
    if (personalRoomId !== undefined) {
      if (personalRoomId === null || personalRoomId === '') {
        personalRoomIdToSave = null;
      } else {
        if (!/^(?=.*[a-zA-Z])[a-zA-Z0-9]{3,12}$/.test(personalRoomId)) {
          return NextResponse.json(
            { error: 'Room ID must be 3-12 letters and digits with at least one letter', code: 'PERSONAL_ROOM_ID_INVALID' },
            { status: 400 },
          );
        }
        const resolved = await resolvePersonalRoomIdForSave(personalRoomId, member.id);
        if (!resolved.ok) {
          return NextResponse.json(
            { error: 'This Room ID is already taken.', code: 'PERSONAL_ROOM_ID_TAKEN' },
            { status: 400 },
          );
        }
        personalRoomIdToSave = resolved.personalRoomId;
      }
    }

    // The email only changes through /api/account/email (a code sent to the new address); here an
    // unchanged value is accepted and anything else is refused.
    if (email !== undefined && email !== null && email !== '') {
      const normalized = normalizeEmail(email);
      if (!normalized) {
        return NextResponse.json(
          { error: 'Invalid email format', code: 'EMAIL_INVALID' },
          { status: 400 },
        );
      }
      if (normalized !== (member.email ?? '').toLowerCase()) {
        return NextResponse.json(
          { error: 'Confirm the new email with a code first.', code: 'EMAIL_NEEDS_CODE' },
          { status: 400 },
        );
      }
    }

    // Validate phone if provided
    if (phone !== undefined && phone !== '') {
      if (!/^[+]?[\d\s()-]{6,20}$/.test(phone)) {
        return NextResponse.json(
          { error: 'Invalid phone format', code: 'PHONE_INVALID' },
          { status: 400 },
        );
      }
    }

    // Auto-generate fullName
    const pieces = [firstName, middleName, lastName].filter(Boolean);
    const fullName = pieces.length > 0 ? pieces.join(' ') : member.fullName;

    const updated = await prisma.teamMember.update({
      where: { id: member.id },
      data: {
        firstName: firstName !== undefined ? firstName : undefined,
        middleName: middleName !== undefined ? middleName : undefined,
        lastName: lastName !== undefined ? lastName : undefined,
        fullName,
        biography: biography !== undefined ? biography : undefined,
        personalRoomId: personalRoomIdToSave,
        phone: phone !== undefined ? (phone || null) : undefined,
        avatarUrl: avatarUrl !== undefined ? (avatarUrl || null) : undefined,
        defaultMeetingAccess: defaultMeetingAccessToSave,
        designLinksEnabled: designLinksEnabledToSave,
        modifiedAt: new Date()
      }
    });

    const { passwordHash, calendarFeedToken, googleId, kloudUserId, ...safeMember } = updated;
    return NextResponse.json({ ...safeMember, signInMethods: signInMethodsOf(updated) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
