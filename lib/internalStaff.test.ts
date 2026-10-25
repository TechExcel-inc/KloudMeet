import { describe, expect, it } from 'vitest';
import { internalStaffEmails, isInternalEmail } from './internalStaff';

describe('internal staff list', () => {
  it('reads comma or space separated emails, case-insensitively', () => {
    expect([...internalStaffEmails('A@Kloud.cn, b@x.com  c@y.com;not-an-email')]).toEqual(['a@kloud.cn', 'b@x.com', 'c@y.com']);
    expect(isInternalEmail('a@KLOUD.cn', 'a@kloud.cn,b@x.com')).toBe(true);
  });

  it('treats everyone as external when the list is empty or the email is missing', () => {
    expect(isInternalEmail('a@kloud.cn', '')).toBe(false);
    expect(isInternalEmail(null, 'a@kloud.cn')).toBe(false);
  });
});
