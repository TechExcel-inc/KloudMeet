'use client';

/**
 * Development-only check of the mic chips on meeting tiles, through the real code: LiveKit's
 * ParticipantTile, the room's tile chips (useTileIndicators) and stylesheets, the desktop grid
 * and the phone grid (MobileVideoLayout). Fake participants in every mic state, plus the
 * recording bot, which must not get a tile. No meeting needed. Not served in production.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { ParticipantTile, RoomContext } from '@livekit/components-react';
import { RemoteParticipant, Room, Track, type Participant } from 'livekit-client';
import { useTileIndicators } from '@/app/rooms/[roomName]/useTileIndicators';
import { MobileVideoLayout } from '@/app/rooms/[roomName]/roomVideoLayouts';
import { RECORDER_PARTICIPANT_METADATA, visibleRemoteParticipants } from '@/lib/recorderParticipant';
import '@/styles/roomStage.css';

type MicState = 'on' | 'speaking' | 'muted' | 'hostMuted';

const PEOPLE: Array<{ name: string; mic: MicState }> = [
  { name: 'ying', mic: 'muted' },
  { name: 'tierenz', mic: 'speaking' },
  { name: 'guifu', mic: 'on' },
  { name: 'Xiao yu', mic: 'muted' },
  { name: 'ztang', mic: 'hostMuted' },
];

function withMic(p: Participant, on: boolean) {
  if (!on) return;
  const orig = p.getTrackPublication.bind(p);
  const mic = { track: {}, isMuted: false, source: Track.Source.Microphone, kind: Track.Kind.Audio };
  (p as unknown as { getTrackPublication: unknown }).getTrackPublication = (src: Track.Source) =>
    src === Track.Source.Microphone ? mic : orig(src);
}

function makeRoom(): Room {
  const room = new Room();
  const lp = room.localParticipant;
  Object.defineProperty(lp, 'identity', { value: 'kloud_1_ying', configurable: true });
  Object.defineProperty(lp, 'name', { value: PEOPLE[0].name, configurable: true });
  PEOPLE.forEach((person, i) => {
    const p =
      i === 0 ? lp : new RemoteParticipant(undefined as never, `PA_${i}`, `kloud_${i + 1}`, person.name);
    withMic(p, person.mic === 'on' || person.mic === 'speaking');
    if (person.mic === 'speaking') (p as unknown as { setIsSpeaking: (s: boolean) => void }).setIsSpeaking(true);
    if (i > 0) room.remoteParticipants.set(p.identity, p as RemoteParticipant);
  });
  const bot = new RemoteParticipant(
    undefined as never,
    'PA_rec',
    'guest_KloudMeet Recorder__ab12',
    'KloudMeet Recorder',
    RECORDER_PARTICIPANT_METADATA,
  );
  room.remoteParticipants.set(bot.identity, bot);
  return room;
}

const HOST_MUTED = ['kloud_5'];

function Tiles({ room }: { room: Room }) {
  const ref = <T,>(value: T) => ({ current: value });
  const [refs] = React.useState(() => ({
    muteAllActiveRef: ref(false),
    hostMutedIdentitiesRef: ref(HOST_MUTED),
    hostDisabledVideoIdentitiesRef: ref<string[]>([]),
    exemptFromMuteAllIdentitiesRef: ref<string[]>([]),
    raisedHandsRef: ref(['kloud_4']),
    updateCustomMicsRef: ref<(() => void) | null>(null),
  }));
  useTileIndicators({
    room,
    hostIdentity: 'kloud_1_ying',
    cohostIdentities: [],
    autoPresenterIdentity: null,
    copresenterIdentities: [],
    isHost: true,
    isCohost: false,
    muteAllActive: false,
    hostMutedIdentities: HOST_MUTED,
    hostDisabledVideoIdentities: [],
    exemptFromMuteAllIdentities: [],
    hasScreenShare: false,
    isWebcamSidebarCollapsed: false,
    ...refs,
  });
  // The chips are drawn on the next animation frame, which a background tab never gets:
  // kmTileRefresh() in the console draws them now.
  React.useEffect(() => {
    (window as unknown as { kmTileRefresh?: () => void }).kmTileRefresh = () => refs.updateCustomMicsRef.current?.();
  }, [refs]);
  const people = [room.localParticipant, ...visibleRemoteParticipants(room.remoteParticipants.values())];

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', padding: 16 }}>
      <section style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ color: '#9aa0a6', font: '500 13px var(--km-font)', margin: '0 0 8px' }}>Desktop grid</h2>
        <div className="lk-grid-layout-wrapper" style={{ height: 420 }}>
          <div className="lk-grid-layout" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 1fr)' }}>
            {people.map((p) => (
              <ParticipantTile key={p.identity} trackRef={{ participant: p, source: Track.Source.Camera }} />
            ))}
          </div>
        </div>
      </section>
      <section style={{ width: 375, flex: 'none' }}>
        <h2 style={{ color: '#9aa0a6', font: '500 13px var(--km-font)', margin: '0 0 8px' }}>Phone grid</h2>
        <div style={{ height: 560, display: 'flex' }}>
          <MobileVideoLayout />
        </div>
      </section>
    </div>
  );
}

export default function DevTileMicPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [room, setRoom] = React.useState<Room | null>(null);
  React.useEffect(() => setRoom(makeRoom()), []);
  if (!room) return null;
  return (
    <RoomContext.Provider value={room}>
      <div className="lk-room-container" data-lk-theme="default" style={{ minHeight: '100vh', background: 'var(--km-stage, #17181c)' }}>
        <Tiles room={room} />
      </div>
    </RoomContext.Provider>
  );
}
