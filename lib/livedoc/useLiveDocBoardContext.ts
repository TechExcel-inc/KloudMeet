'use client';

import * as React from 'react';
import { RoomEvent, type Room } from 'livekit-client';

/**
 * Who is who, for the LiveDoc stage's Excalidraw board. The board draws, saves and syncs inside the
 * LiveDoc iframe over the meeting's Kloud websocket (which also records it); it only learns the
 * meeting's people and roles from KloudMeet:
 *
 *   iframe -> KloudMeet  Kloud-BoardHello  { board }                 a board opened: send the context
 *                        Kloud-BoardBye    { board }                 the board closed
 *   KloudMeet -> iframe  Kloud-BoardContext { self, roles, present } who is who (again on every change)
 */

export interface BoardRoles {
  hostIdentity: string | null | undefined;
  cohostIdentities: readonly string[];
  /** Co-presenters plus whoever is sharing their screen */
  presenterIdentities: readonly string[];
}

function liveDocWindow(): Window | null {
  return (
    document.querySelector<HTMLIFrameElement>('iframe[title="LiveDoc"]')?.contentWindow ?? null
  );
}

/** useLiveDocBoardContext — 向 LiveDoc 内的 Excalidraw 画板告知参会者与角色 */
export function useLiveDocBoardContext(room: Room, roles: BoardRoles, enabled: boolean): void {
  /** A board is open in the iframe: only then is the context sent */
  const activeRef = React.useRef(false);
  const rolesRef = React.useRef(roles);
  rolesRef.current = roles;

  const sendContext = React.useCallback(() => {
    const target = liveDocWindow();
    if (!activeRef.current || !target) return;
    const local = room.localParticipant;
    const r = rolesRef.current;
    target.postMessage(
      {
        type: 'Kloud-BoardContext',
        self: { identity: local.identity, name: local.name || local.identity },
        roles: {
          hostIdentity: r.hostIdentity ?? null,
          cohostIdentities: [...r.cohostIdentities],
          presenterIdentities: [...r.presenterIdentities],
        },
        present: [local, ...room.remoteParticipants.values()].map((p) => ({
          identity: p.identity,
          name: p.name || p.identity,
        })),
      },
      '*',
    );
  }, [room]);

  // Roles changed: tell an open board
  React.useEffect(() => {
    sendContext();
  }, [roles, sendContext]);

  React.useEffect(() => {
    if (!enabled) {
      activeRef.current = false;
      return;
    }

    const onWindowMessage = (e: MessageEvent) => {
      const target = liveDocWindow();
      if (!target || e.source !== target) return;
      const d = e.data as { type?: unknown } | null;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'Kloud-BoardHello') {
        activeRef.current = true;
        sendContext();
      } else if (d.type === 'Kloud-BoardBye') {
        activeRef.current = false;
      }
    };
    window.addEventListener('message', onWindowMessage);
    room.on(RoomEvent.ParticipantConnected, sendContext);
    room.on(RoomEvent.ParticipantDisconnected, sendContext);

    return () => {
      activeRef.current = false;
      window.removeEventListener('message', onWindowMessage);
      room.off(RoomEvent.ParticipantConnected, sendContext);
      room.off(RoomEvent.ParticipantDisconnected, sendContext);
    };
  }, [room, enabled, sendContext]);
}
