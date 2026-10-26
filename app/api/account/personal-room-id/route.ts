import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isValidPersonalRoomId, personalRoomIdCandidates } from '@/lib/personalRoomId';

async function getAuthMember(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  const session = await prisma.session.findUnique({
    where: { token },
    include: { teamMember: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.teamMember;
}

/** Lower-cased IDs from `ids` that another member already holds (IDs are case-insensitive). */
async function takenByOthers(ids: string[], memberId: number): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const keys = ids.map((id) => id.toLowerCase());
  const rows = await prisma.$queryRaw<Array<{ k: string }>>`
    SELECT LOWER(TRIM(personalRoomId)) AS k FROM TeamMember
    WHERE personalRoomId IS NOT NULL
      AND id <> ${memberId}
      AND LOWER(TRIM(personalRoomId)) IN (${Prisma.join(keys)})
  `;
  return new Set(rows.map((r) => r.k));
}

/**
 * GET                → { suggestion }            a free ID built from the member's names
 * GET ?check=<id>    → { id, valid, available, suggestions }
 * Saving still goes through PUT /api/account/profile.
 */
export async function GET(request: NextRequest) {
  try {
    const member = await getAuthMember(request);
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const names = { username: member.username, fullName: member.fullName, email: member.email };
    const check = request.nextUrl.searchParams.get('check');

    if (check === null) {
      const candidates = personalRoomIdCandidates(names).slice(0, 12);
      const taken = await takenByOthers(candidates, member.id);
      const suggestion = candidates.find((c) => !taken.has(c.toLowerCase())) ?? null;
      return NextResponse.json({ suggestion });
    }

    const id = check.trim().slice(0, 32);
    const valid = isValidPersonalRoomId(id);
    const candidates = personalRoomIdCandidates(names, id).slice(0, 16);
    const pool = valid ? [id, ...candidates] : candidates;
    const taken = await takenByOthers(pool, member.id);
    const available = valid && !taken.has(id.toLowerCase());
    const suggestions = available
      ? []
      : candidates.filter((c) => c.toLowerCase() !== id.toLowerCase() && !taken.has(c.toLowerCase())).slice(0, 3);

    return NextResponse.json({ id, valid, available, suggestions });
  } catch (error) {
    console.error('[personal-room-id GET]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
