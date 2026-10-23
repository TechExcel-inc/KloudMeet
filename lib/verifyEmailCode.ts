import type { CodePurpose } from '@/lib/authPolicy';

/** Confirms an emailed code with the server (without using it up). Returns an error message or null. */
export async function verifyEmailCode(
  email: string,
  code: string,
  intent: CodePurpose,
  fallbackError: string,
): Promise<string | null> {
  const res = await fetch('/api/auth/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: email, code, intent }),
  });
  if (res.ok) return null;
  const data = await res.json().catch(() => null);
  return (data && typeof data.error === 'string' && data.error) || fallbackError;
}
