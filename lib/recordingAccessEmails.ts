/**
 * Emails for asking to watch a recording (Protected meetings, lib/meetingAccess.ts):
 * the host hears about a request; the person who asked hears the answer.
 */
import { escapeHtml } from './meetingInvites';

function card(heading: string, intro: string, buttonUrl: string | null, buttonLabel: string, footer: string) {
  const button = buttonUrl
    ? `<a href="${escapeHtml(buttonUrl)}" style="display:inline-block;background:#5E5CE6;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">${escapeHtml(buttonLabel)}</a>`
    : '';
  return `
    <div style="font-family: 'Plus Jakarta Sans', Inter, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px;">
      <h2 style="color:#111827;margin:0 0 8px">${escapeHtml(heading)}</h2>
      <p style="color:#4b5563;font-size:15px;margin:0 0 24px">${escapeHtml(intro)}</p>
      ${button}
      <p style="color:#9ca3af;font-size:13px;margin:28px 0 0">${escapeHtml(footer)}</p>
    </div>`;
}

/** To the host: someone asked to watch. */
export function recordingRequestEmail(to: string, opts: { requester: string; requesterEmail: string; title: string; replayUrl: string }) {
  const intro = `${opts.requester} (${opts.requesterEmail}) asked to watch the recording of “${opts.title}”.`;
  const footer = 'Open the recording to approve or deny. Only you and the person who recorded it can answer.';
  return {
    to,
    tag: 'recording-access-request',
    subject: `${opts.requester} asked to watch “${opts.title}”`,
    text: [intro, '', `Review: ${opts.replayUrl}`, '', footer].join('\n'),
    html: card('Request to watch a recording', intro, opts.replayUrl, 'Review request', footer),
  };
}

/** To the person who asked: the host's answer. */
export function recordingAnswerEmail(to: string, opts: { approved: boolean; title: string; hostName: string; replayUrl: string }) {
  const intro = opts.approved
    ? `${opts.hostName} approved your request. You can now watch the recording of “${opts.title}”.`
    : `${opts.hostName} didn’t approve your request to watch the recording of “${opts.title}”.`;
  const footer = opts.approved
    ? 'Sign in with this email address to watch.'
    : 'If you think you should have access, contact the host.';
  return {
    to,
    tag: opts.approved ? 'recording-access-approved' : 'recording-access-denied',
    subject: opts.approved ? `You can watch “${opts.title}”` : `Request not approved: “${opts.title}”`,
    text: [intro, '', ...(opts.approved ? [`Watch: ${opts.replayUrl}`, ''] : []), footer].join('\n'),
    html: card(opts.approved ? 'Request approved' : 'Request not approved', intro, opts.approved ? opts.replayUrl : null, 'Watch recording', footer),
  };
}
