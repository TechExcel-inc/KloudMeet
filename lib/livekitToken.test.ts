import { describe, expect, it } from 'vitest';
import {
  isLiveKitAuthError,
  isLiveKitParticipantTokenReusable,
  msUntilLiveKitTokenRenew,
  parseJwtExpiryMs,
  LIVEKIT_TOKEN_RENEW_MARGIN_MS,
} from './livekitToken';

function b64url(json: object): string {
  return Buffer.from(JSON.stringify(json))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeUnsignedJwt(expSeconds: number): string {
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ exp: expSeconds })}.sig`;
}

describe('livekitToken', () => {
  it('parseJwtExpiryMs reads exp', () => {
    const exp = 1_700_000_000;
    expect(parseJwtExpiryMs(makeUnsignedJwt(exp))).toBe(exp * 1000);
  });

  it('msUntilLiveKitTokenRenew respects margin', () => {
    const now = 1_700_000_000_000;
    const expSec = Math.floor((now + 10 * 60 * 1000) / 1000);
    const wait = msUntilLiveKitTokenRenew(makeUnsignedJwt(expSec), now);
    expect(wait).toBe(10 * 60 * 1000 - LIVEKIT_TOKEN_RENEW_MARGIN_MS);
  });

  it('isLiveKitParticipantTokenReusable is true before renew window', () => {
    const now = 1_700_000_000_000;
    const farExp = Math.floor((now + 60 * 60 * 1000) / 1000);
    expect(isLiveKitParticipantTokenReusable(makeUnsignedJwt(farExp), now)).toBe(true);
    const nearExp = Math.floor((now + 2 * 60 * 1000) / 1000);
    expect(isLiveKitParticipantTokenReusable(makeUnsignedJwt(nearExp), now)).toBe(false);
    expect(isLiveKitParticipantTokenReusable('not-a-jwt', now)).toBe(false);
  });

  it('isLiveKitAuthError matches LiveKit 401 messages', () => {
    expect(isLiveKitAuthError(new Error('Could not fetch region settings: Unauthorized'))).toBe(
      true,
    );
    expect(
      isLiveKitAuthError(new Error('could not establish signal connection: invalid token')),
    ).toBe(true);
    expect(isLiveKitAuthError(new Error('websocket timed out'))).toBe(false);
  });

  it('isLiveKitAuthError matches ConnectionError status/reasonName', () => {
    expect(
      isLiveKitAuthError({
        name: 'ConnectionError',
        message: 'could not establish signal connection',
        status: 401,
        reasonName: 'NotAllowed',
      }),
    ).toBe(true);
    expect(
      isLiveKitAuthError({
        name: 'ConnectionError',
        message: 'could not establish signal connection',
        status: 503,
        reasonName: 'ServerUnreachable',
      }),
    ).toBe(false);
  });
});
