import { createHmac, randomUUID } from 'node:crypto';

/** How long a relay ticket may wait before it is used. */
const TICKET_TTL_MS = 60000;

/**
 * A one-time ticket for the Fun-ASR relay (scripts/funasr-relay.cjs), which checks it with the
 * same key. The long-lived DashScope key itself never leaves the server.
 */
export function issueFunAsrTicket(key: string): string {
  const raw = Buffer.from(JSON.stringify({
    exp: Date.now() + TICKET_TTL_MS,
    nonce: randomUUID(),
  })).toString('base64url');
  return `${raw}.${createHmac('sha256', key).update(raw).digest('base64url')}`;
}
