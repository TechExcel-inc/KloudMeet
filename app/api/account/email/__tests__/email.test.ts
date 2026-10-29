import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  prisma: {
    session: { findUnique: vi.fn() },
    teamMember: { findFirst: vi.fn(), update: vi.fn() },
    verificationCode: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock('@/lib/db', () => db);
const mail = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('@/lib/mail', () => mail);

import { POST as sendCode } from '../send-code/route';
import { POST as confirm } from '../confirm/route';
import { PUT as saveProfile } from '../../profile/route';
import { emailCodeTarget } from '@/lib/accountLinking';
import { resetRateLimits } from '@/lib/rateLimit';

const { session, teamMember, verificationCode } = db.prisma;
const ME = { id: 5, email: 'old@example.com', emailVerified: true, status: 'ACTIVE' };

function req(path: string, body: unknown, method = 'POST') {
  return new NextRequest(`http://localhost${path}`, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer s' },
  });
}

beforeEach(() => {
  resetRateLimits();
  session.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), teamMember: ME });
  teamMember.findFirst.mockResolvedValue(null);
  verificationCode.findMany.mockResolvedValue([]);
  verificationCode.updateMany.mockResolvedValue({ count: 1 });
  verificationCode.create.mockResolvedValue({ id: 1 });
  mail.sendMail.mockResolvedValue({ ok: true });
});

afterEach(() => vi.resetAllMocks());

describe('POST /api/account/email/send-code', () => {
  it('emails a code bound to this account and the new address', async () => {
    const res = await sendCode(req('/api/account/email/send-code', { email: ' New@Example.com ' }));
    expect(res.status).toBe(200);
    expect(verificationCode.create.mock.calls[0][0].data).toMatchObject({
      target: emailCodeTarget(5, 'new@example.com'),
      type: 'CHANGE_EMAIL',
    });
    expect(mail.sendMail.mock.calls[0][0].to).toBe('new@example.com');
  });

  it('refuses an address another account uses', async () => {
    teamMember.findFirst.mockResolvedValue({ id: 6 });
    const res = await sendCode(req('/api/account/email/send-code', { email: 'taken@example.com' }));
    expect((await res.json()).code).toBe('EMAIL_IN_USE');
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
});

describe('POST /api/account/email/confirm', () => {
  it('switches the email and marks it verified with the right code', async () => {
    verificationCode.findFirst.mockResolvedValue({ id: 1, code: '123456', attempts: 0 });
    teamMember.update.mockResolvedValue({ email: 'new@example.com' });
    const res = await confirm(req('/api/account/email/confirm', { email: 'new@example.com', code: '123456' }));
    expect(res.status).toBe(200);
    expect(verificationCode.findFirst.mock.calls[0][0].where.target).toBe(emailCodeTarget(5, 'new@example.com'));
    expect(teamMember.update.mock.calls[0][0].data).toMatchObject({ email: 'new@example.com', emailVerified: true });
  });

  it('keeps the old email after a wrong code', async () => {
    verificationCode.findFirst.mockResolvedValue({ id: 1, code: '123456', attempts: 0 });
    const res = await confirm(req('/api/account/email/confirm', { email: 'new@example.com', code: '000000' }));
    expect(res.status).toBe(400);
    expect(teamMember.update).not.toHaveBeenCalled();
  });
});

describe('PUT /api/account/profile', () => {
  it('no longer changes the email directly', async () => {
    const res = await saveProfile(req('/api/account/profile', { email: 'new@example.com' }, 'PUT'));
    expect((await res.json()).code).toBe('EMAIL_NEEDS_CODE');
    expect(teamMember.update).not.toHaveBeenCalled();
  });
});
