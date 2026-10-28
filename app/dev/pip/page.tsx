'use client';

/**
 * Development-only preview of the meeting mini window (Document Picture-in-Picture panel) in every
 * case side by side: 1–9 people, your own share, someone else's share, and the minimized pill.
 * Fake participants, no meeting needed. Not served in production.
 *
 * ?only=<id>[,<id>] shows just those cases, ?h=<px> / ?w=<px> change the expanded window size,
 * ?speak=<n>[,<n>] marks people as speaking (0 is you, 1 is Tieren, …).
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notFound } from 'next/navigation';
import {
  LocalVideoTrack,
  RemoteParticipant,
  Room,
  Track,
  TrackPublication,
  type Participant,
} from 'livekit-client';
import {
  MeetingDocumentPipPanel,
  PIP_EXPANDED_W,
  PIP_MINIMIZED_H,
} from '@/lib/MeetingDocumentPipPanel';
import { copyDocumentStyles } from '@/lib/documentPipSupport';
import '@/styles/roomStage.css';
import '@/styles/floatingTiles.css';

const NAMES = [
  'Ying',
  'Tieren Zhou',
  'Xiaoyu Wu',
  'Alex Kim',
  'Mina Park',
  'Sam Lee',
  'Jo Tan',
  'Ravi N',
  'Lea M',
];

const labels = {
  muteMic: 'Mute',
  unmuteMic: 'Unmute',
  turnOffCam: 'Turn off camera',
  turnOnCam: 'Turn on camera',
  leave: 'Leave',
  endForEveryone: 'End for everyone',
  meeting: 'In meeting',
  you: 'You',
  minimize: 'Minimize',
  restore: 'Restore',
  shareBadge: 'Sharing screen',
  presentingSelf: 'Presenting',
  shareScreen: 'Share screen',
  stopSharing: 'Stop sharing',
  shareConflict: 'Someone is sharing',
  invite: 'Copy invite link',
  inviteCopied: 'Link copied',
  settings: 'Controls',
  backToMain: 'Back to meeting',
  close: 'Close',
  people: '{n} people',
  person: '1 person',
  recording: 'REC',
  aloneTitle: 'Only you here',
  aloneBody: 'Share the link so others can join.',
  copyInvite: 'Copy invite link',
};

type Case = {
  id: string;
  title: string;
  people: number;
  share: 'none' | 'local' | 'remote';
  minimized?: boolean;
};

/** The header clock in every case: a meeting that started 23 minutes ago */
const DEV_STARTED_AT = Date.now() - 23 * 60_000 - 14_000;

const CASES: Case[] = [
  { id: 'p1', title: '1 person', people: 1, share: 'none' },
  { id: 'p2', title: '2 people', people: 2, share: 'none' },
  { id: 'p3', title: '3 people', people: 3, share: 'none' },
  { id: 'p5', title: '5 people', people: 5, share: 'none' },
  { id: 'p9', title: '9 people', people: 9, share: 'none' },
  { id: 'p30', title: '30 people', people: 30, share: 'none' },
  { id: 'me2', title: 'I share · 2 people', people: 2, share: 'local' },
  { id: 'other3', title: 'Tieren shares · 3 people', people: 3, share: 'remote' },
  { id: 'other7', title: 'Tieren shares · 7 people', people: 7, share: 'remote' },
  { id: 'min2', title: 'Minimized · 2 people', people: 2, share: 'none', minimized: true },
  { id: 'minme', title: 'Minimized · I share', people: 2, share: 'local', minimized: true },
  {
    id: 'minother',
    title: 'Minimized · Tieren shares',
    people: 3,
    share: 'remote',
    minimized: true,
  },
  { id: 'min7', title: 'Minimized · 7 people', people: 7, share: 'none', minimized: true },
  { id: 'minme7', title: 'Minimized · I share · 7', people: 7, share: 'local', minimized: true },
  { id: 'minother7', title: 'Minimized · Tieren shares · 7', people: 7, share: 'remote', minimized: true },
];

