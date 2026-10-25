/**
 * Kloud staff ("internal") who may see internal notes on pages, such as which AI model wrote a
 * summary. The list lives in the server's INTERNAL_STAFF_EMAILS: comma- or space-separated emails.
 */

export function internalStaffEmails(list: string | undefined = process.env.INTERNAL_STAFF_EMAILS): Set<string> {
  return new Set(
    (list || '')
      .split(/[\s,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.includes('@')),
  );
}

export function isInternalEmail(email: string | null | undefined, list?: string): boolean {
  if (!email) return false;
  return internalStaffEmails(list).has(email.trim().toLowerCase());
}
