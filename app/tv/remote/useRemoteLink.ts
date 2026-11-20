'use client';

import React from 'react';
import { ConnectionState, Room, RoomEvent } from 'livekit-client';
import {
  TV_IDENTITY_PREFIX,
  TV_TOPIC,
  decodeTvMessage,
  encodeTvMessage,
  type TvCommand,
  type TvState,
} from '@/lib/tv/protocol';
import { deviceLabel, saveLastTv, type RemoteIdentity } from '@/lib/tv/deviceIdentity';

export type LinkStatus =
  | 'idle'
  | 'connecting'
  | 'pending'
  | 'connected'
  | 'denied'
  | 'notFound'
  | 'error'
  /** The TV left (reloaded, switched off); we keep trying for a while */
  | 'lost';

export interface Feedback {
  id: number;
  heard: string;
  text: string;
  ok: boolean;
}

/**
 * The phone's side of the TV remote: joins the TV's pairing room, says hello (with the QR
 * secret when it has one), then sends commands and mirrors what the TV shows.
 */
export function useRemoteLink(identity: RemoteIdentity | null) {
  const [status, setStatus] = React.useState<LinkStatus>('idle');
  const [tvName, setTvName] = React.useState('');
  const [state, setState] = React.useState<TvState | null>(null);
  const [feedback, setFeedback] = React.useState<Feedback | null>(null);
  const roomRef = React.useRef<Room | null>(null);
  const targetRef = React.useRef<{ code: string; secret?: string } | null>(null);
  const retryRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Hello again until the TV answers: a hello sent before the TV has seen us join is dropped */
  const helloTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSeenSavedRef = React.useRef(0);
  const identityRef = React.useRef(identity);
  identityRef.current = identity;

  const stopHello = React.useCallback(() => {
    if (helloTimerRef.current) clearInterval(helloTimerRef.current);
    helloTimerRef.current = null;
  }, []);

  const cleanup = React.useCallback(() => {
    if (retryRef.current) clearTimeout(retryRef.current);
    retryRef.current = null;
    stopHello();
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      room.removeAllListeners();
      void room.disconnect();
    }
  }, [stopHello]);

  const sayHello = React.useCallback((room: Room) => {
    const id = identityRef.current;
    if (!id) return;
    const target = targetRef.current;
    void room.localParticipant
      .publishData(
        encodeTvMessage({
          t: 'hello',
          name: id.name || 'Guest',
          device: deviceLabel(navigator.userAgent),
          deviceId: id.deviceId,
          ...(target?.secret ? { secret: target.secret } : {}),
        }),
        { reliable: true, topic: TV_TOPIC },
      )
      .catch(() => undefined); // retried until the TV answers
  }, []);

  const connect = React.useCallback(
    async (code: string, secret?: string, quiet = false) => {
      const id = identityRef.current;
      if (!id) return;
      cleanup();
      targetRef.current = { code, secret };
      if (!quiet) setStatus('connecting');
      let res: Response;
      try {
        res = await fetch('/api/tv/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'remote', code, deviceId: id.deviceId, name: id.name || 'Guest' }),
        });
      } catch {
        setStatus(quiet ? 'lost' : 'error');
        return;
      }
      if (res.status === 404) {
        setStatus(quiet ? 'lost' : 'notFound');
        return;
      }
      if (!res.ok) {
        setStatus(quiet ? 'lost' : 'error');
        return;
      }
      const { serverUrl, token } = (await res.json()) as { serverUrl: string; token: string };
      const room = new Room({ adaptiveStream: false, dynacast: false });
      roomRef.current = room;
      room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (topic !== TV_TOPIC || !participant?.identity.startsWith(TV_IDENTITY_PREFIX)) return;
        const msg = decodeTvMessage(payload);
        if (!msg) return;
        if (msg.t === 'welcome') {
          stopHello();
          setTvName(msg.tvName);
          if (msg.status === 'approved') {
            setStatus('connected');
            saveLastTv({ code, secret, tvName: msg.tvName, at: Date.now() });
          } else if (msg.status === 'pending') setStatus('pending');
          else {
            setStatus('denied');
            cleanup();
          }
        } else if (msg.t === 'state') {
          setState(msg.state);
          setTvName(msg.state.name);
          if (Date.now() - lastSeenSavedRef.current > 60_000) {
            lastSeenSavedRef.current = Date.now();
            saveLastTv({ code, secret, tvName: msg.state.name, at: Date.now() });
          }
        } else if (msg.t === 'feedback') {
          setFeedback({ id: Date.now(), heard: msg.heard, text: msg.text, ok: msg.ok });
        }
      });
      // The TV came back after a reload: introduce ourselves again
      room.on(RoomEvent.ParticipantConnected, (p) => {
        if (p.identity.startsWith(TV_IDENTITY_PREFIX)) sayHello(room);
      });
      room.on(RoomEvent.ParticipantDisconnected, (p) => {
        if (!p.identity.startsWith(TV_IDENTITY_PREFIX)) return;
        setStatus('lost');
      });
      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) return;
        setStatus('lost');
        retryRef.current = setTimeout(() => {
          if (targetRef.current) void connect(targetRef.current.code, targetRef.current.secret, true);
        }, 4000);
      });
      try {
        await room.connect(serverUrl, token, { autoSubscribe: false });
      } catch {
        if (roomRef.current === room) setStatus(quiet ? 'lost' : 'error');
        return;
      }
      if (roomRef.current !== room) return;
      sayHello(room);
      let tries = 0;
      helloTimerRef.current = setInterval(() => {
        if (roomRef.current !== room || ++tries > 12) {
          stopHello();
          return;
        }
        sayHello(room);
      }, 1500);
    },
    [cleanup, sayHello, stopHello],
  );

  // While the TV is gone, look for it again every few seconds (up to ~2 minutes)
  React.useEffect(() => {
    if (status !== 'lost' || !targetRef.current) return;
    let tries = 0;
    const id = setInterval(() => {
      tries++;
      const room = roomRef.current;
      const tvHere = room && Array.from(room.remoteParticipants.values()).some((p) => p.identity.startsWith(TV_IDENTITY_PREFIX));
      if (tvHere) return;
      if (tries > 30 || !targetRef.current) {
        // Gone for good: back to the pair screen (it offers to reconnect)
        clearInterval(id);
        targetRef.current = null;
        cleanup();
        setStatus('idle');
        setState(null);
        return;
      }
      void connect(targetRef.current.code, targetRef.current.secret, true);
    }, 4000);
    return () => clearInterval(id);
  }, [status, connect, cleanup]);

  React.useEffect(() => cleanup, [cleanup]);

  const send = React.useCallback((cmd: TvCommand) => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(8);
    void room.localParticipant
      .publishData(encodeTvMessage({ t: 'cmd', cmd }), { reliable: true, topic: TV_TOPIC })
      .catch(() => undefined);
  }, []);

  const disconnect = React.useCallback(() => {
    targetRef.current = null;
    cleanup();
    setStatus('idle');
    setState(null);
  }, [cleanup]);

  return { status, tvName, state, feedback, connect, send, disconnect };
}
