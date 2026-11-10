'use client';

import * as React from 'react';
import { RoomEvent, Track, type Participant, type Room, type TrackPublication } from 'livekit-client';
import type { PresenceKind } from '@/lib/livedoc/presence';
import { isRecorderParticipant } from '@/lib/recorderParticipant';
import type { RecordingState } from '@/lib/recordingControls';

/**
 * useLivedocPresence — LiveDoc 全量录制期间，把入会、离会、麦克风和摄像头开关记下来。
 * 每人上报自己和自己看到的变化；服务端丢掉与上一条相同的状态。录制机器人不记。
 */

interface PresenceReport {
  identity: string;
  name: string;
  kind: PresenceKind;
  on: boolean;
}

function personName(participant: Participant): string {
  return participant.name || participant.identity;
}

function deviceOn(participant: Participant, source: Track.Source): boolean {
  const publication = participant.getTrackPublication(source);
  return !!publication && !publication.isMuted;
}

export function useLivedocPresence(
  room: Room,
  state: RecordingState,
  roomName: string,
  token: string,
): void {
  const recording = state.active && state.option === 'livedoc_full';
  const tokenRef = React.useRef(token);
  tokenRef.current = token;
  const roomNameRef = React.useRef(roomName);
  roomNameRef.current = roomName;
  const recordingRef = React.useRef(recording);
  recordingRef.current = recording;

  React.useEffect(() => {
    if (!recording) return;
    const pending = new Map<string, PresenceReport>();
    let timer = 0;

    const flush = () => {
      const events = [...pending.values()];
      pending.clear();
      const bearer = tokenRef.current;
      if (!events.length || !bearer) return;
      const name = roomNameRef.current;
      void fetch(`/api/meetings/${encodeURIComponent(name)}/presence`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      }).catch(() => undefined);
    };

    const enqueue = (report: PresenceReport) => {
      if (!recordingRef.current) return;
      const participant = report.identity === room.localParticipant.identity
        ? room.localParticipant
        : room.remoteParticipants.get(report.identity);
      if (participant && isRecorderParticipant(participant)) return;
      pending.set(`${report.identity}:${report.kind}`, report);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => flush(), 300);
    };

    const reportPerson = (participant: Participant, present: boolean) => {
      if (isRecorderParticipant(participant)) return;
      const name = personName(participant);
      enqueue({ identity: participant.identity, name, kind: 'room', on: present });
      if (!present) return;
      enqueue({ identity: participant.identity, name, kind: 'mic', on: deviceOn(participant, Track.Source.Microphone) });
      enqueue({ identity: participant.identity, name, kind: 'cam', on: deviceOn(participant, Track.Source.Camera) });
    };

    const onMedia = (publication: TrackPublication, participant: Participant) => {
      const kind = publication.source === Track.Source.Microphone
        ? 'mic'
        : publication.source === Track.Source.Camera
          ? 'cam'
          : null;
      if (!kind) return;
      enqueue({
        identity: participant.identity,
        name: personName(participant),
        kind,
        on: publication.track !== undefined && !publication.isMuted,
      });
    };

    reportPerson(room.localParticipant, true);
    for (const participant of room.remoteParticipants.values()) reportPerson(participant, true);

    const onJoin = (participant: Participant) => reportPerson(participant, true);
    const onLeave = (participant: Participant) => reportPerson(participant, false);
    const onGone = (publication: TrackPublication, participant: Participant) => {
      const kind = publication.source === Track.Source.Microphone
        ? 'mic'
        : publication.source === Track.Source.Camera
          ? 'cam'
          : null;
      if (!kind) return;
      enqueue({ identity: participant.identity, name: personName(participant), kind, on: false });
    };

    room.on(RoomEvent.ParticipantConnected, onJoin);
    room.on(RoomEvent.ParticipantDisconnected, onLeave);
    room.on(RoomEvent.TrackPublished, onMedia);
    room.on(RoomEvent.TrackUnpublished, onGone);
    room.on(RoomEvent.TrackMuted, onMedia);
    room.on(RoomEvent.TrackUnmuted, onMedia);
    room.on(RoomEvent.LocalTrackPublished, onMedia);
    room.on(RoomEvent.LocalTrackUnpublished, onGone);

    return () => {
      window.clearTimeout(timer);
      flush();
      room.off(RoomEvent.ParticipantConnected, onJoin);
      room.off(RoomEvent.ParticipantDisconnected, onLeave);
      room.off(RoomEvent.TrackPublished, onMedia);
      room.off(RoomEvent.TrackUnpublished, onGone);
      room.off(RoomEvent.TrackMuted, onMedia);
      room.off(RoomEvent.TrackUnmuted, onMedia);
      room.off(RoomEvent.LocalTrackPublished, onMedia);
      room.off(RoomEvent.LocalTrackUnpublished, onGone);
    };
  }, [recording, room]);
}
