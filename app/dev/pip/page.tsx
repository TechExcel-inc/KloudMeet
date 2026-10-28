'use client';

/**
 * Development-only preview of the meeting mini window (Document Picture-in-Picture panel) in every
 * case side by side: 1–9 people, your own share, someone else's share, and the minimized pill.
 * Fake participants, no meeting needed. Not served in production.
 *
 * ?only=<id>[,<id>] shows just those cases, ?h=<px> changes the expanded window height.
 */

import React from 'react';
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

function makeRoom(c: Case): Room {
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

function PipCase({ c, expandedH }: { c: Case; expandedH: number }) {
  const [room] = React.useState(() => makeRoom(c));
  const [minimized, setMinimized] = React.useState(Boolean(c.minimized));
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ color: '#aab', font: '600 12px system-ui', margin: '0 0 6px' }}>
        {c.title}
      </figcaption>
      <div
        data-kloud-pip="true"
        style={{
          width: PIP_EXPANDED_W,
          height: minimized ? PIP_MINIMIZED_H : expandedH,
          background: minimized ? 'transparent' : '#1a1b1e',
          position: 'relative',
        }}
      >
        <MeetingDocumentPipPanel
          room={room}
          pipWindow={window}
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
        />
      </div>
    </figure>
  );
}

export default function DevPipPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [ready, setReady] = React.useState(false);
  const [only, setOnly] = React.useState<string[] | null>(null);
  const [expandedH, setExpandedH] = React.useState(420);
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ids = q.get('only');
    if (ids) setOnly(ids.split(','));
    const h = Number(q.get('h'));
    if (h > 0) setExpandedH(h);
    // The real mini window flags its own <html>; the tile styles only apply under it
    document.documentElement.setAttribute('data-kloud-pip', 'true');
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
        <PipCase key={c.id} c={c} expandedH={expandedH} />
      ))}
    </div>
  );
}
