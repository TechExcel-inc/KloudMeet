'use client';

/**
 * Development-only harness for the Excalidraw board (lib/whiteboard/WhiteboardStage.tsx), without
 * a meeting. Open it in two or more tabs of the same browser; they talk over a BroadcastChannel
 * instead of LiveKit, and the board is "saved" to this browser's localStorage instead of Kloud.
 *
 *   /dev/whiteboard?name=Ying&role=host        – host: draws and leads (saves, others follow)
 *   /dev/whiteboard?name=Mo&role=cohost        – co-host: draws
 *   /dev/whiteboard?name=Alex                  – participant: view only, follows the leader
 *   &board=42                                  – another board (default 1)
 *
 * Not served in production.
 */

import React from 'react';
import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';
import { RoomEvent, type Room } from 'livekit-client';
import { LIVEDOC_ANONYMOUS_GUID_KEY } from '@/lib/livedoc/client';
import type { BoardRoles } from '@/lib/whiteboard/protocol';

const WhiteboardStage = dynamic(() => import('@/lib/whiteboard/WhiteboardStage'), { ssr: false });

type Role = 'host' | 'cohost' | 'presenter' | 'participant';
type Wire =
  | { kind: 'hello' | 'here' | 'bye'; from: string; name: string; role: Role }
  | { kind: 'text'; from: string; to?: string[]; topic: string; text: string }
  | { kind: 'data'; from: string; topic: string; bytes: number[] };

const CHANNEL = 'kloudmeet-dev-whiteboard';
const SERVER_KEY = (board: number) => `kloudmeet.dev.whiteboard.server.${board}`;

/** Answers /api/whiteboard/scene from localStorage, with the server's version check. */
function installFakeSceneApi() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.pathname !== '/api/whiteboard/scene') return realFetch(input, init);
    const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    await new Promise((r) => setTimeout(r, 150));
    if ((init?.method ?? 'GET') === 'GET') {
      const board = Number(url.searchParams.get('attachmentId'));
      const stored = JSON.parse(localStorage.getItem(SERVER_KEY(board)) || 'null') as { version: number; scene: string } | null;
      return reply({ code: 0, data: { attachmentId: board, version: stored?.version ?? 0, scene: stored?.scene ?? null } });
    }
    const body = JSON.parse(String(init?.body)) as { attachmentId: number; baseVersion: number; scene: string };
    const stored = JSON.parse(localStorage.getItem(SERVER_KEY(body.attachmentId)) || 'null') as { version: number } | null;
    const current = stored?.version ?? 0;
    if (current !== body.baseVersion) return reply({ code: 227, msg: 'version conflict', data: current });
    localStorage.setItem(SERVER_KEY(body.attachmentId), JSON.stringify({ version: current + 1, scene: body.scene }));
    const count = (JSON.parse(body.scene) as { elements: unknown[] }).elements.length;
    console.info(`[dev whiteboard] saved board ${body.attachmentId} as version ${current + 1} (${count} elements)`);
    if (!count) console.trace('[dev whiteboard] empty save');
    return reply({ code: 0, data: current + 1 });
  };
}

