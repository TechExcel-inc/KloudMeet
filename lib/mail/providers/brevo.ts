import { mailFrom, type MailMessage, type MailProvider, type MailResult } from '../types';

/** Brevo (kept as a fallback; the original provider). */
export const brevo: MailProvider = {
  name: 'brevo',
  configured: () => Boolean(process.env.BREVO_API_KEY?.trim()),
  async send(message: MailMessage): Promise<MailResult> {
    const from = mailFrom();
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'api-key': process.env.BREVO_API_KEY!.trim(),
        },
        body: JSON.stringify({
          sender: {
            email: process.env.BREVO_FROM_EMAIL?.trim() || from.address,
            name: process.env.BREVO_FROM_NAME?.trim() || from.name,
          },
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
          ...(message.tag ? { tags: [message.tag] } : {}),
        }),
      });
      if (!res.ok) {
        return { ok: false, provider: 'brevo', error: `Brevo ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}` };
      }
      const data = (await res.json().catch(() => null)) as { messageId?: string } | null;
      return { ok: true, provider: 'brevo', id: data?.messageId };
    } catch (e) {
      return { ok: false, provider: 'brevo', error: e instanceof Error ? e.message : String(e) };
    }
  },
};
