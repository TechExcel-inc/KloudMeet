import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

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
    
    const { passwordHash, ...safeMember } = member;
    return NextResponse.json(safeMember);
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
    
    // Validate personalRoomId
    if (personalRoomId) {
      if (!/^[a-zA-Z0-9]{3,12}$/.test(personalRoomId)) {
        return NextResponse.json({ error: 'Room ID must be 3-12 letters or digits' }, { status: 400 });
      }
      const existing = await prisma.teamMember.findFirst({
        where: { personalRoomId, id: { not: member.id } }
      });
      if (existing) {
        return NextResponse.json({ error: 'This Room ID is already taken.' }, { status: 400 });
      }
    }

    // Validate email if provided
    if (email !== undefined && email !== '') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
      }
      const existingEmail = await prisma.teamMember.findFirst({
        where: { email, id: { not: member.id } }
      });
      if (existingEmail) {
        return NextResponse.json({ error: 'This email is already in use.' }, { status: 400 });
      }
    }

    // Validate phone if provided
    if (phone !== undefined && phone !== '') {
      if (!/^[+]?[\d\s()-]{6,20}$/.test(phone)) {
        return NextResponse.json({ error: 'Invalid phone format' }, { status: 400 });
      }
    }

    // Auto-generate fullName
    const pieces = [firstName, middleName, lastName].filter(Boolean);
    const fullName = pieces.length > 0 ? pieces.join(' ') : member.fullName;

    // Detect email change → reset verification
    const emailChanged = email !== undefined && email !== member.email;

    const updated = await prisma.teamMember.update({
      where: { id: member.id },
      data: {
        firstName: firstName !== undefined ? firstName : undefined,
        middleName: middleName !== undefined ? middleName : undefined,
        lastName: lastName !== undefined ? lastName : undefined,
        fullName,
        biography: biography !== undefined ? biography : undefined,
        personalRoomId: personalRoomId !== undefined ? personalRoomId : undefined,
        phone: phone !== undefined ? (phone || null) : undefined,
        email: email !== undefined ? (email || null) : undefined,
        avatarUrl: avatarUrl !== undefined ? (avatarUrl || null) : undefined,
        ...(emailChanged ? { emailVerified: false, emailVerifiedAt: null } : {}),
        modifiedAt: new Date()
      }
    });

    const { passwordHash, ...safeMember } = updated;
    return NextResponse.json(safeMember);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
