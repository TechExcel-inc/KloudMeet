import type { MutableRefObject } from 'react';
import type { TvLayout, TvPanel, TvPerson, TvView } from './protocol';

/**
 * Kloud Meet TV ⇄ the meeting (VideoConferenceComponent).
 *
 * On a TV the meeting runs the same component as on the web, so everything the host does
 * (views, LiveDoc, captions, mute, end meeting…) behaves the same. The TV hides the mouse
 * toolbar and drives the meeting through these actions instead; the meeting reports back a
 * snapshot for the TV's control bar and for the phone remote.
 */
export interface TvRoomActions {
  setMic(on: boolean): void;
  setCam(on: boolean): void;
  setCaptions(on: boolean): void;
  setHand(on: boolean): void;
  setLayout(mode: TvLayout): void;
  setView(view: TvView): void;
  leave(): void;
  endForAll(): void;
}

export interface TvRoomSnapshot {
  mic: boolean;
  cam: boolean;
  captions: boolean;
  hand: boolean;
  view: TvView;
  views: TvView[];
  layout: TvLayout;
  isHost: boolean;
  canEndForAll: boolean;
  recording: boolean;
  connected: boolean;
  peopleCount: number;
  people: TvPerson[];
}

export interface TvRoomHooks {
  actionsRef: MutableRefObject<TvRoomActions | null>;
  onSnapshot: (snapshot: TvRoomSnapshot) => void;
  /** Where "leave", "meeting ended" and "removed" go instead of the web home page */
  exitPath: string;
}

/** Panels the TV draws itself (the web toolbar's bubbles are mouse UI). */
export type { TvPanel };
