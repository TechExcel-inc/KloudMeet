'use client';

/**
 * Development-only preview of the host's "wants to join" prompt (lib/JoinRequestsPrompt.tsx)
 * over a meeting-like stage, without LiveKit: the room is a stub and the waiting list is mocked.
 * /dev/access?n=3 shows three people waiting; Admit / Deny update the mock. Not served in production.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import type { Room } from 'livekit-client';
import { JoinRequestsPrompt } from '@/lib/JoinRequestsPrompt';

const PEOPLE = [
  { displayName: 'Mina Sato', email: 'mina.sato@example.jp' },
  { displayName: 'Jonas Lind', email: 'jonas@nordic.io' },
  { displayName: 'Priya Rao', email: 'priya@partner.co' },
  { displayName: 'Marco Bianchi', email: 'marco@studio.it' },
];

function useMockedWaitingList(count: number) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let waiting = PEOPLE.slice(0, count).map((p, i) => ({
      id: i + 1,
      ...p,
      avatarUrl: null,
      requestedAt: new Date(Date.now() - (count - i) * 20_000).toISOString(),
    }));
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/join-requests')) return realFetch(input, init);
      if ((init?.method ?? 'GET') === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        waiting = body.all ? [] : waiting.filter((p) => !body.ids.includes(p.id));
        return new Response(JSON.stringify({ updated: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ companyName: 'Acme', requests: waiting }), { status: 200 });
    };
    setReady(true);
    return () => {
      window.fetch = realFetch;
    };
  }, [count]);
  return ready;
}

const stubRoom = { name: 'dev-access', on: () => stubRoom, off: () => stubRoom } as unknown as Room;

export default function DevAccessPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [count] = React.useState(() => {
    if (typeof window === 'undefined') return 3;
    const n = Number(new URL(window.location.href).searchParams.get('n'));
    return Number.isFinite(n) && n >= 0 ? Math.min(n, PEOPLE.length) : 3;
  });
  const ready = useMockedWaitingList(count);

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  return (
    <div style={{ height: '100vh', background: '#141518', padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {['Ying Huang (You)', 'Ana Ng', 'Marco Bianchi', 'Ken Tanaka'].map((name) => (
        <div
          key={name}
          style={{ borderRadius: 12, background: '#2a2b30', color: '#e8eaed', display: 'flex', alignItems: 'flex-end', padding: 12, font: '500 14px system-ui' }}
        >
          {name}
        </div>
      ))}
      {ready && <JoinRequestsPrompt room={stubRoom} canAdmit />}
    </div>
  );
}
