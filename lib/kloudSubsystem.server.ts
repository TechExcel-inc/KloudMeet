import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { buildPeerTimeUrl, ensureHostBypassesProxy } from '@/lib/peertimeUpstream';

/**
 * SiMeet as a Kloud subsystem (the SiMeet SubSystem under Kloud Corporation).
 *
 * Everyone who signs in to SiMeet is made a member of the subsystem in Kloud, with no user input:
 * the SiMeet server calls Kloud's SubSystemExchangeToken with the subsystem's own token, which
 * finds or creates the person's Kloud user, adds them to the subsystem (existing owners and admins
 * keep their role) and returns a Kloud token that expires after a day.
 *
 * Off until both settings are present:
 *   SIMEET_KLOUD_SUBSYSTEM_ID     the subsystem's Kloud company ID
 *   SIMEET_KLOUD_SUBSYSTEM_TOKEN  its token (Customers.Token); server-side only
 */

export type KloudSubsystemConfig = { id: number; token: string };

/** Kloud roles that may browse the subsystem's content (Admin, Owner). */
const ADMIN_ROLES = new Set([7, 8]);

/** Renew a cached token this long before Kloud's one-day expiry. */
const RENEW_BEFORE_MS = 60 * 60 * 1000;

export function kloudSubsystemConfig(): KloudSubsystemConfig | null {
  const id = Number(process.env.SIMEET_KLOUD_SUBSYSTEM_ID?.trim());
  const token = process.env.SIMEET_KLOUD_SUBSYSTEM_TOKEN?.trim();
  if (!Number.isInteger(id) || id <= 0 || !token) return null;
  return { id, token };
}

export type SubsystemMember = {
  id: number;
  email: string | null;
  emailVerified: boolean;
  username: string;
  fullName: string | null;
  phone: string | null;
  phoneVerified: boolean;
  kloudUserId: string | null;
};

export type SubsystemMembership = {
  subsystemId: number;
  kloudUserId: string;
  token: string;
  role: number;
  isAdmin: boolean;
  expiresAt: number;
};

const cache = new Map<number, SubsystemMembership>();
const inFlight = new Map<number, Promise<SubsystemMembership | null>>();

type ExchangeResponse = {
  RetCode?: number;
  ErrorMessage?: string;
  RetData?: { UserID?: number; UserToken?: string; ExpiresIn?: number; Role?: number } | null;
};

/** The person's SiMeet SubSystem membership and Kloud token, joining them first if needed. */
export async function ensureKloudMembership(
  member: SubsystemMember,
  options: { now?: number; fetchImpl?: typeof fetch } = {},
): Promise<SubsystemMembership | null> {
  const config = kloudSubsystemConfig();
  if (!config) return null;
  const now = options.now ?? Date.now();

  const cached = cache.get(member.id);
  if (cached && cached.subsystemId === config.id && cached.expiresAt - RENEW_BEFORE_MS > now) return cached;

  const pending = inFlight.get(member.id);
  if (pending) return pending;

  const request = exchange(config, member, now, options.fetchImpl ?? fetch).finally(() => inFlight.delete(member.id));
  inFlight.set(member.id, request);
  return request;
}

async function exchange(
  config: KloudSubsystemConfig,
  member: SubsystemMember,
  now: number,
  fetchImpl: typeof fetch,
): Promise<SubsystemMembership | null> {
  const { url, headers } = buildPeerTimeUrl('/peertime/V1/P1Integration/SubSystemExchangeToken');
  ensureHostBypassesProxy(url);

  // Only verified contact details go to Kloud: Kloud attaches the person to the Kloud user with
  // that email or phone, so an unverified one could reach someone else's account.
  const body = {
    SubSystemID: config.id,
    UniqueID: `simeet:${member.id}`,
    Email: member.emailVerified && member.email ? member.email : undefined,
    Phone: member.phoneVerified && member.phone ? member.phone : undefined,
    LoginName: member.fullName?.trim() || member.username,
  };

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', SubSystemToken: config.token, ...headers },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => null)) as ExchangeResponse | null;
  const ret = data?.RetData;
  if (!res.ok || data?.RetCode !== 0 || !ret?.UserToken || !ret.UserID) {
    console.error('[kloud-subsystem] exchange failed', res.status, data?.RetCode, data?.ErrorMessage);
    return null;
  }

  const kloudUserId = String(ret.UserID);
  const role = typeof ret.Role === 'number' ? ret.Role : 2;
  const membership: SubsystemMembership = {
    subsystemId: config.id,
    kloudUserId,
    token: ret.UserToken,
    role,
    isAdmin: ADMIN_ROLES.has(role),
    expiresAt: now + (typeof ret.ExpiresIn === 'number' && ret.ExpiresIn > 0 ? ret.ExpiresIn * 1000 : 24 * 60 * 60 * 1000),
  };
  cache.set(member.id, membership);
  await rememberKloudUser(member, kloudUserId);
  return membership;
}

/** Saves the Kloud user on the member the first time; never replaces a different linked user. */
async function rememberKloudUser(member: SubsystemMember, kloudUserId: string) {
  if (member.kloudUserId === kloudUserId) return;
  if (member.kloudUserId) {
    // Signed in with Kloud as someone else than the Kloud user their verified email belongs to.
    console.warn('[kloud-subsystem] member', member.id, 'is linked to another Kloud user; keeping that link');
    return;
  }
  try {
    await prisma.teamMember.updateMany({
      where: { id: member.id, kloudUserId: null },
      data: { kloudUserId, kloudLinkedAt: new Date() },
    });
    member.kloudUserId = kloudUserId;
  } catch (error) {
    // Another SiMeet member already holds this Kloud user (the same email on two accounts).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      console.warn('[kloud-subsystem] Kloud user', kloudUserId, 'already belongs to another member');
      return;
    }
    throw error;
  }
}

/**
 * Fire and forget after a sign-in: a Kloud outage must never stop someone signing in.
 * Takes the member row, or just its id (then it is loaded here).
 */
export function joinKloudSubsystemInBackground(member: SubsystemMember | { id: number }) {
  if (!kloudSubsystemConfig()) return;
  void (async () => {
    const full = 'username' in member ? member : await prisma.teamMember.findUnique({ where: { id: member.id } });
    if (full) await ensureKloudMembership(full);
  })().catch((error) => console.error('[kloud-subsystem] join failed', error));
}

/** For tests. */
export function clearKloudSubsystemCache() {
  cache.clear();
  inFlight.clear();
}
