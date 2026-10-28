'use client';

/**
 * Development-only page for the meeting mini window through the real hook
 * (lib/useMeetingDocumentPip.tsx): fake participants, no meeting. In the browser it opens Chrome's
 * Document Picture-in-Picture; in the desktop app, the app's own window that screen shares leave
 * out. Not served in production.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { RemoteParticipant, Room } from 'livekit-client';
import { useMeetingDocumentPip } from '@/lib/useMeetingDocumentPip';
import { getDesktopMiniWindow } from '@/lib/documentPipSupport';
import '@/styles/roomStage.css';
import '@/styles/floatingTiles.css';

const NAMES = ['Ying', 'Alex Kim', 'Mina Park', 'Sam Lee'];

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

function makeRoom(): Room {
  const room = new Room();
  const lp = room.localParticipant;
  Object.defineProperty(lp, 'identity', { value: 'kloud_1_ying', configurable: true });
  Object.defineProperty(lp, 'name', { value: NAMES[0], configurable: true });
  for (let i = 1; i < NAMES.length; i++) {
    const identity = `kloud_${i + 1}`;
    room.remoteParticipants.set(
      identity,
      new RemoteParticipant(undefined as never, `PA_${i}`, identity, NAMES[i]),
    );
  }
  return room;
}

const restrictions = {
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
};

export default function DevMiniWindowPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [room] = React.useState(makeRoom);
  const [sharing, setSharing] = React.useState(false);
  const [desktop, setDesktop] = React.useState<boolean | null>(null);
  React.useEffect(() => setDesktop(getDesktopMiniWindow() !== null), []);
  const pip = useMeetingDocumentPip({
    enabled: desktop !== null,
    room,
    micEnabled: true,
    camEnabled: false,
    labels,
    localName: NAMES[0],
    mediaRestrictions: restrictions,
    roleActions: {
      hostIdentity: 'kloud_1_ying',
      copresenterIdentities: [],
      cohostIdentities: [],
      canManageRoles: false,
      localIdentity: 'kloud_1_ying',
      autoPresenterIdentity: null,
      raisedHands: [],
      canLowerHands: false,
    },
    onToggleMic: () => {},
    onToggleCam: () => {},
    onToggleShare: () => setSharing((on) => !on),
    shareActive: sharing,
    hasScreenShare: sharing,
    onLeave: () => {},
    onMuteParticipant: () => {},
    onDisableParticipantVideo: () => {},
  });
  // For scripted checks from the desktop test shell
  React.useEffect(() => {
    (window as unknown as { __miniTest: unknown }).__miniTest = {
      open: (opts?: { sticky?: boolean; minimized?: boolean }) => pip.open(opts),
      close: () => pip.close(),
      isOpen: pip.isOpen,
    };
  }, [pip]);
  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#202126',
        color: '#e8eaed',
        padding: 32,
        font: '14px system-ui',
      }}
    >
      <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>Mini window</h1>
      <p style={{ margin: '0 0 16px', color: '#9aa0a6' }}>
        {desktop
          ? 'Desktop app: its own window, left out of screen shares'
          : 'Browser: Document Picture-in-Picture'}
        {' · '}
        {pip.isOpen ? 'open' : 'closed'}
        {sharing ? ' · sharing' : ''}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => void pip.open({ sticky: true, minimized: true })}>
          Open (minimized)
        </button>
        <button type="button" onClick={() => void pip.open({ sticky: true, minimized: false })}>
          Open (expanded)
        </button>
        <button type="button" onClick={() => pip.close()}>
          Close
        </button>
        <button type="button" onClick={() => setSharing((on) => !on)}>
          {sharing ? 'Stop share' : 'Pretend to share'}
        </button>
      </div>
    </main>
  );
}
