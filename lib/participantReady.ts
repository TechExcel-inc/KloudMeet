'use client';

import React from 'react';
import { RoomEvent, type Room } from 'livekit-client';
import { visibleRemoteParticipants } from '@/lib/recorderParticipant';

/**
 * Someone who just joined shows up once their media connection is up (LiveKit's ACTIVE state):
 * before that they can't hear anyone yet, and talking to them goes nowhere.
 */
export function isParticipantReady(p: { isLocal?: boolean; isActive?: boolean }): boolean {
  return p.isLocal === true || p.isActive !== false;
}

/** Remote participants people see: not the recording bot, and only once they can hear the room. */
export function shownRemoteParticipants<P extends { metadata?: string; isActive?: boolean }>(
  participants: Iterable<P>,
): P[] {
  return visibleRemoteParticipants(participants).filter(isParticipantReady);
}

/** Counts up each time someone's media connection comes up, so lists that hide them redraw. */
export function useParticipantActiveTick(room: Room): number {
  const [tick, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    room.on(RoomEvent.ParticipantActive, bump);
    return () => {
      room.off(RoomEvent.ParticipantActive, bump);
    };
  }, [room]);
  return tick;
}
