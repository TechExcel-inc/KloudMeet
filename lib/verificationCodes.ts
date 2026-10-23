import crypto from 'crypto';
import { prisma } from '@/lib/db';
import type { CodePurpose } from '@/lib/authPolicy';

/**
 * Email verification codes (sign-up and password reset).
 * - 6 random digits from a CSPRNG, valid 10 minutes.
 * - Issuing a new code retires the earlier unused ones, so only the latest code works.
 * - Max 5 wrong guesses per code, then it is burned; 60 s between sends, 5 sends per hour.
 */

export const CODE_TTL_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_CODES_PER_HOUR = 5;

const TYPE_BY_PURPOSE: Record<CodePurpose, string> = {
  signup: 'SIGNUP_EMAIL',
  reset: 'RESET_EMAIL',
};

export function codeType(purpose: CodePurpose): string {
  return TYPE_BY_PURPOSE[purpose];
}

export type IssueResult =
  | { ok: true; id: number; code: string }
  | { ok: false; reason: 'cooldown' | 'hourly_limit'; retryAfterSeconds: number };

export async function issueCode(target: string, purpose: CodePurpose, now = new Date()): Promise<IssueResult> {
  const type = codeType(purpose);
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const recent = await prisma.verificationCode.findMany({
    where: { target, type, createdAt: { gt: hourAgo } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  const latest = recent[0];
  if (latest) {
    const elapsed = (now.getTime() - latest.createdAt.getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      return { ok: false, reason: 'cooldown', retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed) };
    }
  }
  if (recent.length >= MAX_CODES_PER_HOUR) {
    const oldest = recent[recent.length - 1].createdAt.getTime();
    return {
      ok: false,
      reason: 'hourly_limit',
      retryAfterSeconds: Math.max(60, Math.ceil((oldest + 60 * 60 * 1000 - now.getTime()) / 1000)),
    };
  }

  await prisma.verificationCode.updateMany({ where: { target, type, used: false }, data: { used: true } });

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const row = await prisma.verificationCode.create({
    data: {
      target,
      code,
      type,
      expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000),
      used: false,
    },
  });
  return { ok: true, id: row.id, code };
}

/** Removes a code whose email could not be delivered, so the user can retry at once. */
export async function discardCode(id: number): Promise<void> {
  await prisma.verificationCode.delete({ where: { id } }).catch(() => undefined);
}

export type CheckResult = { ok: true; id: number } | { ok: false; attemptsLeft: number };

/**
 * Checks `code` against the latest live code for `target`. Wrong guesses count toward the cap.
 * With `consume`, a correct code is marked used (exactly once, even under concurrent requests).
 */
export async function checkCode(
  target: string,
  purpose: CodePurpose,
  code: unknown,
  { consume = false, now = new Date() }: { consume?: boolean; now?: Date } = {},
): Promise<CheckResult> {
  const vc = await prisma.verificationCode.findFirst({
    where: { target, type: codeType(purpose), used: false, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  });
  if (!vc || vc.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, attemptsLeft: 0 };

  const given = typeof code === 'string' ? code.trim() : '';
  const a = Buffer.from(given);
  const b = Buffer.from(vc.code);
  const matches = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!matches) {
    const attempts = vc.attempts + 1;
    await prisma.verificationCode.update({
      where: { id: vc.id },
      data: { attempts, ...(attempts >= MAX_CODE_ATTEMPTS ? { used: true } : {}) },
    });
    return { ok: false, attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - attempts) };
  }

  if (consume) {
    const claimed = await prisma.verificationCode.updateMany({
      where: { id: vc.id, used: false },
      data: { used: true },
    });
    if (claimed.count !== 1) return { ok: false, attemptsLeft: 0 };
  }
  return { ok: true, id: vc.id };
}

export function codeErrorMessage(result: { attemptsLeft: number }): string {
  return result.attemptsLeft > 0
    ? `That code is not right. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'try' : 'tries'} left.`
    : 'This code is no longer valid. Request a new one.';
}

export function issueErrorMessage(result: { reason: 'cooldown' | 'hourly_limit'; retryAfterSeconds: number }): string {
  return result.reason === 'cooldown'
    ? `Please wait ${result.retryAfterSeconds}s before requesting another code.`
    : 'Too many codes requested. Please try again later.';
}
