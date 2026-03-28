import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    
    // Fetch session
    const session = await prisma.session.findUnique({
      where: { token },
      include: { teamMember: true }
    });

    if (!session || !session.teamMember) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const member = session.teamMember;

    const meetings = await prisma.meeting.findMany({
      where: {
        createdByMemberId: member.id,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        recordings: {
          select: {
            id: true,
            status: true,
            storageUrl: true,
            durationSeconds: true,
          }
        },
        createdByMember: {
          select: { fullName: true, username: true }
        }
      }
    });

    return NextResponse.json({ meetings });
  } catch (error) {
    console.error('[account meetings GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
