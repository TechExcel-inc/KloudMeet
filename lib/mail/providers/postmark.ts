import { mailFrom, type MailMessage, type MailProvider, type MailResult } from '../types';

/** Postmark (overseas recipients). https://postmarkapp.com/developer/api/email-api */
export const postmark: MailProvider = {
  name: 'postmark',
  configured: () => Boolean(process.env.POSTMARK_SERVER_TOKEN?.trim()),
  async send(message: MailMessage): Promise<MailResult> {
    const from = mailFrom();
    try {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN!.trim(),
        },
        body: JSON.stringify({
          From: `${from.name} <${process.env.POSTMARK_FROM_ADDRESS?.trim() || from.address}>`,
          To: message.to,
          Subject: message.subject,
          TextBody: message.text,
          HtmlBody: message.html,
          MessageStream: process.env.POSTMARK_MESSAGE_STREAM?.trim() || 'outbound',
          ...(message.tag ? { Tag: message.tag } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as { ErrorCode?: number; Message?: string; MessageID?: string } | null;
      if (!res.ok || !data || data.ErrorCode !== 0) {
        return { ok: false, provider: 'postmark', error: `Postmark ${res.status} ${data?.ErrorCode ?? ''} ${data?.Message ?? ''}`.trim() };
      }
      return { ok: true, provider: 'postmark', id: data.MessageID };
    } catch (e) {
      return { ok: false, provider: 'postmark', error: e instanceof Error ? e.message : String(e) };
    }
  },
};
