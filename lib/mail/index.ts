import { aliyunDirectMail } from './providers/aliyun';
import { brevo } from './providers/brevo';
import { postmark } from './providers/postmark';
import { mailRegionFor, type MailRegion } from './region';
import type { MailMessage, MailProvider, MailResult } from './types';

/**
 * Sends one email through the provider that suits the recipient, falling back to the next configured one.
 *
 * Route order (only configured providers are used):
 *   global recipients: MAIL_PROVIDER, then postmark → brevo → aliyun
 *   Chinese mailboxes: MAIL_PROVIDER_CN, then aliyun → postmark → brevo
 * With nothing configured, development logs the email; production fails loudly.
 */

const PROVIDERS: Record<string, MailProvider> = {
  postmark,
  aliyun: aliyunDirectMail,
  brevo,
};

const DEFAULT_ORDER: Record<MailRegion, string[]> = {
  global: ['postmark', 'brevo', 'aliyun'],
  cn: ['aliyun', 'postmark', 'brevo'],
};

export function providerOrder(region: MailRegion): MailProvider[] {
  const preferred = (region === 'cn' ? process.env.MAIL_PROVIDER_CN : process.env.MAIL_PROVIDER)?.trim().toLowerCase();
  const names = [...(preferred ? [preferred] : []), ...DEFAULT_ORDER[region]];
  const seen = new Set<string>();
  const order: MailProvider[] = [];
  for (const name of names) {
    const provider = PROVIDERS[name];
    if (!provider || seen.has(name) || !provider.configured()) continue;
    seen.add(name);
    order.push(provider);
  }
  return order;
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const region = await mailRegionFor(message.to);
  const order = providerOrder(region);

  if (order.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[mail] no mail provider configured');
      return { ok: false, provider: 'none', error: 'No mail provider configured' };
    }
    console.warn(`[mail] no provider configured — dev only, not sent. To ${message.to}: ${message.subject}\n${message.text}`);
    return { ok: true, provider: 'console' };
  }

  let last: MailResult = { ok: false, provider: 'none', error: 'not attempted' };
  for (const provider of order) {
    last = await provider.send(message);
    if (last.ok) return last;
    console.error(`[mail] ${provider.name} failed (${region}):`, last.error);
  }
  return last;
}

export type { MailMessage, MailResult } from './types';
