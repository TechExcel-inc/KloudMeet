import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/authPolicy';
import { validLinkToken } from '@/lib/accountLinking';
import { safeReplayNext } from '@/lib/recordingReplayPath';
import { buildMeetingServerUrl, buildPeerTimeUrl, ensureHostBypassesProxy } from '@/lib/peertimeUpstream';

/**
 * "Continue with Kloud" / "Connect Kloud account" (decisions 1–3, 2026-10-28):
 * a Kloud account is an optional sign-in method bound to one Kloud Meet account by Kloud user ID.
 *
 * 1. /api/auth/kloud stores a random state (plus `next` or a Connect intent) in a short-lived cookie
 *    and sends the browser to kloud.cn/kloudmeet/connect.
 * 2. After the person signs in there and confirms, kloud.cn posts { state, token } back to
 *    /api/auth/kloud/callback (a form post, so the token never sits in a URL).
 * 3. The callback checks the state against the cookie, reads the Kloud user and companies with that
 *    token, and keeps only the Kloud user ID and the company list. The token itself is not stored.
 *
 * Company memberships flow one way, Kloud → Kloud Meet: a Kloud Meet company mapped to a Kloud
 * company gets the person as a member ("joinedVia KLOUD"); leaving the Kloud company removes only
 * those memberships, never ones added in Kloud Meet.
 */

export const KLOUD_STATE_COOKIE = 'km_kloud_auth';
export const KLOUD_STATE_MAX_AGE_SECONDS = 10 * 60;
const COOKIE_PATH = '/api/auth/kloud';

/** Kloud company roles (PeerTime CompanyMemberRoleEnum) that may map a company. */
export const KLOUD_ROLE_ADMIN = 7;
export const KLOUD_ROLE_OWNER = 8;

/** How long the company list from the last Kloud sign-in is trusted for mapping a company. */
export const KLOUD_COMPANIES_FRESH_MS = 60 * 60 * 1000;

/** The kloud.cn page that confirms the hand-off is live (it ships with Kloud-Web). */
export function kloudSignInAvailable(): boolean {
  return process.env.NEXT_PUBLIC_KLOUD_SIGN_IN === '1';
}

export function kloudWebOrigin(): string {
  return (process.env.KLOUD_WEB_ORIGIN?.trim() || 'https://kloud.cn').replace(/\/+$/, '');
}

export type KloudStatePayload = { state: string; next: string | null; link: string | null };

export function newKloudState(rawNext: string | null, rawLink: string | null): KloudStatePayload {
  return {
    state: crypto.randomBytes(24).toString('hex'),
    next: safeReplayNext(rawNext),
    link: validLinkToken(rawLink),
  };
}

export function encodeKloudState(payload: KloudStatePayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeKloudState(raw: string | undefined | null): KloudStatePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed?.state !== 'string' || !parsed.state) return null;
    return {
      state: parsed.state,
      next: safeReplayNext(typeof parsed.next === 'string' ? parsed.next : null),
      link: validLinkToken(parsed.link),
    };
  } catch {
    return null;
  }
}

export function kloudStateCookieOptions(origin: string, maxAge = KLOUD_STATE_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: origin.startsWith('https://'),
    // meet.kloud.cn and kloud.cn are the same site, so Lax still rides along on kloud.cn's form post.
    sameSite: 'lax' as const,
    path: COOKIE_PATH,
    maxAge,
  };
}

export function kloudConnectUrl(origin: string, state: string): string {
  const params = new URLSearchParams({ state, return: `${origin}/api/auth/kloud/callback` });
  return `${kloudWebOrigin()}/kloudmeet/connect?${params.toString()}`;
}

export type KloudCompany = { id: string; name: string; role: number | null };

export type KloudUser = {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
  avatarUrl: string | null;
  companies: KloudCompany[];
};

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

async function peerTimeGet(path: string, token: string): Promise<unknown> {
  const { url, headers } = buildPeerTimeUrl(path);
  ensureHostBypassesProxy(url);
  const res = await fetch(url, { headers: { UserToken: token, ...headers }, cache: 'no-store' });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body && body.RetCode === 0 ? body.RetData : null;
}

async function meetingServerGet(path: string, token: string): Promise<unknown> {
  const { url, headers } = buildMeetingServerUrl(path);
  ensureHostBypassesProxy(url);
  const res = await fetch(url, { headers: { UserToken: token, ...headers }, cache: 'no-store' });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body && Number(body.code) === 0 ? body.data : null;
}

