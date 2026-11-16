import { NextRequest } from 'next/server';
import { isAuthError, requireSession } from '@/lib/apiAuth';
import { companyBackgroundsForMember } from '@/lib/companyBackgrounds.server';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

// GET /api/account/backgrounds — the camera backgrounds of the companies you belong to
export async function GET(request: NextRequest) {
  return runWithLocale(request, async () => {
  const member = await requireSession(request);
  if (isAuthError(member)) return member;
  try {
    const companies = await companyBackgroundsForMember(member.id);
    return apiJson({ companies }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[account/backgrounds GET]', error);
    return apiJson({ error: 'Failed to load company backgrounds' }, { status: 500 });
  }

  });
}
