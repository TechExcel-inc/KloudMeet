'use client';

import React from 'react';
import { ConnectionState, Room, RoomEvent, type RemoteParticipant } from 'livekit-client';
import {
  REMOTE_IDENTITY_PREFIX,
  TV_TOPIC,
  decodeTvMessage,
  encodeTvMessage,
  type RemoteStatus,
  type TvCommand,
  type TvMessage,
  type TvState,
} from '@/lib/tv/protocol';
import { loadTrustedRemotes, newPairCode, randomToken, trustRemote, type TvIdentity } from '@/lib/tv/deviceIdentity';

export interface PairedRemote {
  identity: string;
  deviceId: string;
  name: string;
  device: string;
}

export type PairStatus = 'connecting' | 'online' | 'offline';

interface Options {
  /** null until the TV has loaded its identity from storage */
  identity: TvIdentity | null;
  /** A new code was needed (the old one is used by another TV) */
  onIdentityChange: (next: TvIdentity) => void;
  onCommand: (cmd: TvCommand, from: PairedRemote) => void;
  onRemoteJoined: (remote: PairedRemote) => void;
  onRemoteLeft: (remote: PairedRemote) => void;
}

/**
 * The TV's side of the phone remote: keeps the TV in its pairing room (`kmtv-<code>`),
 * admits remotes (QR secret or a trusted phone right away, anyone else after the TV says
 * yes), runs their commands and sends them what the TV shows.
 */
