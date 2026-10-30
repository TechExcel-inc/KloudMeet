/**
 * Company camera backgrounds (Company settings → Camera backgrounds). Owners and admins add images
 * for everyone in the company; members see them first in the background picker. Images are kept in
 * the database and served from this site at a URL that changes with the picture, so browsers keep
 * them forever and the camera cut-out can read them (same origin, fast in mainland China).
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { TeamMember } from '@prisma/client';
import { prisma } from '@/lib/db';
import { forbidden, isAuthError, requireSession } from '@/lib/apiAuth';

export const MAX_COMPANY_BACKGROUNDS = 12;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_THUMB_BYTES = 256 * 1024;
const MAX_NAME_LENGTH = 80;

export type BackgroundImageSize = 'full' | 'thumb';

export interface CompanyBackgroundItem {
  id: number;
  name: string;
  imageUrl: string;
  thumbUrl: string;
}

export interface CompanyBackgroundsForMember {
  id: number;
  name: string;
  companyOnly: boolean;
  defaultBackgroundId: number | null;
  backgrounds: CompanyBackgroundItem[];
}

export function companyBackgroundUrl(id: number, version: string, size: BackgroundImageSize): string {
  return `/api/company-backgrounds/${id}/${version}/${size}`;
}

function toItem(row: { id: number; name: string; version: string }): CompanyBackgroundItem {
  return {
    id: row.id,
    name: row.name,
    imageUrl: companyBackgroundUrl(row.id, row.version, 'full'),
    thumbUrl: companyBackgroundUrl(row.id, row.version, 'thumb'),
  };
}

export function backgroundVersion(image: Uint8Array): string {
  return crypto.createHash('sha256').update(image).digest('hex').slice(0, 16);
}

/** A JPEG, not too big: the picker crops and encodes in the browser before uploading. */
export function isAcceptableJpeg(bytes: Uint8Array, maxBytes: number): boolean {
  return bytes.length > 3 && bytes.length <= maxBytes && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function cleanBackgroundName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
  return name || null;
}

const accountSelect = {
  id: true,
  accountName: true,
  backgroundsCompanyOnly: true,
  defaultBackgroundId: true,
  backgrounds: { select: { id: true, name: true, version: true }, orderBy: { createdAt: 'asc' as const } },
};

/** Companies the person belongs to (member, owner or admin) that have backgrounds. */
export async function companyBackgroundsForMember(memberId: number): Promise<CompanyBackgroundsForMember[]> {
  const accounts = await prisma.kloudMeetAccount.findMany({
    where: {
      deletedAt: null,
      backgrounds: { some: {} },
      OR: [
        { memberships: { some: { teamMemberId: memberId, status: 'ACTIVE', deletedAt: null } } },
        { ownersAndAdmins: { some: { teamMemberId: memberId, status: 'ACTIVE' } } },
      ],
    },
    select: accountSelect,
    orderBy: { id: 'asc' },
  });
  return accounts.map((account) => ({
    id: account.id,
    name: account.accountName,
    companyOnly: account.backgroundsCompanyOnly,
    defaultBackgroundId: account.backgrounds.some((b) => b.id === account.defaultBackgroundId)
      ? account.defaultBackgroundId
      : null,
    backgrounds: account.backgrounds.map(toItem),
  }));
}

export interface ManagedCompany {
  id: number;
  name: string;
}

/** Companies the person can manage (owner or admin). */
export async function managedCompanies(memberId: number): Promise<ManagedCompany[]> {
  const rows = await prisma.accountOwnerAndAdmin.findMany({
    where: { teamMemberId: memberId, status: 'ACTIVE', account: { deletedAt: null } },
    select: { account: { select: { id: true, accountName: true } } },
    orderBy: { id: 'asc' },
  });
  const seen = new Set<number>();
  const out: ManagedCompany[] = [];
  for (const row of rows) {
    if (seen.has(row.account.id)) continue;
    seen.add(row.account.id);
    out.push({ id: row.account.id, name: row.account.accountName });
  }
  return out;
}

export type CompanyAdminContext = { member: TeamMember; accountId: number; companies: ManagedCompany[] };

/** Signed in, and owner or admin of `accountId` (or of their first company when none is given). */
export async function requireCompanyAdmin(
  request: NextRequest,
  accountId?: number | null,
): Promise<CompanyAdminContext | NextResponse> {
  const member = await requireSession(request);
  if (isAuthError(member)) return member;
  const companies = await managedCompanies(member.id);
  if (companies.length === 0) return forbidden('Only a company owner or admin can do this');
  const chosen = accountId ? companies.find((c) => c.id === accountId) : companies[0];
  if (!chosen) return forbidden('Only a company owner or admin can do this');
  return { member, accountId: chosen.id, companies };
}

export function isAdminError(v: CompanyAdminContext | NextResponse): v is NextResponse {
  return v instanceof NextResponse;
}

/** Everything the Company settings page shows for one company. */
export async function companyBackgroundsForAdmin(accountId: number) {
  const account = await prisma.kloudMeetAccount.findUnique({ where: { id: accountId }, select: accountSelect });
  if (!account) return null;
  return {
    id: account.id,
    name: account.accountName,
    companyOnly: account.backgroundsCompanyOnly,
    defaultBackgroundId: account.backgrounds.some((b) => b.id === account.defaultBackgroundId)
      ? account.defaultBackgroundId
      : null,
    backgrounds: account.backgrounds.map(toItem),
    max: MAX_COMPANY_BACKGROUNDS,
  };
}

export const COMPANY_BACKGROUND_LIMITS = { MAX_IMAGE_BYTES, MAX_THUMB_BYTES };
