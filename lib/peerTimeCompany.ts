import {
  buildPeerTimeUrl,
  ensureHostBypassesProxy,
} from '@/lib/peertimeUpstream';
import type { NextRequest } from 'next/server';

const DEFAULT_FALLBACK_COMPANY_ID = 3255;

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

/**
 * Resolve PeerTime companyId (SchoolID) for LiveDoc / meeting_document tenancy.
 * Order: explicit body value → UserToken profile → SSO cookie profile → env fallback.
 */
export async function resolvePeerTimeCompanyId(options: {
  request: NextRequest;
  userToken?: string | null;
  explicitCompanyId?: unknown;
}): Promise<number> {
  const explicit = parsePositiveInt(options.explicitCompanyId);
  if (explicit) return explicit;

  const tokens: string[] = [];
  if (options.userToken) tokens.push(options.userToken);
  const sso = options.request.cookies.get('kloud_sso_token')?.value;
  if (sso) {
    try {
      tokens.push(decodeURIComponent(sso));
    } catch {
      tokens.push(sso);
    }
  }

  for (const token of tokens) {
    const companyId = await fetchCompanyIdFromUserProfile(token);
    if (companyId) return companyId;
  }

  const fromEnv = parsePositiveInt(process.env.PEERTIME_DEFAULT_COMPANY_ID);
  return fromEnv ?? DEFAULT_FALLBACK_COMPANY_ID;
}

async function fetchCompanyIdFromUserProfile(userToken: string): Promise<number | null> {
  try {
    const { url, headers } = buildPeerTimeUrl('/peertime/V1/User/UserProfile');
    ensureHostBypassesProxy(url);
    const res = await fetch(url, {
      headers: { UserToken: userToken, ...headers },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      RetCode?: number;
      RetData?: Record<string, unknown>;
    };
    if (data.RetCode !== 0 || !data.RetData) return null;
    return (
      parsePositiveInt(data.RetData.SchoolID) ??
      parsePositiveInt(data.RetData.schoolID) ??
      parsePositiveInt(data.RetData.CustomerID) ??
      parsePositiveInt(data.RetData.CompanyID) ??
      null
    );
  } catch (error) {
    console.warn('[peerTimeCompany] UserProfile failed', error);
    return null;
  }
}

/** PeerTime UserID from UserToken (for LessonMember sync). */
export async function fetchPeerTimeUserId(userToken: string): Promise<number | null> {
  try {
    const { url, headers } = buildPeerTimeUrl('/peertime/V1/User/UserProfile');
    ensureHostBypassesProxy(url);
    const res = await fetch(url, {
      headers: { UserToken: userToken, ...headers },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      RetCode?: number;
      RetData?: Record<string, unknown>;
    };
    if (data.RetCode !== 0 || !data.RetData) return null;
    return (
      parsePositiveInt(data.RetData.UserID) ??
      parsePositiveInt(data.RetData.userid) ??
      parsePositiveInt(data.RetData.MemberID) ??
      null
    );
  } catch {
    return null;
  }
}

export async function resolveMemberAccountId(teamMemberId: number): Promise<number | null> {
  const { prisma } = await import('@/lib/db');
  const ownership = await prisma.accountOwnerAndAdmin.findFirst({
    where: { teamMemberId, status: 'ACTIVE' },
    select: { accountId: true },
    orderBy: { id: 'asc' },
  });
  if (ownership?.accountId) return ownership.accountId;
  const membership = await prisma.accountMembership.findFirst({
    where: { teamMemberId, status: 'ACTIVE' },
    select: { accountId: true },
    orderBy: { id: 'asc' },
  });
  return membership?.accountId ?? null;
}
