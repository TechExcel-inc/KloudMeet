import { prisma } from '@/lib/db';
import { NextRequest } from 'next/server';

/** Resolve logged-in team member from `Authorization: Bearer <session token>`. */
export async function getSessionTeamMember(request: NextRequest) {
  const authHeader =
    request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const session = await prisma.session.findUnique({
    where: { token },
    include: { teamMember: true },
  });

  if (!session || session.expiresAt < new Date()) return null;
  if (session.teamMember.status !== 'ACTIVE') return null;

  return session.teamMember;
}
