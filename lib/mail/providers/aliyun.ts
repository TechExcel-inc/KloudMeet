import crypto from 'crypto';
import { mailFrom, type MailMessage, type MailProvider, type MailResult } from '../types';

/**
 * Alibaba Cloud DirectMail (recipients on Chinese mailboxes: QQ, 163, enterprise mail in China).
 * SingleSendMail, API version 2015-11-23, RPC signature v1 (HMAC-SHA1).
 * https://help.aliyun.com/zh/direct-mail/api-dm-2015-11-23-singlesendmail
 */

/** RFC 3986 encoding as Alibaba Cloud's RPC signature expects. */
export function aliyunPercentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Signs RPC parameters; returns the full query string including Signature. */
export function signAliyunRpc(params: Record<string, string>, accessKeySecret: string, method = 'POST'): string {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${aliyunPercentEncode(k)}=${aliyunPercentEncode(params[k])}`)
    .join('&');
  const stringToSign = `${method}&${aliyunPercentEncode('/')}&${aliyunPercentEncode(canonical)}`;
  const signature = crypto.createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64');
  return `${canonical}&Signature=${aliyunPercentEncode(signature)}`;
}

export const aliyunDirectMail: MailProvider = {
  name: 'aliyun',
  configured: () =>
    Boolean(
      process.env.ALIYUN_DM_ACCESS_KEY_ID?.trim() &&
        process.env.ALIYUN_DM_ACCESS_KEY_SECRET?.trim() &&
        process.env.ALIYUN_DM_ACCOUNT_NAME?.trim(),
    ),
  async send(message: MailMessage): Promise<MailResult> {
    const endpoint = (process.env.ALIYUN_DM_ENDPOINT?.trim() || 'https://dm.aliyuncs.com').replace(/\/+$/, '');
    const params: Record<string, string> = {
      Action: 'SingleSendMail',
      Version: '2015-11-23',
      Format: 'JSON',
      AccessKeyId: process.env.ALIYUN_DM_ACCESS_KEY_ID!.trim(),
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: crypto.randomUUID(),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      AccountName: process.env.ALIYUN_DM_ACCOUNT_NAME!.trim(),
      AddressType: '1',
      ReplyToAddress: 'false',
      ToAddress: message.to,
      Subject: message.subject,
      HtmlBody: message.html,
      TextBody: message.text,
      FromAlias: mailFrom().name.slice(0, 14),
      ...(process.env.ALIYUN_DM_TAG?.trim() ? { TagName: process.env.ALIYUN_DM_TAG.trim() } : {}),
    };
    try {
      const res = await fetch(`${endpoint}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: signAliyunRpc(params, process.env.ALIYUN_DM_ACCESS_KEY_SECRET!.trim()),
      });
      const data = (await res.json().catch(() => null)) as { EnvId?: string; Code?: string; Message?: string } | null;
      if (!res.ok || !data || data.Code) {
        return { ok: false, provider: 'aliyun', error: `Aliyun DM ${res.status} ${data?.Code ?? ''} ${data?.Message ?? ''}`.trim() };
      }
      return { ok: true, provider: 'aliyun', id: data.EnvId };
    } catch (e) {
      return { ok: false, provider: 'aliyun', error: e instanceof Error ? e.message : String(e) };
    }
  },
};