/** A screen share that looks like slides, drawn on a canvas so the real video tile can show it */
function fakeScreenTrack(): LocalVideoTrack {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f5f6fa';
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = '#5552d9';
    ctx.fillRect(0, 0, 1280, 120);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText('Q4 roadmap', 60, 82);
    ctx.fillStyle = '#c9cce0';
    for (let i = 0; i < 5; i++) ctx.fillRect(60, 190 + i * 90, 760 - i * 90, 36);
  }
  const mst = canvas.captureStream(2).getVideoTracks()[0];
  const track = new LocalVideoTrack(mst, undefined, false);
  (track as unknown as { source: Track.Source }).source = Track.Source.ScreenShare;
  return track;
}

function shareWith(p: Participant, publication: unknown) {
  const orig = p.getTrackPublication.bind(p);
  (p as unknown as { getTrackPublication: unknown }).getTrackPublication = (src: Track.Source) =>
    src === Track.Source.ScreenShare ? publication : orig(src);
}

function makeRoom(c: Case, speaking: number[]): Room {
  const room = new Room();
  const lp = room.localParticipant;
  Object.defineProperty(lp, 'identity', { value: 'kloud_1_ying', configurable: true });
  Object.defineProperty(lp, 'name', { value: NAMES[0], configurable: true });
  const base = Date.now() - 60_000;
  Object.defineProperty(lp, 'joinedAt', { value: new Date(base), configurable: true });
  for (let i = 1; i < c.people; i++) {
    const identity = `kloud_${i + 1}`;
    const p = new RemoteParticipant(
      undefined as never,
      `PA_${i}`,
      identity,
      NAMES[i % NAMES.length],
    );
    Object.defineProperty(p, 'joinedAt', { value: new Date(base + i * 1000), configurable: true });
    room.remoteParticipants.set(identity, p);
  }
  // A speaker's mic is on: the tile shows the voice bars instead of the muted mic
  for (const n of speaking) {
    const p = n === 0 ? lp : room.remoteParticipants.get(`kloud_${n + 1}`);
    if (!p) continue;
    const orig = p.getTrackPublication.bind(p);
    const mic = {
      track: {},
      isMuted: false,
      source: Track.Source.Microphone,
      kind: Track.Kind.Audio,
    };
    (p as unknown as { getTrackPublication: unknown }).getTrackPublication = (src: Track.Source) =>
      src === Track.Source.Microphone ? mic : orig(src);
    (p as unknown as { setIsSpeaking?: (s: boolean) => void }).setIsSpeaking?.(true);
  }
  if (c.share === 'local') {
    shareWith(lp, { track: {}, isMuted: false, source: Track.Source.ScreenShare });
  }
  if (c.share === 'remote') {
    const sharer = room.remoteParticipants.get('kloud_2');
    if (sharer) {
      // The base class is abstract only in its typings; a plain one is enough to carry the track
      const Publication = TrackPublication as unknown as new (
        kind: Track.Kind,
        sid: string,
        name: string,
      ) => TrackPublication;
      const pub = new Publication(Track.Kind.Video, 'TR_share', 'screen');
      (pub as unknown as { setTrack: (t: unknown) => void }).setTrack(fakeScreenTrack());
      shareWith(sharer, pub);
    }
  }
  return room;
}

