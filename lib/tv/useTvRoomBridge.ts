'use client';

import React from 'react';
import { RoomEvent, type Room } from 'livekit-client';
import { visibleRemoteParticipants } from '@/lib/recorderParticipant';
import type { TvLayout, TvPerson, TvView } from './protocol';
import type { TvRoomHooks, TvRoomSnapshot } from './tvRoomBridge';

const MAX_PEOPLE = 40;

export interface TvRoomBridgeInput {
  room: Room;
  connected: boolean;
  micEnabled: boolean;
  camEnabled: boolean;
  captionsOn: boolean;
  handRaised: boolean;
  view: TvView;
  layout: TvLayout;
  hasScreenShare: boolean;
  /** Design mode is set and this participant may show it */
  canShowDesign: boolean;
  isHost: boolean;
  canEndForAll: boolean;
  recording: boolean;
  hostIdentity: string;
  raisedHands: string[];
  toggleMic: () => void;
  toggleCam: () => void;
  toggleCaptions: () => void;
  toggleHand: () => void;
  setLayout: (mode: TvLayout) => void;
  changeView: (view: TvView) => void;
  leave: () => void;
  endForAll: () => void;
}

/**
 * Connects a meeting to the Kloud Meet TV app (see tvRoomBridge.ts). Does nothing on the
 * web: `hooks` is only passed by /tv/rooms/[roomName].
 */
export function useTvRoomBridge(hooks: TvRoomHooks | undefined, input: TvRoomBridgeInput): void {
  const inputRef = React.useRef(input);
  inputRef.current = input;

  if (hooks) {
    hooks.actionsRef.current = {
      setMic: (on) => {
        if (on !== inputRef.current.micEnabled) inputRef.current.toggleMic();
      },
      setCam: (on) => {
        if (on !== inputRef.current.camEnabled) inputRef.current.toggleCam();
      },
      setCaptions: (on) => {
        if (on !== inputRef.current.captionsOn) inputRef.current.toggleCaptions();
      },
      setHand: (on) => {
        if (on !== inputRef.current.handRaised) inputRef.current.toggleHand();
      },
      // Same as the toolbar's Webcam ▾ menu: picking a layout also shows the video view
      setLayout: (mode) => {
        inputRef.current.setLayout(mode);
        if (inputRef.current.view !== 'webcam') inputRef.current.changeView('webcam');
      },
      setView: (view) => {
        const cur = inputRef.current;
        if (view === 'shareScreen' && !cur.hasScreenShare) return;
        if (view === 'design' && !cur.canShowDesign) return;
        if (view !== cur.view) cur.changeView(view);
      },
      leave: () => inputRef.current.leave(),
      endForAll: () => {
        if (inputRef.current.canEndForAll) inputRef.current.endForAll();
      },
    };
  }

  // People change without re-rendering the meeting (mute, hand, join/leave): count events
  const [peopleVersion, setPeopleVersion] = React.useState(0);
  const { room } = input;
  React.useEffect(() => {
    if (!hooks) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setPeopleVersion((v) => v + 1);
      }, 250);
    };
    const events = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.ParticipantNameChanged,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
    ] as const;
    events.forEach((e) => room.on(e, bump));
    return () => {
      events.forEach((e) => room.off(e, bump));
      if (timer) clearTimeout(timer);
    };
  }, [hooks, room]);

  const views = React.useMemo<TvView[]>(() => {
    const list: TvView[] = ['webcam', 'liveDoc'];
    if (input.hasScreenShare) list.push('shareScreen');
    if (input.canShowDesign) list.push('design');
    return list;
  }, [input.hasScreenShare, input.canShowDesign]);

  const onSnapshot = hooks?.onSnapshot;
  React.useEffect(() => {
    if (!onSnapshot) return;
    const hands = new Set(input.raisedHands);
    const local = room.localParticipant;
    const remotes = visibleRemoteParticipants(room.remoteParticipants.values());
    const toPerson = (p: typeof local | (typeof remotes)[number], me: boolean): TvPerson => ({
      id: p.identity,
      name: p.name || p.identity,
      mic: p.isMicrophoneEnabled,
      hand: hands.has(p.identity),
      ...(me ? { me: true } : {}),
      ...(p.identity === input.hostIdentity ? { host: true } : {}),
    });
    // Raised hands first (in the order they went up), then the host, then everyone else
    const order = (p: TvPerson) => (p.hand ? input.raisedHands.indexOf(p.id) : p.host ? 1_000 : 2_000);
    const people = [toPerson(local, true), ...remotes.map((p) => toPerson(p, false))].sort(
      (a, b) => order(a) - order(b),
    );
    const snapshot: TvRoomSnapshot = {
      mic: input.micEnabled,
      cam: input.camEnabled,
      captions: input.captionsOn,
      hand: input.handRaised,
      view: input.view,
      views,
      layout: input.layout,
      isHost: input.isHost,
      canEndForAll: input.canEndForAll,
      recording: input.recording,
      connected: input.connected,
      peopleCount: people.length,
      people: people.slice(0, MAX_PEOPLE),
    };
    onSnapshot(snapshot);
  }, [
    onSnapshot,
    room,
    peopleVersion,
    views,
    input.micEnabled,
    input.camEnabled,
    input.captionsOn,
    input.handRaised,
    input.view,
    input.layout,
    input.isHost,
    input.canEndForAll,
    input.recording,
    input.connected,
    input.hostIdentity,
    input.raisedHands,
  ]);
}
