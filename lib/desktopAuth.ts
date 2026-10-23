import crypto from 'crypto';
import { prisma } from '@/lib/db';

/**
 * Desktop app sign-in through the system browser (Google blocks sign-in inside embedded windows).
 *
 * 1. The app makes a random PKCE verifier, keeps it in memory and opens
 *    /api/auth/google?desktop=<sha256(verifier)> in the default browser.
 * 2. After Google sign-in the callback stores a one-time hand-off code (hashed, 5 minutes) bound to
 *    that challenge and shows /auth/desktop, which opens kloudmeet://auth?code=….
 * 3. The app posts code + verifier to /api/auth/desktop/exchange and receives a session token.
 *    A code read from the deep link alone is useless without the verifier.
 */

export const HANDOFF_TTL_MS = 5 * 60 * 1000;

const sha256Hex = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export function pkceChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export async function createDesktopHandoff(input: {
  teamMemberId: number;
  challenge: string;
  next: string | null;
  now?: Date;
}): Promise<string> {
  const now = input.now ?? new Date();
  const code = crypto.randomBytes(32).toString('base64url');
  await prisma.desktopAuthHandoff.create({
    data: {
      codeHash: sha256Hex(code),
      teamMemberId: input.teamMemberId,
      challenge: input.challenge,
      next: input.next,
      expiresAt: new Date(now.getTime() + HANDOFF_TTL_MS),
    },
  });
  // Opportunistic cleanup of old rows.
  await prisma.desktopAuthHandoff
    .deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } })
    .catch(() => undefined);
  return code;
}

export type HandoffResult = { ok: true; teamMemberId: number; next: string | null } | { ok: false };

/** Redeems a hand-off code once, only together with the verifier whose hash started the flow. */
export async function redeemDesktopHandoff(code: unknown, verifier: unknown, now = new Date()): Promise<HandoffResult> {
  if (typeof code !== 'string' || typeof verifier !== 'string') return { ok: false };
  if (code.length < 20 || code.length > 100 || verifier.length < 43 || verifier.length > 128) return { ok: false };

  const row = await prisma.desktopAuthHandoff.findUnique({ where: { codeHash: sha256Hex(code) } });
  if (!row || row.usedAt || row.expiresAt <= now) return { ok: false };

  const expected = Buffer.from(row.challenge);
  const actual = Buffer.from(pkceChallenge(verifier));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return { ok: false };

  const claimed = await prisma.desktopAuthHandoff.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return { ok: false };
  return { ok: true, teamMemberId: row.teamMemberId, next: row.next };
}
