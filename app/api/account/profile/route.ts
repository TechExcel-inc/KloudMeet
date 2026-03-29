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
    const { firstName, middleName, lastName, biography, personalRoomId } = body;
    
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
        personalRoomId: personalRoomId !== undefined ? personalRoomId : undefined,
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
