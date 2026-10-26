'use client';

/**
 * Development-only preview of caption reliability: the real CaptionSupervisor drives a fake
 * engine whose relay can be dropped or taken down, and the real overlay and toolbar show the
 * result (reconnecting, unavailable · Retry, the host's "captions down for …"). No meeting,
 * relay or microphone is used. Not served in production.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { KloudMeetToolbar, type ViewMode } from '@/lib/KloudMeetToolbar';
import { CaptionsOverlay } from '@/lib/RtasrHelper/CaptionsOverlay';
import { CaptionSupervisor, IDLE_CAPTION_STATUS, type CaptionStatus } from '@/lib/RtasrHelper/captionSupervisor';
import { CaptionEngineError, type CaptionFailure } from '@/lib/RtasrHelper/captionErrors';
import { peerStateOf, type PeerCaptionIssue } from '@/lib/RtasrHelper/captionPeers';
import type { CaptionEngine } from '@/lib/RtasrHelper/RtasrHelper';
import type { CaptionsInfo } from '@/lib/RtasrHelper/useCaptions';
import { IDLE_RECORDING_STATE } from '@/lib/recordingControls';
import { useToolbarIsMobile } from '@/lib/useToolbarIsMobile';

/** Connects after a short delay unless the "relay" is down or the failure is forced. */
class FakeEngine implements CaptionEngine {
  languageCode = 'en';
  OnDropped?: (err: CaptionEngineError) => void;
  relayUp = true;
  failure: CaptionFailure = 'network';
  Start() {
    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        if (this.relayUp) resolve();
        else reject(new CaptionEngineError(this.failure, 'simulated'));
      }, 400);
    });
  }
  Stop() {}
  drop() {
    this.OnDropped?.(new CaptionEngineError('network', 'simulated drop'));
  }
}

const noop = () => {};
const CAPTION: CaptionsInfo = {
  show: true,
  userName: 'Mina Sato',
  text: 'Let’s look at the onboarding numbers before we decide.',
  isPartial: false,
  lang: 'en',
  spokenLang: 'en',
};
const PEERS: PeerCaptionIssue[] = [
  { identity: 'a', name: 'Alex Chen' },
  { identity: 'b', name: 'Priya Nair' },
  { identity: 'c', name: 'Jonas Weber' },
];

export default function DevCaptionsPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const engine = React.useMemo(() => new FakeEngine(), []);
  const [status, setStatus] = React.useState<CaptionStatus>(IDLE_CAPTION_STATUS);
  const supervisor = React.useMemo(
    () => new CaptionSupervisor(engine, setStatus, { delays: [1000, 2000, 4000, 8000, 15000] }),
    [engine],
  );
  const [relayUp, setRelayUp] = React.useState(true);
  const [failure, setFailure] = React.useState<CaptionFailure>('network');
  const [peerCount, setPeerCount] = React.useState(0);
  const [showCaption, setShowCaption] = React.useState(true);
  const [view, setView] = React.useState<ViewMode>('webcam');
  const isToolbarMobile = useToolbarIsMobile();
  // Client only: LiveKit's device menu renders differently on the server.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    supervisor.start();
    // stop(), not dispose(): dev Strict Mode mounts twice and the drop hook must survive.
    return () => supervisor.stop();
  }, [supervisor]);

  const setRelay = (up: boolean) => {
    engine.relayUp = up;
    setRelayUp(up);
  };
  const pickFailure = (kind: CaptionFailure) => {
    engine.failure = kind;
    setFailure(kind);
  };

  const btn: React.CSSProperties = {
    height: 30,
    padding: '0 12px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.06)',
    color: '#eee',
    font: '600 12px Inter, system-ui, sans-serif',
    cursor: 'pointer',
  };

  if (!mounted) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0f1014', color: '#eee', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div
        data-dev-controls
        style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
      >
        <strong style={{ fontSize: 13, marginRight: 6 }}>
          Captions: {status.state}
          {status.failure ? ` (${status.failure})` : ''} · attempt {status.attempt}
        </strong>
        <button style={btn} onClick={() => engine.drop()}>Drop connection</button>
        <button style={btn} onClick={() => setRelay(!relayUp)}>{relayUp ? 'Take relay down' : 'Bring relay up'}</button>
        <select
          style={{ ...btn, paddingRight: 6 }}
          value={failure}
          onChange={(e) => pickFailure(e.target.value as CaptionFailure)}
        >
          {(['network', 'mic-denied', 'mic-missing', 'quota', 'unavailable'] as const).map((k) => (
            <option key={k} value={k}>Failure: {k}</option>
          ))}
        </select>
        <button style={btn} onClick={() => setPeerCount((n) => (n + 1) % 4)}>Host: peers down = {peerCount}</button>
        <button style={btn} onClick={() => setShowCaption((v) => !v)}>{showCaption ? 'Hide caption' : 'Show caption'}</button>
        <button style={btn} onClick={() => supervisor.stop()}>Mic off</button>
        <button style={btn} onClick={() => supervisor.start()}>Mic on</button>
      </div>

      <CaptionsOverlay
        captionsInfo={{ ...CAPTION, show: showCaption && status.state === 'live' }}
        bottomOffset={isToolbarMobile ? 110 : 96}
        readLanguage="en"
        roomLanguages={['en', 'ja']}
        onChangeLanguage={noop}
        status={status}
        onRetry={() => supervisor.retry()}
        peerIssues={PEERS.slice(0, peerCount)}
      />

      <KloudMeetToolbar
        activeView={view}
        onViewChange={setView}
        onExit={noop}
        micEnabled
        camEnabled={false}
        onToggleMic={noop}
        onToggleCam={noop}
        onShareScreen={noop}
        screenShareActive={false}
        canShareScreen
        isDrawingMode={false}
        onToggleDrawingMode={noop}
        isRemoteControlMode={false}
        onToggleRemoteControlMode={noop}
        hasScreenShare={false}
        isDesktop={false}
        canSwitchViews
        canShowOperatorMenus
        canToggleLiveDocAnnotation
        participantLiveDocAi
        chatOpen={false}
        onToggleChat={noop}
        attendeeOpen={false}
        onToggleAttendee={noop}
        canRecord
        isRecording={false}
        recordingState={IDLE_RECORDING_STATE}
        canChangeRecordingPolicy
        onRecordingAction={noop}
        onRecordingSettings={noop}
        handRaised={false}
        onToggleHand={noop}
        canToggleCaptions
        captionsEnabled
        captionsHealth={peerStateOf(status)}
        meetingTitle="Weekly product review"
      />
    </div>
  );
}
