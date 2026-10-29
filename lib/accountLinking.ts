import crypto from 'crypto';
import { prisma } from '@/lib/db';

/**
 * Sign-in methods on one Kloud Meet account (email & password, Google, Kloud).
 *
 * - Methods are bound by ID (googleId, kloudUserId), never re-guessed from the email.
 * - Connecting from My Profile goes through a one-time intent: the signed-in page asks for a token,
 *   the browser carries it through the provider's redirect, and the callback redeems it once.
 * - A method can be removed only while another way to sign in remains.
 */

export type LinkProvider = 'google' | 'kloud';

export const LINK_INTENT_TTL_MS = 10 * 60 * 1000;

const sha256Hex = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

/** Verification-code target for confirming `email` on one account (bound to the member, short enough for the column). */
export function emailCodeTarget(memberId: number, email: string): string {
  return `chg:${sha256Hex(`${memberId}:${email}`)}`;
}

export async function createLinkIntent(teamMemberId: number, provider: LinkProvider, now = new Date()): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.accountLinkIntent.create({
    data: {
      tokenHash: sha256Hex(token),
      teamMemberId,
      provider,
      expiresAt: new Date(now.getTime() + LINK_INTENT_TTL_MS),
    },
  });
  // Opportunistic cleanup of old rows.
  await prisma.accountLinkIntent
    .deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } })
    .catch(() => undefined);
  return token;
}

const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** A well-formed intent token (base64url of 32 bytes), or null. */
export function validLinkToken(raw: unknown): string | null {
  return typeof raw === 'string' && LINK_TOKEN_RE.test(raw) ? raw : null;
}

/** Redeems an intent once; returns the member who asked for it, or null. */
export async function redeemLinkIntent(token: unknown, provider: LinkProvider, now = new Date()): Promise<number | null> {
  const valid = validLinkToken(token);
  if (!valid) return null;
  const row = await prisma.accountLinkIntent.findUnique({ where: { tokenHash: sha256Hex(valid) } });
  if (!row || row.provider !== provider || row.usedAt || row.expiresAt <= now) return null;
  const claimed = await prisma.accountLinkIntent.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: now },
  });
  return claimed.count === 1 ? row.teamMemberId : null;
}

type MethodFacts = {
  email: string | null;
  emailVerified: boolean;
  googleId: string | null;
  kloudUserId: string | null;
};

/**
 * Whether `provider` can be disconnected and the person can still sign in:
 * a verified email (password, or "Forgot password" to set one) or the other provider.
 */
export function canDisconnect(member: MethodFacts, provider: LinkProvider): boolean {
  const emailWorks = Boolean(member.email && member.emailVerified);
  if (provider === 'google') return Boolean(member.googleId) && (emailWorks || Boolean(member.kloudUserId));
  return Boolean(member.kloudUserId) && (emailWorks || Boolean(member.googleId));
}

/** What My Profile shows under "Sign-in methods". */
export function signInMethodsOf(member: MethodFacts) {
  return {
    email: member.email,
    emailVerified: member.emailVerified,
    google: { connected: Boolean(member.googleId), canDisconnect: canDisconnect(member, 'google') },
    kloud: { connected: Boolean(member.kloudUserId), canDisconnect: canDisconnect(member, 'kloud') },
  };
}
