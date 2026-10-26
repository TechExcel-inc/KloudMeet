/**
 * Each speaker tells the room whether their own captions work, so the host can see
 * "Captions down for Alice" instead of wondering why Alice's words stopped appearing.
 */

import type { CaptionStatus } from './captionSupervisor';

export const CAPTION_STATUS_TOPIC = 'kloud-caption-status';

export type PeerCaptionState = 'ok' | 'reconnecting' | 'failed';

/** What a speaker announces. Idle (mic off) counts as ok: nobody is missing captions. */
export function peerStateOf(status: CaptionStatus): PeerCaptionState {
  if (status.state === 'failed') return 'failed';
  if (status.state === 'reconnecting') return 'reconnecting';
  return 'ok';
}

export function parsePeerCaptionState(raw: string): PeerCaptionState | null {
  try {
    const { state } = JSON.parse(raw) as { state?: unknown };
    return state === 'ok' || state === 'reconnecting' || state === 'failed' ? state : null;
  } catch {
    return null;
  }
}

export interface PeerCaptionIssue {
  identity: string;
  name: string;
}
