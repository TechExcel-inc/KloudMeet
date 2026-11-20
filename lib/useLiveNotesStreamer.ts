'use client';

import React from 'react';
import { RoomEvent, type Room } from 'livekit-client';
import { NOTES_FINISH_TOPIC } from '@/lib/liveNotes';
import { floatToPcm16, NOTES_SAMPLE_RATE, NotesStream, resampleMono } from '@/lib/liveNotesStreamer';
import { relayUrl } from '@/lib/RtasrHelper/FunAsrHelper';

/** How often the set of audio tracks is checked again, besides on room events */
const SYNC_MS = 2000;

/**
 * Mixes every remote audio track of the room into one mono 16 kHz stream and hands it over
 * frame by frame. Nothing is played or stored: the frames only go to `onFrame`.
 */
export class RoomAudioTap {
  private context: AudioContext | null = null;
  private mixer: GainNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private readonly sources = new Map<string, MediaStreamAudioSourceNode>();
  /**
   * A muted audio element per tapped track. Chrome delivers a remote WebRTC track to Web Audio
   * only while the track is also playing in a media element; without one the tap hears silence.
   * The meeting page's own audio renderer normally provides that, but the tap must not depend
   * on it. Muted, so nothing is heard twice.
   */
  private readonly sinks = new Map<string, HTMLAudioElement>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly room: Pick<Room, 'remoteParticipants' | 'on' | 'off'>,
    private readonly onFrame: (pcm: ArrayBuffer, atMs: number) => void,
  ) {}

  start(): void {
    if (this.context) return;
    try {
      this.context = new AudioContext({ sampleRate: NOTES_SAMPLE_RATE });
    } catch (err) {
      console.warn('[liveNotes] AudioContext sample rate fallback', err);
      this.context = new AudioContext();
    }
    const context = this.context;
    const rate = context.sampleRate;
    this.mixer = context.createGain();
    this.processor = context.createScriptProcessor(4096, 1, 1);
    this.mixer.connect(this.processor);
    // A script processor only runs while it is connected; it writes no output, so this is silent.
    this.processor.connect(context.destination);
    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const frameMs = (input.length / rate) * 1000;
      this.onFrame(floatToPcm16(resampleMono(input, rate, NOTES_SAMPLE_RATE)), Date.now() - frameMs);
    };
    this.room.on(RoomEvent.TrackSubscribed, this.sync);
    this.room.on(RoomEvent.TrackUnsubscribed, this.sync);
    this.room.on(RoomEvent.ParticipantDisconnected, this.sync);
    this.timer = setInterval(this.sync, SYNC_MS);
    this.sync();
  }

  stop(): void {
    this.room.off(RoomEvent.TrackSubscribed, this.sync);
    this.room.off(RoomEvent.TrackUnsubscribed, this.sync);
    this.room.off(RoomEvent.ParticipantDisconnected, this.sync);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const source of this.sources.values()) source.disconnect();
    this.sources.clear();
    for (const id of [...this.sinks.keys()]) this.release(id);
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
    }
    this.mixer?.disconnect();
    this.processor = null;
    this.mixer = null;
    const context = this.context;
    this.context = null;
    void context?.close().catch((err: unknown) => console.warn('[liveNotes] audio context close', err));
  }

  /** Connects the audio tracks now in the room and lets go of the ones that left. */
  private readonly sync = (): void => {
    const context = this.context;
    const mixer = this.mixer;
    if (!context || !mixer) return;
    if (context.state === 'suspended') {
      void context.resume().catch((err: unknown) => console.warn('[liveNotes] audio context resume', err));
    }
    const live = new Map<string, MediaStreamTrack>();
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        const track = publication.track?.mediaStreamTrack;
        if (track && track.readyState === 'live') live.set(track.id, track);
      }
    }
    for (const [id, source] of this.sources) {
      if (live.has(id)) continue;
      source.disconnect();
      this.sources.delete(id);
      this.release(id);
    }
    for (const [id, track] of live) {
      if (this.sources.has(id)) continue;
      try {
        const media = new MediaStream([track]);
        const sink = new Audio();
        sink.muted = true;
        sink.srcObject = media;
        void sink.play().catch((err: unknown) => console.warn('[liveNotes] audio sink did not start', err));
        this.sinks.set(id, sink);
        const source = context.createMediaStreamSource(media);
        source.connect(mixer);
        this.sources.set(id, source);
      } catch (err) {
        console.warn('[liveNotes] audio track could not be tapped', err);
      }
    }
  };

  private release(id: string): void {
    const sink = this.sinks.get(id);
    if (!sink) return;
    sink.pause();
    sink.srcObject = null;
    this.sinks.delete(id);
  }
}

/**
 * Recorder bot only, AI Taking Notes: sends the room's audio to the recognizer while the meeting
 * runs and posts back each sentence, so no audio file is needed (see lib/liveNotes.ts).
 *
 * Runs only while `token` is set. The server decides whether this recording takes live notes:
 * for a recording that keeps a media file the stream turns itself off on its first request.
 *
 * @param token   Recording.activityToken from the page URL, or null to do nothing
 * @param paused  notes are paused: nothing is sent to the recognizer
 */
export function useLiveNotesStreamer(room: Room, token: string | null, paused: boolean): void {
  const streamRef = React.useRef<NotesStream | null>(null);
  const pausedRef = React.useRef(paused);
  pausedRef.current = paused;

  React.useEffect(() => {
    if (!token) return;
    // The room's audio is tapped only once the server says this recording takes live notes; a
    // recording that keeps a media file is left exactly as it was.
    const tap: RoomAudioTap = new RoomAudioTap(room, (pcm, atMs) => stream.pushAudio(pcm, atMs));
    const stream: NotesStream = new NotesStream({
      token,
      relayUrl,
      onLive: (live) => (live ? tap.start() : tap.stop()),
    });
    streamRef.current = stream;
    stream.setPaused(pausedRef.current);
    stream.start();

    // The server says the session is ending: hand in the sentence being spoken.
    const onData = (_payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic === NOTES_FINISH_TOPIC) void stream.finish();
    };
    const onLeave = () => stream.stop();
    room.on(RoomEvent.DataReceived, onData);
    window.addEventListener('pagehide', onLeave);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      window.removeEventListener('pagehide', onLeave);
      tap.stop();
      stream.stop();
      streamRef.current = null;
    };
  }, [room, token]);

  React.useEffect(() => {
    streamRef.current?.setPaused(paused);
  }, [paused]);
}
