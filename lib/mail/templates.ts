export type VerificationEmailPurpose = 'signup' | 'reset';

const COPY: Record<VerificationEmailPurpose, { subject: string; heading: string; intro: string; ignore: string }> = {
  signup: {
    subject: 'Your Kloud Meet verification code',
    heading: 'Confirm your email',
    intro: 'Use this code to finish creating your Kloud Meet account:',
    ignore: "If you didn't try to sign up, you can ignore this email.",
  },
  reset: {
    subject: 'Reset your Kloud Meet password',
    heading: 'Reset your password',
    intro: 'Use this code to choose a new Kloud Meet password:',
    ignore: "If you didn't ask to reset your password, you can ignore this email — your password stays the same.",
  },
};

export function verificationEmail(to: string, code: string, purpose: VerificationEmailPurpose) {
  const copy = COPY[purpose];
  return {
    to,
    tag: `${purpose}-code`,
    subject: `${copy.subject}: ${code}`,
    text: `${copy.intro}\n\n${code}\n\nThis code expires in 10 minutes.\n\n${copy.ignore}`,
    html: `
      <div style="font-family: 'Plus Jakarta Sans', Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #111827; margin-bottom: 8px;">${copy.heading}</h2>
        <p style="color: #6b7280; font-size: 15px;">${copy.intro}</p>
        <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; text-align: center; margin: 16px 0;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #5E5CE6;">${code}</span>
        </div>
        <p style="color: #9ca3af; font-size: 13px;">This code expires in 10 minutes. ${copy.ignore}</p>
      </div>
    `,
  };
}
