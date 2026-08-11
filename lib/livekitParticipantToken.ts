import { AccessToken, type VideoGrant } from 'livekit-server-sdk';

export type CreateLiveKitParticipantTokenInput = {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name?: string;
  metadata?: string;
  roomName: string;
  /** Default 2h — join tickets are short-lived; refresh mints a new one. */
  ttl?: string | number;
};

/**
 * Mint a LiveKit room-join JWT.
 *
 * Requires livekit-server-sdk ≥ 2.15.1 so `nbf` is issuance time (not 0).
 * LiveKit Cloud revokes after RemoveParticipant by comparing JWT `nbf` to a
 * cutoff; `nbf: 0` tickets look permanently revoked after any eviction.
 *
 * @see https://docs.livekit.io/frontends/reference/tokens-grants/
 */
export async function createLiveKitParticipantToken(
  input: CreateLiveKitParticipantTokenInput,
): Promise<string> {
  const at = new AccessToken(input.apiKey, input.apiSecret, {
    identity: input.identity,
    name: input.name,
    metadata: input.metadata,
    ttl: input.ttl ?? '2h',
  });
  const grant: VideoGrant = {
    room: input.roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);
  return at.toJwt();
}
