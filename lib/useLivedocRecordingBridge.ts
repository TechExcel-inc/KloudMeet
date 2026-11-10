'use client';

import React from 'react';
import type { Room } from 'livekit-client';
import { getLiveDocIframe, postToLiveDocIframe } from './chatProtocol';
import { parseKloudMemberIdFromIdentity } from './meetingOwner';
import type { RecordingState } from './recordingControls';

/**
 * LiveDoc Full Recording: tells this page's LiveDoc plugin when recording starts and stops.
 * The page that started it also "announces" (the plugin then records the view mode and the open
 * document and page, so the replay knows what was on stage from the first second).
 * A plugin that loads later (late joiner, LiveDoc opened later) is told again once it is ready.
 *
 * While recording, it also forwards:
 * - Kloud-ViewMode when screen share starts or stops (actionType 9 in Kloud)
 * - Kloud-Speaking when the active speaker changes (actionType 213 in Kloud)
 */
export function useLivedocRecordingBridge({
  state,
  startedHereRef,
  screenShareOn,
  room,
}: {
  state: RecordingState;
  startedHereRef: React.MutableRefObject<boolean>;
  screenShareOn: boolean;
  room: Room;
}) {
  const recording = state.active && state.option === 'livedoc_full';
  const recordingId = state.livedocRecordingId ?? 0;
  const postedRef = React.useRef(false);
  const screenShareOnRef = React.useRef(screenShareOn);
  screenShareOnRef.current = screenShareOn;

  // --- Start / stop recording ---
  React.useEffect(() => {
    if (recording && !postedRef.current) {
      postedRef.current = true;
      screenShareOnRef.current = screenShareOn;
      postToLiveDocIframe({
        type: 'Kloud-RecordingStarted',
        recordingId,
        announce: startedHereRef.current,
        mode: screenShareOn ? 3 : 0,
      });
    } else if (!recording && postedRef.current) {
      postedRef.current = false;
      postToLiveDocIframe({ type: 'Kloud-RecordingStopped' });
    }
  }, [recording, recordingId, startedHereRef, screenShareOn]);

  // --- Late-join / reload: re-announce when the plugin finishes loading ---
  React.useEffect(() => {
    if (!recording) return;
    const onMessage = (event: MessageEvent) => {
      const iframe = getLiveDocIframe();
      if (!iframe?.contentWindow || event.source !== iframe.contentWindow) return;
      if ((event.data as { type?: unknown } | null)?.type !== 'onkloudloaded') return;
      postToLiveDocIframe({
        type: 'Kloud-RecordingStarted',
        recordingId,
        announce: false,
        mode: screenShareOnRef.current ? 3 : 0,
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [recording, recordingId]);

  // --- Screen share on/off mid-recording → Kloud-ViewMode (actionType 9) ---
  React.useEffect(() => {
    if (!recording || !postedRef.current) return;
    const prev = screenShareOnRef.current;
    if (prev === screenShareOn) return;
    screenShareOnRef.current = screenShareOn;
    const localMemberId = parseKloudMemberIdFromIdentity(room.localParticipant.identity);
    postToLiveDocIframe({
      type: 'Kloud-ViewMode',
      mode: screenShareOn ? 3 : 0,
      userId: localMemberId,
    });
  }, [screenShareOn, recording, room]);

  // --- Active speaker → Kloud-Speaking (actionType 213) ---
  React.useEffect(() => {
    if (!recording) return;
    let lastSpeaker: string | null = null;
    const SAMPLE_MS = 200;
    const timer = window.setInterval(() => {
      let topIdentity: string | null = null;
      let topLevel = 0;
      for (const p of room.remoteParticipants.values()) {
        if (!p.isSpeaking) continue;
        if (p.audioLevel > topLevel) {
          topLevel = p.audioLevel;
          topIdentity = p.identity;
        }
      }
      if (topIdentity !== lastSpeaker) {
        lastSpeaker = topIdentity;
        const memberId = topIdentity ? parseKloudMemberIdFromIdentity(topIdentity) : null;
        postToLiveDocIframe({
          type: 'Kloud-Speaking',
          userId: memberId,
          stat: topIdentity ? 1 : 0,
          duration: 0,
        });
      }
    }, SAMPLE_MS);
    return () => window.clearInterval(timer);
  }, [recording, room]);
}
