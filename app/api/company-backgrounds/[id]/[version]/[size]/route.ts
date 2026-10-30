import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/company-backgrounds/:id/:version/full|thumb — a company camera background.
 * No sign-in: the image is what everyone in a meeting sees anyway, and the version (a hash of the
 * picture) can't be guessed. A new picture gets a new URL, so it may be kept forever.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string; size: string }> },
) {
  const { id, version, size } = await params;
  const backgroundId = Number(id);
  if (!Number.isInteger(backgroundId) || backgroundId <= 0 || !/^[0-9a-f]{16}$/.test(version)) {
    return new NextResponse(null, { status: 404 });
  }
  if (size !== 'full' && size !== 'thumb') return new NextResponse(null, { status: 404 });
  const row = await prisma.accountBackground.findUnique({
    where: { id: backgroundId },
    select: { version: true, image: size === 'full', thumb: size === 'thumb' },
  });
  if (!row || row.version !== version) return new NextResponse(null, { status: 404 });
  const bytes = size === 'full' ? row.image : row.thumb;
  if (!bytes) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