export function useTvPairing({ identity, onIdentityChange, onCommand, onRemoteJoined, onRemoteLeft }: Options) {
  const [status, setStatus] = React.useState<PairStatus>('connecting');
  const [remotes, setRemotes] = React.useState<PairedRemote[]>([]);
  const [pending, setPending] = React.useState<PairedRemote[]>([]);
  const roomRef = React.useRef<Room | null>(null);
  const approvedRef = React.useRef(new Map<string, PairedRemote>());
  const pendingRef = React.useRef(new Map<string, PairedRemote>());
  const stateRef = React.useRef<TvState | null>(null);
  const lastSentRef = React.useRef('');
  const cbRef = React.useRef({ onCommand, onRemoteJoined, onRemoteLeft, onIdentityChange });
  cbRef.current = { onCommand, onRemoteJoined, onRemoteLeft, onIdentityChange };
  const identityRef = React.useRef(identity);
  identityRef.current = identity;

  const send = React.useCallback((msg: TvMessage, to?: string[]) => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;
    if (to && to.length === 0) return;
    room.localParticipant
      .publishData(encodeTvMessage(msg), { reliable: true, topic: TV_TOPIC, ...(to ? { destinationIdentities: to } : {}) })
      .catch(() => undefined);
  }, []);

  const sendStateTo = React.useCallback(
    (to: string[]) => {
      if (stateRef.current) send({ t: 'state', state: stateRef.current }, to);
    },
    [send],
  );

  const syncLists = React.useCallback(() => {
    setRemotes(Array.from(approvedRef.current.values()));
    setPending(Array.from(pendingRef.current.values()));
  }, []);

  const approve = React.useCallback(
    (identityStr: string, remember: boolean) => {
      const remote = pendingRef.current.get(identityStr) ?? approvedRef.current.get(identityStr);
      if (!remote) return;
      pendingRef.current.delete(identityStr);
      approvedRef.current.set(identityStr, remote);
      if (remember) trustRemote(remote.deviceId);
      syncLists();
      send({ t: 'welcome', status: 'approved', tvName: identityRef.current?.name ?? '' }, [identityStr]);
      sendStateTo([identityStr]);
      cbRef.current.onRemoteJoined(remote);
    },
    [send, sendStateTo, syncLists],
  );

  const deny = React.useCallback(
    (identityStr: string) => {
      pendingRef.current.delete(identityStr);
      syncLists();
      send({ t: 'welcome', status: 'denied', tvName: identityRef.current?.name ?? '' }, [identityStr]);
    },
    [send, syncLists],
  );

  /** What the TV shows changed: tell every approved remote (only when it really changed). */
  const publishState = React.useCallback(
    (state: TvState) => {
      stateRef.current = state;
      const json = JSON.stringify(state);
      if (json === lastSentRef.current) return;
      lastSentRef.current = json;
      send({ t: 'state', state }, Array.from(approvedRef.current.keys()));
    },
    [send],
  );

  const sendFeedback = React.useCallback(
    (to: string, heard: string, text: string, ok: boolean) => send({ t: 'feedback', heard, text, ok }, [to]),
    [send],
  );

  // Connect (and reconnect) to the pairing room for the current code
  const code = identity?.code ?? null;
  const deviceId = identity?.deviceId ?? null;
  React.useEffect(() => {
    if (!code || !deviceId) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const room = new Room({ adaptiveStream: false, dynacast: false });
    roomRef.current = room;
    approvedRef.current.clear();
    pendingRef.current.clear();
    lastSentRef.current = '';
    syncLists();

    const handleHello = (participant: RemoteParticipant, msg: Extract<TvMessage, { t: 'hello' }>) => {
      if (!participant.identity.startsWith(REMOTE_IDENTITY_PREFIX)) return;
      const remote: PairedRemote = {
        identity: participant.identity,
        deviceId: msg.deviceId,
        name: msg.name.trim() || participant.name || 'Phone',
        device: msg.device,
      };
      const trusted =
        approvedRef.current.has(remote.identity) ||
        (msg.secret && msg.secret === identityRef.current?.secret) ||
        loadTrustedRemotes().includes(remote.deviceId);
      if (trusted) {
        pendingRef.current.set(remote.identity, remote);
        approve(remote.identity, true);
        return;
      }
      pendingRef.current.set(remote.identity, remote);
      syncLists();
      const status: RemoteStatus = 'pending';
      send({ t: 'welcome', status, tvName: identityRef.current?.name ?? '' }, [remote.identity]);
    };

    room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      if (topic !== TV_TOPIC || !participant) return;
      const msg = decodeTvMessage(payload);
      if (!msg) return;
      if (msg.t === 'hello') handleHello(participant, msg);
      else if (msg.t === 'cmd') {
        const remote = approvedRef.current.get(participant.identity);
        if (remote) cbRef.current.onCommand(msg.cmd, remote);
      }
    });
    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      const remote = approvedRef.current.get(p.identity);
      approvedRef.current.delete(p.identity);
      pendingRef.current.delete(p.identity);
      syncLists();
      if (remote) cbRef.current.onRemoteLeft(remote);
    });
    room.on(RoomEvent.Disconnected, () => {
      if (cancelled) return;
      setStatus('offline');
      approvedRef.current.clear();
      pendingRef.current.clear();
      syncLists();
      schedule();
    });

    const schedule = () => {
      if (cancelled) return;
      const delay = Math.min(30_000, 2_000 * 2 ** Math.min(attempt, 4));
      attempt++;
      retryTimer = setTimeout(connect, delay);
    };

    const connect = async () => {
      if (cancelled) return;
      setStatus((s) => (s === 'online' ? s : 'connecting'));
      try {
        const res = await fetch('/api/tv/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'tv', code, deviceId, name: identityRef.current?.name ?? '' }),
        });
        if (res.status === 409) {
          // Another TV has this code: take a new one (the effect re-runs with it)
          if (identityRef.current) {
            cbRef.current.onIdentityChange({ ...identityRef.current, code: newPairCode(), secret: randomToken(16) });
          }
          return;
        }
        if (!res.ok) throw new Error(`tv token ${res.status}`);
        const { serverUrl, token } = (await res.json()) as { serverUrl: string; token: string };
        if (cancelled) return;
        await room.connect(serverUrl, token, { autoSubscribe: false });
        if (cancelled) {
          void room.disconnect();
          return;
        }
        attempt = 0;
        setStatus('online');
      } catch {
        if (cancelled) return;
        setStatus('offline');
        schedule();
      }
    };

    void connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      room.removeAllListeners();
      void room.disconnect();
      if (roomRef.current === room) roomRef.current = null;
    };
    // The TV's name only labels it in the room; renaming doesn't need a reconnect
  }, [code, deviceId, approve, send, syncLists]);

  return { status, remotes, pending, approve, deny, publishState, sendFeedback };
}
