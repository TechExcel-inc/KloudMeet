export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Short label for provider statistics, e.g. "signup-code". */
  tag?: string;
};

export type MailResult = { ok: true; provider: string; id?: string } | { ok: false; provider: string; error: string };

export interface MailProvider {
  name: string;
  /** True when the provider's credentials are present in the environment. */
  configured(): boolean;
  send(message: MailMessage): Promise<MailResult>;
}

export function mailFrom(): { address: string; name: string } {
  return {
    address: process.env.MAIL_FROM_ADDRESS?.trim() || 'noreply@kloudmeet.com',
    name: process.env.MAIL_FROM_NAME?.trim() || 'Kloud Meet',
  };
}
