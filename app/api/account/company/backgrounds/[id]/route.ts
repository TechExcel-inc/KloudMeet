import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  cleanBackgroundName,
  companyBackgroundsForAdmin,
  isAdminError,
  requireCompanyAdmin,
} from '@/lib/companyBackgrounds.server';

type Params = { params: Promise<{ id: string }> };

async function findBackground(params: Params['params']) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return prisma.accountBackground.findUnique({ where: { id }, select: { id: true, accountId: true } });
}

// PATCH /api/account/company/backgrounds/:id — { name }
export async function PATCH(request: NextRequest, { params }: Params) {
  const background = await findBackground(params);
  if (!background) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const ctx = await requireCompanyAdmin(request, background.accountId);
  if (isAdminError(ctx)) return ctx;
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = cleanBackgroundName(body?.name);
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });
  await prisma.accountBackground.update({ where: { id: background.id }, data: { name, modifiedAt: new Date() } });
  return NextResponse.json({ companies: ctx.companies, company: await companyBackgroundsForAdmin(ctx.accountId) });
}

// DELETE /api/account/company/backgrounds/:id — also clears it as the members' default
export async function DELETE(request: NextRequest, { params }: Params) {
  const background = await findBackground(params);
  if (!background) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const ctx = await requireCompanyAdmin(request, background.accountId);
  if (isAdminError(ctx)) return ctx;
  await prisma.$transaction([
    prisma.kloudMeetAccount.updateMany({
      where: { id: ctx.accountId, defaultBackgroundId: background.id },
      data: { defaultBackgroundId: null },
    }),
    prisma.accountBackground.delete({ where: { id: background.id } }),
  ]);
  return NextResponse.json({ companies: ctx.companies, company: await companyBackgroundsForAdmin(ctx.accountId) });
}
