'use client';

import React from 'react';
import { getLiveDocIframe, postToLiveDocIframe } from './chatProtocol';
import type { RecordingState } from './recordingControls';

/**
 * LiveDoc Full Recording: tells this page's LiveDoc plugin when recording starts and stops.
 * The page that started it also "announces" (the plugin then records the view mode and the open
 * document and page, so the replay knows what was on stage from the first second).
 * A plugin that loads later (late joiner, LiveDoc opened later) is told again once it is ready.
 */
export function useLivedocRecordingBridge({
  state,
  startedHereRef,
  screenShareOn,
}: {
  state: RecordingState;
  startedHereRef: React.MutableRefObject<boolean>;
  screenShareOn: boolean;
}) {
  const recording = state.active && state.option === 'livedoc_full';
  const recordingId = state.livedocRecordingId ?? 0;
  const postedRef = React.useRef(false);
  const screenShareOnRef = React.useRef(screenShareOn);
  screenShareOnRef.current = screenShareOn;

  React.useEffect(() => {
    if (recording && !postedRef.current) {
      postedRef.current = true;
      postToLiveDocIframe({
        type: 'Kloud-RecordingStarted',
        recordingId,
        announce: startedHereRef.current,
        mode: screenShareOnRef.current ? 3 : 0,
      });
    } else if (!recording && postedRef.current) {
      postedRef.current = false;
      postToLiveDocIframe({ type: 'Kloud-RecordingStopped' });
    }
  }, [recording, recordingId, startedHereRef]);

  React.useEffect(() => {
    if (!recording) return;
    const onMessage = (event: MessageEvent) => {
      const iframe = getLiveDocIframe();
      if (!iframe?.contentWindow || event.source !== iframe.contentWindow) return;
      if ((event.data as { type?: unknown } | null)?.type !== 'onkloudloaded') return;
      postToLiveDocIframe({ type: 'Kloud-RecordingStarted', recordingId, announce: false, mode: 0 });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [recording, recordingId]);
}