function PipCase({
  c,
  expandedW,
  expandedH,
  speaking,
}: {
  c: Case;
  expandedW: number;
  expandedH: number;
  speaking: number[];
}) {
  const [room] = React.useState(() => makeRoom(c, speaking));
  const [minimized, setMinimized] = React.useState(Boolean(c.minimized));
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const rootRef = React.useRef<Root | null>(null);
  const [pipWindow, setPipWindow] = React.useState<Window | null>(null);

  // The real mini window is a separate document without a doctype, so it lays out in quirks mode
  // (percent heights behave differently there). Each case gets a blank frame set up the same way
  // as useMeetingDocumentPip does it, so what shows here is what shows in the meeting.
  React.useEffect(() => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    const doc = win.document;
    const headBefore = doc.head.childNodes.length;
    copyDocumentStyles(document, doc);
    const styles = Array.from(doc.head.childNodes).slice(headBefore);
    doc.documentElement.setAttribute('data-lk-theme', 'default');
    doc.documentElement.setAttribute('data-kloud-pip', 'true');
    doc.documentElement.style.height = '100%';
    doc.body.style.margin = '0';
    doc.body.style.height = '100%';
    doc.body.style.overflow = 'hidden';
    const mount = doc.createElement('div');
    mount.style.height = '100%';
    mount.style.width = '100%';
    doc.body.appendChild(mount);
    const root = createRoot(mount);
    rootRef.current = root;
    setPipWindow(win);
    return () => {
      rootRef.current = null;
      styles.forEach((node) => node.remove());
      mount.remove();
      // Not while the page itself is still unmounting
      setTimeout(() => root.unmount());
    };
  }, []);

  React.useEffect(() => {
    if (!pipWindow || !rootRef.current) return;
    pipWindow.document.body.style.background = minimized ? 'transparent' : '#1a1b1e';
    rootRef.current.render(
      <MeetingDocumentPipPanel
        room={room}
        pipWindow={pipWindow}
        micEnabled={c.id !== 'p1'}
        camEnabled={false}
        labels={labels}
        localName={NAMES[0]}
        mediaRestrictions={{
          hostMutedIdentities: [],
          hostDisabledVideoIdentities: [],
          muteAllActive: false,
          exemptFromMuteAllIdentities: [],
          hostIdentity: 'kloud_1_ying',
          cohostIdentities: [],
          autoPresenterIdentity: null,
          copresenterIdentities: [],
          roomLocalIdentity: 'kloud_1_ying',
          isHost: true,
          isCohost: false,
          raisedHands: [],
        }}
        onToggleMic={() => {}}
        onToggleCam={() => {}}
        onToggleShare={() => {}}
        shareActive={c.share === 'local'}
        hasScreenShare={c.share !== 'none'}
        onLeave={() => {}}
        onEndForAll={() => {}}
        initialMinimized={Boolean(c.minimized)}
        onMinimizedChange={setMinimized}
        // Header: instant meetings have no name; a recording case shows REC
        meetingTitle={c.people > 2 ? 'Weekly product review' : undefined}
        startedAtMs={DEV_STARTED_AT}
        isRecording={c.share === 'remote'}
      />,
    );
  }, [pipWindow, minimized, room, c]);

  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ color: '#aab', font: '600 12px system-ui', margin: '0 0 6px' }}>
        {c.title}
      </figcaption>
      <iframe
        ref={frameRef}
        title={c.title}
        style={{
          display: 'block',
          border: 0,
          width: minimized ? PIP_EXPANDED_W : expandedW,
          height: minimized ? PIP_MINIMIZED_H : expandedH,
          background: 'transparent',
        }}
      />
    </figure>
  );
}

export default function DevPipPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [ready, setReady] = React.useState(false);
  const [only, setOnly] = React.useState<string[] | null>(null);
  const [expandedH, setExpandedH] = React.useState(420);
  const [expandedW, setExpandedW] = React.useState(PIP_EXPANDED_W);
  const [speaking, setSpeaking] = React.useState<number[]>([]);
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ids = q.get('only');
    if (ids) setOnly(ids.split(','));
    const h = Number(q.get('h'));
    if (h > 0) setExpandedH(h);
    const w = Number(q.get('w'));
    if (w > 0) setExpandedW(w);
    const speak = q.get('speak');
    if (speak)
      setSpeaking(
        speak
          .split(',')
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 0),
      );
    setReady(true);
  }, []);
  if (!ready) return null;
  const cases = only ? CASES.filter((c) => only.includes(c.id)) : CASES;
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#2b2c31',
        padding: 24,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: 28,
      }}
    >
      {cases.map((c) => (
        <PipCase key={c.id} c={c} expandedW={expandedW} expandedH={expandedH} speaking={speaking} />
      ))}
    </div>
  );
}
