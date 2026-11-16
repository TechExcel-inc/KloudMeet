import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import {
  COMPANY_BACKGROUND_LIMITS,
  MAX_COMPANY_BACKGROUNDS,
  backgroundVersion,
  cleanBackgroundName,
  companyBackgroundsForAdmin,
  isAcceptableJpeg,
  isAdminError,
  requireCompanyAdmin,
} from '@/lib/companyBackgrounds.server';
import { apiJson, runWithLocale } from '@/lib/apiMsg';

function accountIdFrom(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function payload(accountId: number, companies: { id: number; name: string }[]) {
  const company = await companyBackgroundsForAdmin(accountId);
  return { companies, company };
}

// GET /api/account/company/backgrounds?accountId= — Company settings → Camera backgrounds
export async function GET(request: NextRequest) {
  return runWithLocale(request, async () => {
  const ctx = await requireCompanyAdmin(request, accountIdFrom(request.nextUrl.searchParams.get('accountId')));
  if (isAdminError(ctx)) return ctx;
  return apiJson(await payload(ctx.accountId, ctx.companies), {
    headers: { 'Cache-Control': 'private, no-store' },
  });

  });
}

// POST /api/account/company/backgrounds — multipart: accountId, name, image (1280×720 JPEG), thumb (320×180 JPEG)
export async function POST(request: NextRequest) {
  return runWithLocale(request, async () => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiJson({ error: 'Expected a form upload' }, { status: 400 });
  }
  const ctx = await requireCompanyAdmin(request, accountIdFrom(form.get('accountId')));
  if (isAdminError(ctx)) return ctx;

  const image = form.get('image');
  const thumb = form.get('thumb');
  if (!(image instanceof Blob) || !(thumb instanceof Blob)) {
    return apiJson({ error: 'Image and thumbnail are required' }, { status: 400 });
  }
  const imageBytes = new Uint8Array(await image.arrayBuffer());
  const thumbBytes = new Uint8Array(await thumb.arrayBuffer());
  if (
    !isAcceptableJpeg(imageBytes, COMPANY_BACKGROUND_LIMITS.MAX_IMAGE_BYTES) ||
    !isAcceptableJpeg(thumbBytes, COMPANY_BACKGROUND_LIMITS.MAX_THUMB_BYTES)
  ) {
    return apiJson({ error: 'unreadable' }, { status: 400 });
  }
  const count = await prisma.accountBackground.count({ where: { accountId: ctx.accountId } });
  if (count >= MAX_COMPANY_BACKGROUNDS) return apiJson({ error: 'full' }, { status: 409 });

  const created = await prisma.accountBackground.create({
    data: {
      accountId: ctx.accountId,
      name: cleanBackgroundName(form.get('name')) ?? 'Background',
      image: Buffer.from(imageBytes),
      thumb: Buffer.from(thumbBytes),
      version: backgroundVersion(imageBytes),
      createdByMemberId: ctx.member.id,
    },
    select: { id: true },
  });
  return apiJson({ ...(await payload(ctx.accountId, ctx.companies)), createdId: created.id });

  });
}

// PUT /api/account/company/backgrounds — { accountId, defaultBackgroundId: number | null, companyOnly: boolean }
export async function PUT(request: NextRequest) {
  return runWithLocale(request, async () => {
  const body = (await request.json().catch(() => null)) as {
    accountId?: unknown;
    defaultBackgroundId?: unknown;
    companyOnly?: unknown;
  } | null;
  if (!body) return apiJson({ error: 'Invalid body' }, { status: 400 });
  const ctx = await requireCompanyAdmin(request, accountIdFrom(body.accountId));
  if (isAdminError(ctx)) return ctx;

  const data: { defaultBackgroundId?: number | null; backgroundsCompanyOnly?: boolean } = {};
  if (body.defaultBackgroundId === null) data.defaultBackgroundId = null;
  else if (body.defaultBackgroundId !== undefined) {
    const id = accountIdFrom(body.defaultBackgroundId);
    const owned = id
      ? await prisma.accountBackground.findFirst({ where: { id, accountId: ctx.accountId }, select: { id: true } })
      : null;
    if (!owned) return apiJson({ error: 'Unknown background' }, { status: 400 });
    data.defaultBackgroundId = owned.id;
  }
  if (typeof body.companyOnly === 'boolean') data.backgroundsCompanyOnly = body.companyOnly;
  await prisma.kloudMeetAccount.update({
    where: { id: ctx.accountId },
    data: { ...data, modifiedAt: new Date(), modifiedBy: String(ctx.member.id) },
  });
  return apiJson(await payload(ctx.accountId, ctx.companies));

  });
}
