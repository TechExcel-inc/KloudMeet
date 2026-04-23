const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const FROM_EMAIL = process.env.BREVO_FROM_EMAIL || 'noreply@kloud.cn';
const FROM_NAME = process.env.BREVO_FROM_NAME || 'KloudMeet';

/**
 * Send a verification code email via Brevo REST API.
 * No SDK dependency needed — uses native fetch.
 * Returns { success: true } on success, or { success: false, error } on failure.
 */
export async function sendEmailVerification(
  toEmail: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  if (!BREVO_API_KEY) {
    // In development without a key, just log and succeed silently
    console.warn('[brevo] BREVO_API_KEY not set — skipping email send. Code:', code);
    return { success: true };
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { email: FROM_EMAIL, name: FROM_NAME },
        to: [{ email: toEmail }],
        subject: `Your KloudMeet verification code: ${code}`,
        htmlContent: `
          <div style="font-family: 'Inter', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
            <h2 style="color: #111827; margin-bottom: 8px;">KloudMeet Verification</h2>
            <p style="color: #6b7280; font-size: 15px;">Your verification code is:</p>
            <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; text-align: center; margin: 16px 0;">
              <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #7c3aed;">${code}</span>
            </div>
            <p style="color: #9ca3af; font-size: 13px;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('[brevo] API error:', res.status, errBody);
      return { success: false, error: `Brevo API ${res.status}` };
    }

    return { success: true };
  } catch (error: any) {
    console.error('[brevo] Failed to send email:', error?.message || error);
    return { success: false, error: error?.message || 'Unknown error' };
  }
}