/** Reads the Kloud user behind `token`, with their companies and roles; null when Kloud rejects it. */
export async function fetchKloudUser(token: string): Promise<KloudUser | null> {
  const profile = (await peerTimeGet('/peertime/V1/User/UserProfile', token)) as Record<string, unknown> | null;
  const id = str(profile?.UserID);
  if (!profile || !id || id === '0') return null;
  // Anonymous meeting accounts are not people to sign in as.
  const anonymous = [profile.IsAnonymousUser, profile.IsAnonymous].some((v) => v === true || v === 1 || v === '1');
  if (anonymous || str(profile.Name).toLowerCase() === 'anonymous') return null;

  const list = await peerTimeGet(`/peertime/V1/School/UserSchoolList?userID=${encodeURIComponent(id)}`, token);
  const schools = Array.isArray(list) ? list.slice(0, 30) : [];
  const companies: KloudCompany[] = [];
  for (const school of schools as Array<Record<string, unknown>>) {
    const companyId = str(school.SchoolID);
    if (!companyId || companyId === '0' || companies.some((c) => c.id === companyId)) continue;
    const member = (await meetingServerGet(
      `/company_member/member?companyId=${encodeURIComponent(companyId)}&memberId=${encodeURIComponent(id)}`,
      token,
    ).catch(() => null)) as Record<string, unknown> | null;
    const role = Number(member?.role);
    companies.push({ id: companyId, name: str(school.SchoolName) || `Company ${companyId}`, role: Number.isFinite(role) ? role : null });
  }

  return {
    id,
    email: normalizeEmail(profile.Email ?? profile.email),
    phone: str(profile.Mobile ?? profile.mobile ?? profile.Phone) || null,
    name: str(profile.Name ?? profile.UserName) || '',
    avatarUrl: str(profile.AvatarUrl ?? profile.Avatar) || null,
    companies,
  };
}

/** Keeps the company list for mapping and brings memberships of mapped companies in line with it. */
export async function recordKloudCompanies(teamMemberId: number, companies: KloudCompany[], now = new Date()) {
  await prisma.teamMember.update({
    where: { id: teamMemberId },
    data: { kloudCompanies: companies, kloudCompaniesAt: now },
  });
  await syncKloudMemberships(teamMemberId, companies, now);
}

/** One-way sync: member of the Kloud Meet companies mapped to `companies`, and no other "from Kloud" ones. */
export async function syncKloudMemberships(teamMemberId: number, companies: KloudCompany[], now = new Date()) {
  const ids = companies.map((c) => c.id);
  const mapped = ids.length
    ? await prisma.kloudMeetAccount.findMany({ where: { kloudCompanyId: { in: ids }, status: 1 }, select: { id: true } })
    : [];
  const keep = mapped.map((a) => a.id);

  for (const accountId of keep) {
    const existing = await prisma.accountMembership.findUnique({
      where: { accountId_teamMemberId: { accountId, teamMemberId } },
    });
    if (!existing) {
      await prisma.accountMembership.create({
        data: { accountId, teamMemberId, status: 'ACTIVE', joinedVia: 'KLOUD', createdBy: 'kloud-sync' },
      });
    } else if (existing.status !== 'ACTIVE' || existing.deletedAt) {
      await prisma.accountMembership.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          joinedVia: 'KLOUD',
          deletedAt: null,
          deletedBy: null,
          modifiedAt: now,
          modifiedBy: 'kloud-sync',
        },
      });
    }
  }

  await prisma.accountMembership.updateMany({
    where: { teamMemberId, joinedVia: 'KLOUD', status: 'ACTIVE', accountId: { notIn: keep } },
    data: { status: 'REMOVED', deletedAt: now, deletedBy: 'kloud-sync', modifiedAt: now, modifiedBy: 'kloud-sync' },
  });
}

/** Ends every membership that came from Kloud (the Kloud account was disconnected). */
export async function removeKloudMemberships(teamMemberId: number, now = new Date()) {
  await prisma.accountMembership.updateMany({
    where: { teamMemberId, joinedVia: 'KLOUD', status: 'ACTIVE' },
    data: { status: 'REMOVED', deletedAt: now, deletedBy: 'kloud-disconnect', modifiedAt: now, modifiedBy: 'kloud-disconnect' },
  });
  await prisma.teamMember.update({
    where: { id: teamMemberId },
    data: { kloudCompanies: [], kloudCompaniesAt: null },
  });
}

/** Companies from the last Kloud sign-in, if recent enough to act on. */
export function freshKloudCompanies(
  member: { kloudCompanies: unknown; kloudCompaniesAt: Date | null },
  now = new Date(),
): KloudCompany[] | null {
  if (!member.kloudCompaniesAt || now.getTime() - member.kloudCompaniesAt.getTime() > KLOUD_COMPANIES_FRESH_MS) return null;
  if (!Array.isArray(member.kloudCompanies)) return [];
  return (member.kloudCompanies as Array<Record<string, unknown>>)
    .map((c) => ({ id: str(c.id), name: str(c.name), role: typeof c.role === 'number' ? c.role : null }))
    .filter((c) => c.id);
}

export function canMapKloudCompany(company: KloudCompany): boolean {
  return company.role === KLOUD_ROLE_OWNER || company.role === KLOUD_ROLE_ADMIN;
}
