/**
 * Account rules shared by the sign-up / reset forms and the auth API (client-safe, no Node imports).
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^(?!\d+$)[a-zA-Z0-9]{2,20}$/;

/** Trimmed, lower-cased email, or null when it does not look like an address. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

/** 2–20 letters and digits, not all digits. */
export function isValidUsername(raw: unknown): raw is string {
  return typeof raw === 'string' && USERNAME_RE.test(raw);
}

/** 8–64 characters (symbols allowed) with at least one letter and one digit. */
export function isValidPassword(raw: unknown): raw is string {
  return (
    typeof raw === 'string' &&
    raw.length >= PASSWORD_MIN_LENGTH &&
    raw.length <= PASSWORD_MAX_LENGTH &&
    /[A-Za-z]/.test(raw) &&
    /\d/.test(raw)
  );
}

/** Email codes are only sent for these flows; SMS is not available yet. `email` confirms a new address in My Profile. */
export type CodePurpose = 'signup' | 'reset' | 'email';

export function codePurpose(intent: unknown): CodePurpose {
  return intent === 'reset' ? 'reset' : 'signup';
}