/** Just enough of a LiveKit Room for WhiteboardStage, carried over a BroadcastChannel. */
function createFakeRoom(identity: string, name: string, role: Role, onPeers: (peers: Map<string, { name: string; role: Role }>) => void) {
  const channel = new BroadcastChannel(CHANNEL);
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const textHandlers = new Map<string, (reader: { readAll(): Promise<string> }, info: { identity: string }) => void>();
  const peers = new Map<string, { name: string; role: Role }>();
  const remoteParticipants = new Map<string, { identity: string; name: string }>();
  const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((fn) => fn(...args));
  const post = (msg: Wire) => channel.postMessage(msg);

  channel.onmessage = (event: MessageEvent<Wire>) => {
    const msg = event.data;
    if (msg.from === identity) return;
    if (msg.kind === 'hello' || msg.kind === 'here') {
      const isNew = !peers.has(msg.from);
      peers.set(msg.from, { name: msg.name, role: msg.role });
      remoteParticipants.set(msg.from, { identity: msg.from, name: msg.name });
      if (msg.kind === 'hello') post({ kind: 'here', from: identity, name, role });
      if (isNew) emit(RoomEvent.ParticipantConnected, remoteParticipants.get(msg.from));
      onPeers(new Map(peers));
    } else if (msg.kind === 'bye') {
      peers.delete(msg.from);
      remoteParticipants.delete(msg.from);
      emit(RoomEvent.ParticipantDisconnected, { identity: msg.from });
      onPeers(new Map(peers));
    } else if (msg.kind === 'text') {
      if (msg.to && !msg.to.includes(identity)) return;
      textHandlers.get(msg.topic)?.({ readAll: async () => msg.text }, { identity: msg.from });
    } else if (msg.kind === 'data') {
      const p = remoteParticipants.get(msg.from);
      if (p) emit(RoomEvent.DataReceived, new Uint8Array(msg.bytes), p, undefined, msg.topic);
    }
  };
  post({ kind: 'hello', from: identity, name, role });
  window.addEventListener('pagehide', () => post({ kind: 'bye', from: identity, name, role }));

  const room = {
    localParticipant: {
      identity,
      name,
      sendText: async (text: string, opts?: { topic?: string; destinationIdentities?: string[] }) => {
        post({ kind: 'text', from: identity, to: opts?.destinationIdentities, topic: opts?.topic ?? '', text });
        return {};
      },
      publishData: async (data: Uint8Array, opts?: { topic?: string }) => {
        post({ kind: 'data', from: identity, topic: opts?.topic ?? '', bytes: Array.from(data) });
      },
    },
    remoteParticipants,
    on(event: string, fn: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return room;
    },
    off(event: string, fn: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(fn);
      return room;
    },
    registerTextStreamHandler(topic: string, fn: (reader: { readAll(): Promise<string> }, info: { identity: string }) => void) {
      if (textHandlers.has(topic)) throw new Error(`handler for ${topic} already set`);
      textHandlers.set(topic, fn);
    },
    unregisterTextStreamHandler(topic: string) {
      textHandlers.delete(topic);
    },
  };
  return room as unknown as Room;
}

function Harness({ name, role, board: firstBoard }: { name: string; role: Role; board: number }) {
  // Like switching LiveDoc files in a meeting: the stage closes one board and opens another
  const [board, setBoard] = React.useState(firstBoard);
  const identity = `dev-${name.toLowerCase()}`;
  const [peers, setPeers] = React.useState(new Map<string, { name: string; role: Role }>());
  const [room, setRoom] = React.useState<Room | null>(null);
  React.useEffect(() => {
    installFakeSceneApi();
    // A cached instant-account token, so the stage never calls PeerTime
    try {
      const guid = localStorage.getItem(LIVEDOC_ANONYMOUS_GUID_KEY) || `dev-${identity}`;
      localStorage.setItem(LIVEDOC_ANONYMOUS_GUID_KEY, guid);
      localStorage.setItem(`KloudMeet_instant_token_${guid}`, 'dev-token');
    } catch {
      // ignore
    }
    setRoom(createFakeRoom(identity, name, role, setPeers));
  }, [identity, name, role]);

  const roles = React.useMemo<BoardRoles>(() => {
    const all = new Map(peers);
    all.set(identity, { name, role });
    const ids = (r: Role) => [...all].filter(([, p]) => p.role === r).map(([id]) => id);
    return { hostIdentity: ids('host')[0] ?? null, cohostIdentities: ids('cohost'), presenterIdentities: ids('presenter') };
  }, [peers, identity, name, role]);

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#202124', color: '#e8eaed', font: '13px system-ui, sans-serif' }}>
      <div style={{ padding: '8px 12px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <b>
          {name} · {role}
        </b>
        <span>
          board{' '}
          {[1, 2].map((b) => (
            <button key={b} type="button" onClick={() => setBoard(b)} disabled={b === board} style={{ marginRight: 4 }}>
              {b}
            </button>
          ))}
        </span>
        <span>
          others: {[...peers].map(([, p]) => `${p.name} (${p.role})`).join(', ') || 'none — open another tab'}
        </span>
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        {room && <WhiteboardStage key={board} room={room} attachmentId={board} username={name} roles={roles} />}
      </div>
    </div>
  );
}

export default function DevWhiteboardPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [params, setParams] = React.useState<URLSearchParams | null>(null);
  React.useEffect(() => setParams(new URLSearchParams(window.location.search)), []);
  if (!params) return null;
  const roleParam = params.get('role');
  const role: Role =
    roleParam === 'host' || roleParam === 'cohost' || roleParam === 'presenter' ? roleParam : 'participant';
  return (
    <Harness
      name={params.get('name') || (role === 'participant' ? 'Alex' : 'Ying')}
      role={role}
      board={Number(params.get('board')) || 1}
    />
  );
}
