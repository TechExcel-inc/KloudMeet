'use client';

/**
 * Development-only preview of camera backgrounds. A fake camera — a photo drawn on a canvas with
 * a little movement — stands in for getUserMedia, so the real pre-join page and the real
 * processor (model, wasm, blur, scenes) run without a webcam. Not served in production.
 *
 *   ?case=prejoin      the pre-join page: button bottom-right of the preview, dialog in page tone
 *   ?case=meeting      the meeting dialog (dark) driving the processor on the fake camera
 *   ?case=broken       as meeting, but the model can't be fetched: the camera must keep going
 *   ?case=toolbar      the bar, whose camera menu ends with the Background row
 *   ?case=off | unsupported | failed   the dialog's other states, without processing
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { createLocalVideoTrack, type LocalVideoTrack } from 'livekit-client';
import { KloudPreJoin } from '@/lib/KloudPreJoin';
import { KloudMeetToolbar, type ViewMode } from '@/lib/KloudMeetToolbar';
import { VideoBackgroundDialog } from '@/lib/VideoBackgroundDialog';
import { usePreviewVideoBackground } from '@/lib/useVideoBackground';
import { useI18n } from '@/lib/i18n';
import { IDLE_RECORDING_STATE } from '@/lib/recordingControls';
import prejoinStyles from '@/styles/PreJoin.module.css';

const noop = () => {};

/** Replaces the browser's camera with a canvas, once per page. */
function installFakeCamera() {
  const w = window as unknown as { __kmFakeCamera?: boolean };
  if (w.__kmFakeCamera) return;
  w.__kmFakeCamera = true;
  const img = new Image();
  img.src = '/images/people/sarah-tile.jpg';
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;
  const start = performance.now();
  // A timer, not requestAnimationFrame: frames keep coming while the pane is in the background.
  setInterval(() => {
    const t = (performance.now() - start) / 1000;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, 1280, 720);
    if (!img.complete || !img.naturalWidth) return;
    const scale = Math.max(1280 / img.naturalWidth, 720 / img.naturalHeight) * 1.04;
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (1280 - dw) / 2 + Math.sin(t * 0.9) * 8, (720 - dh) / 2, dw, dh);
  }, 33);

  const media = navigator.mediaDevices;
  media.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const stream = new MediaStream();
    if (constraints?.video) stream.addTrack(canvas.captureStream(30).getVideoTracks()[0]);
    if (constraints?.audio) {
      const ac = new AudioContext();
      stream.addTrack(ac.createMediaStreamDestination().stream.getAudioTracks()[0]);
    }
    return stream;
  };
  media.enumerateDevices = async () =>
    [
      { deviceId: 'fake-camera', kind: 'videoinput', label: 'FaceTime HD Camera', groupId: 'a' },
      { deviceId: 'fake-camera-2', kind: 'videoinput', label: 'Logitech StreamCam', groupId: 'b' },
      { deviceId: 'fake-mic', kind: 'audioinput', label: 'MacBook Pro Microphone', groupId: 'a' },
      { deviceId: 'default', kind: 'audiooutput', label: 'MacBook Pro Speakers', groupId: 'a' },
    ].map((d) => ({ ...d, toJSON: () => d })) as MediaDeviceInfo[];
}

/** Makes the segmentation model unreachable, as a blocked network would. */
function breakModelDownload() {
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('selfie_segmenter')) return Promise.reject(new TypeError('Failed to fetch'));
    return original(input, init);
  };
}

function useFakeCameraTrack(enabled: boolean) {
  const [track, setTrack] = React.useState<LocalVideoTrack>();
  React.useEffect(() => {
    if (!enabled) return;
    let made: LocalVideoTrack | undefined;
    let cancelled = false;
    createLocalVideoTrack().then((t) => {
      if (cancelled) t.stop();
      else {
        setTrack((made = t));
        (window as unknown as { __vbTrack?: LocalVideoTrack }).__vbTrack = t;
      }
    });
    return () => {
      cancelled = true;
      made?.stop();
      setTrack(undefined);
    };
  }, [enabled]);
  return track;
}

function MeetingCase() {
  const { t } = useI18n();
  const [camOn, setCamOn] = React.useState(true);
  const [open, setOpen] = React.useState(true);
  const track = useFakeCameraTrack(camOn);
  const background = usePreviewVideoBackground(track);
  const tileRef = React.useRef<HTMLVideoElement | null>(null);

  React.useEffect(() => {
    const el = tileRef.current;
    if (!track || !el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#17181c', color: '#e8eaed', fontFamily: 'system-ui' }}>
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8, zIndex: 1 }}>
        <button onClick={() => setOpen(true)}>Open dialog</button>
        <button onClick={() => setCamOn((v) => !v)}>{camOn ? 'Camera off' : 'Camera on'}</button>
        <span data-status style={{ fontSize: 12 }}>status: {background.status} · {background.background}</span>
      </div>
      <div style={{ position: 'absolute', inset: '56px 24px 24px', borderRadius: 12, overflow: 'hidden', background: '#2e3036' }}>
        {track && (
          <video ref={tileRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
        )}
      </div>
      <VideoBackgroundDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        tone="stage"
        background={background.background}
        onChange={background.changeBackground}
        status={background.status}
        supported={background.supported}
        onRetry={background.retry}
        track={track}
        onTurnOnCamera={() => setCamOn(true)}
        hint={t('background.hintMeeting')}
      />
    </div>
  );
}

function StaticDialogCase({ kind }: { kind: 'off' | 'unsupported' | 'failed' }) {
  const { t } = useI18n();
  const track = useFakeCameraTrack(kind !== 'off');
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#17181c' }}>
      <VideoBackgroundDialog
        isOpen
        onClose={noop}
        tone="stage"
        background={kind === 'unsupported' ? 'none' : 'forest'}
        onChange={noop}
        status={kind === 'failed' ? 'failed' : 'idle'}
        supported={kind !== 'unsupported'}
        onRetry={noop}
        track={track}
        onTurnOnCamera={noop}
        hint={t('background.hintMeeting')}
      />
    </div>
  );
}

function ToolbarCase() {
  const [view, setView] = React.useState<ViewMode>('webcam');
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#17181c' }}>
      <KloudMeetToolbar
        activeView={view}
        onViewChange={setView}
        onExit={noop}
        micEnabled
        camEnabled
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
        meetingTitle="Weekly product review"
      />
    </div>
  );
}

export default function DevBackgroundPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [kind, setKind] = React.useState<string | null>(null);
  React.useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('case') ?? 'meeting';
    installFakeCamera();
    if (value === 'broken') breakModelDownload();
    setKind(value);
  }, []);

  if (!kind) return null;
  if (kind === 'prejoin') {
    return (
      <div className={prejoinStyles.page}>
        <KloudPreJoin
          defaults={{ username: 'Sarah Chen', videoEnabled: true, audioEnabled: false }}
          onSubmit={noop}
          joinLabel="Join now"
          userLabel="Your name"
          micLabel="Microphone"
          camLabel="Camera"
          title="Ready to join?"
          subtitle="Weekly product review"
        />
      </div>
    );
  }
  if (kind === 'toolbar') return <ToolbarCase />;
  if (kind === 'off' || kind === 'unsupported' || kind === 'failed') return <StaticDialogCase kind={kind} />;
  return <MeetingCase />;
}
