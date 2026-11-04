'use client';

import * as React from 'react';
import { RoomEvent, type Participant, type Room } from 'livekit-client';

/**
 * Relay for the LiveDoc stage's Excalidraw board. The board is drawn and saved inside the LiveDoc
 * iframe; it has no connection of its own to the meeting, so KloudMeet carries its messages:
 *
 *   iframe -> KloudMeet  Kloud-BoardHello  { board }               a board opened: send the context
 *                        Kloud-BoardSend   { topic, payload, to? } send over LiveKit
 *                        Kloud-BoardBye    { board }               the board closed
 *   KloudMeet -> iframe  Kloud-BoardContext { self, roles, present } who is who (again on every change)
 *                        Kloud-BoardReceive { topic, payload, from }  what someone else sent
 *
 * Topic `wb` goes over a LiveKit text stream (reliable, any size); `wb-live` (cursors, the leader's
 * view) over lossy data packets. KloudMeet does not read the payloads.
 */

const RELIABLE_TOPIC = 'wb';
const LIVE_TOPIC = 'wb-live';

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

export function useLiveDocBoardRelay(room: Room, roles: BoardRoles, enabled: boolean): void {
  /** A board is open in the iframe: only then is anything passed in */
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

    const deliver = (topic: string, payload: string, from: string) => {
      const target = liveDocWindow();
      if (activeRef.current && target)
        target.postMessage({ type: 'Kloud-BoardReceive', topic, payload, from }, '*');
    };

    const onWindowMessage = (e: MessageEvent) => {
      const target = liveDocWindow();
      if (!target || e.source !== target) return;
      const d = e.data as {
        type?: unknown;
        topic?: unknown;
        payload?: unknown;
        to?: unknown;
      } | null;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'Kloud-BoardHello') {
        activeRef.current = true;
        sendContext();
      } else if (d.type === 'Kloud-BoardBye') {
        activeRef.current = false;
      } else if (d.type === 'Kloud-BoardSend' && typeof d.payload === 'string') {
        if (d.topic === RELIABLE_TOPIC) {
          const to = Array.isArray(d.to)
            ? d.to.filter((id): id is string => typeof id === 'string')
            : [];
          room.localParticipant
            .sendText(d.payload, {
              topic: RELIABLE_TOPIC,
              destinationIdentities: to.length ? to : undefined,
            })
            .catch((err) => console.warn('board relay: send failed', err));
        } else if (d.topic === LIVE_TOPIC) {
          room.localParticipant
            .publishData(new TextEncoder().encode(d.payload), {
              reliable: false,
              topic: LIVE_TOPIC,
            })
            .catch(() => undefined);
        }
      }
    };
    window.addEventListener('message', onWindowMessage);

    try {
      room.unregisterTextStreamHandler(RELIABLE_TOPIC);
    } catch {
      // not registered yet
    }
    room.registerTextStreamHandler(RELIABLE_TOPIC, (reader, info) => {
      reader
        .readAll()
        .then((text) => deliver(RELIABLE_TOPIC, text, info.identity))
        .catch(() => undefined);
    });

    const onData = (
      payload: Uint8Array,
      participant?: Participant,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== LIVE_TOPIC || !participant) return;
      deliver(LIVE_TOPIC, new TextDecoder().decode(payload), participant.identity);
    };
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantConnected, sendContext);
    room.on(RoomEvent.ParticipantDisconnected, sendContext);

    return () => {
      activeRef.current = false;
      window.removeEventListener('message', onWindowMessage);
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantConnected, sendContext);
      room.off(RoomEvent.ParticipantDisconnected, sendContext);
      try {
        room.unregisterTextStreamHandler(RELIABLE_TOPIC);
      } catch {
        // already gone
      }
    };
  }, [room, enabled, sendContext]);
}
