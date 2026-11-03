'use client';

/**
 * Development-only preview of a meeting on a phone, through the real code: the phone gallery
 * (MobileVideoLayout), the screen-share stage (KloudVideoConference), the phone toolbar and the
 * top-left corner, with fake people whose camera and screen are drawn on canvases. Open it at the
 * browser pane's mobile size (it needs a phone user agent) and turn it sideways with a landscape
 * size. No meeting needed. Not served in production.
 *
 *   /dev/phone?n=5            – the gallery with 5 people (1–16)
 *   /dev/phone?share=1        – someone is sharing their screen
 *   &rec=0  no recording · &weak=1  a weak connection · &as=attendee  not the host
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { RoomContext } from '@livekit/components-react';
import { RemoteParticipant, RemoteTrackPublication, RemoteVideoTrack, Room, Track } from 'livekit-client';
import {
  ConnectionQuality as ProtoConnectionQuality,
  TrackInfo,
  TrackSource,
  TrackType,
} from '@livekit/protocol';
import { MobileVideoLayout } from '@/app/rooms/[roomName]/roomVideoLayouts';
import { KloudVideoConference } from '@/lib/KloudVideoConference';
import { KloudMeetToolbar, type ViewMode } from '@/lib/KloudMeetToolbar';
import { IDLE_RECORDING_STATE, type RecordingState } from '@/lib/recordingControls';
import { useIsLandscape } from '@/lib/useToolbarIsMobile';
import '@/styles/roomStage.css';

const NAMES = ['ying', 'tierenz', 'david', 'ztang', 'Xiao yu', 'guifu', 'Angela', 'Mark', 'Natalia', 'Shad', 'Kloud', 'Tom', 'Lily', 'Ken', 'Mia', 'Leo'];
/** Whose camera is on, and its shape: a phone held upright sends a portrait picture. */
const CAMERAS: Record<number, { w: number; h: number }> = { 0: { w: 720, h: 1280 }, 2: { w: 1280, h: 720 } };
const SHARER = 1;

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, frame: number) => void;

const drawCamera: Draw = (ctx, w, h, frame) => {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#d9d4cc');
  g.addColorStop(1, '#8a8f99');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // a face in the middle, to judge cropping
  const r = Math.min(w, h) * 0.22;
  ctx.fillStyle = '#c99b7a';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2 - r * 0.2 + Math.sin(frame / 4) * 4, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3d4a5c';
  ctx.fillRect(w / 2 - r * 1.6, h / 2 + r, r * 3.2, h);
};

const drawScreen: Draw = (ctx, w, h, frame) => {
  ctx.fillStyle = '#f4f6fa';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#5552d9';
  ctx.fillRect(0, 0, w, 64);
  ctx.fillStyle = '#fff';
  ctx.font = '600 30px system-ui';
  ctx.fillText('Q3 launch review — shared screen', 32, 43);
  ctx.font = '22px system-ui';
  for (let i = 0; i < 26; i++) {
    const y = 110 + i * 30;
    ctx.fillStyle = i % 2 ? '#ffffff' : '#eef0f6';
    ctx.fillRect(32, y - 22, w - 64, 30);
    ctx.fillStyle = '#1f2330';
    ctx.fillText(`Row ${i + 1}   Customer ${String.fromCharCode(65 + i)}   ${(i * 37) % 100}%   Owner ${NAMES[i % NAMES.length]}`, 44, y);
  }
  ctx.fillStyle = '#d93025';
  ctx.beginPath();
  ctx.arc(w - 60 - (frame % 40) * 4, h - 60, 14, 0, Math.PI * 2);
  ctx.fill();
};

function addFakeVideo(participant: RemoteParticipant, source: Track.Source, w: number, h: number, draw: Draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  let frame = 0;
  draw(ctx, w, h, frame);
  window.setInterval(() => draw(ctx, w, h, ++frame), 250);
  const mediaTrack = canvas.captureStream(4).getVideoTracks()[0];
  const sid = `TR_${participant.identity}_${source}`;
  const info = new TrackInfo({
    sid,
    name: source,
    type: TrackType.VIDEO,
    source: source === Track.Source.ScreenShare ? TrackSource.SCREEN_SHARE : TrackSource.CAMERA,
    width: w,
    height: h,
  });
  const publication = new RemoteTrackPublication(Track.Kind.Video, info, true);
  const track = new RemoteVideoTrack(mediaTrack, sid, undefined as unknown as RTCRtpReceiver);
  track.source = source;
  publication.setTrack(track);
  (participant as unknown as { addTrackPublication(p: RemoteTrackPublication): void }).addTrackPublication(publication);
}

function makeRoom(count: number, share: boolean, weak: boolean): Room {
  const room = new Room();
  const local = room.localParticipant;
  Object.defineProperty(local, 'identity', { value: 'kloud_1_ying', configurable: true });
  Object.defineProperty(local, 'name', { value: NAMES[0], configurable: true });
  for (let i = 1; i < count; i++) {
    const p = new RemoteParticipant(undefined as never, `PA_${i}`, `kloud_${i + 1}`, NAMES[i]);
    Object.defineProperty(p, 'isActive', { value: true, configurable: true });
    // The local camera can't be faked here, so the first remote person stands in for it
    const camera = CAMERAS[i === 1 ? 0 : i];
    if (camera) addFakeVideo(p, Track.Source.Camera, camera.w, camera.h, drawCamera);
    if (share && i === SHARER) addFakeVideo(p, Track.Source.ScreenShare, 1440, 900, drawScreen);
    if (i === 2) (p as unknown as { setIsSpeaking(s: boolean): void }).setIsSpeaking(true);
    room.remoteParticipants.set(p.identity, p);
  }
  if (weak) local.setConnectionQuality(ProtoConnectionQuality.POOR);
  return room;
}

export default function DevPhonePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [setup, setSetup] = React.useState<{ room: Room; share: boolean; host: boolean } | null>(null);
  const [rec, setRec] = React.useState<RecordingState>(IDLE_RECORDING_STATE);
  const [recording, setRecording] = React.useState(true);
  const [view, setView] = React.useState<ViewMode>('webcam');
  const [collapsed, setCollapsed] = React.useState(false);
  const noop = React.useCallback(() => {}, []);
  const isLandscape = useIsLandscape();
  const sharing = !!setup?.share;
  React.useEffect(() => {
    if (sharing) setCollapsed(isLandscape);
  }, [sharing, isLandscape]);

  React.useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const count = Math.max(1, Math.min(16, Number(query.get('n')) || 5));
    const share = query.get('share') === '1';
    setRecording(query.get('rec') !== '0');
    setView(share ? 'shareScreen' : 'webcam');
    setSetup({ room: makeRoom(Math.max(count, share ? 2 : 1), share, query.get('weak') === '1'), share, host: query.get('as') !== 'attendee' });
  }, []);

  if (!setup) return null;
  const { room, share, host } = setup;

  // Same markup as the meeting page (VideoConferenceComponent) on a phone
  return (
    <RoomContext.Provider value={room}>
      <div data-lk-theme="default" style={{ position: 'fixed', inset: 0 }}>
        <div className="lk-room-container kloud-mobile-meeting" style={{ position: 'relative', height: '100%' }}>
          <div
            className={`main-meeting-area${!share ? ' kloud-mobile-webcam-view' : ' kloud-mobile-share-view'}`}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: !share ? 'var(--kloud-mobile-toolbar-height)' : 0,
              overflow: 'hidden',
              display: 'flex',
              background: 'var(--km-stage)',
            }}
          >
            <div
              className={`sky-meet-video-wrapper ${share ? 'has-screen-share' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}
              style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', overflow: 'hidden' }}
            >
              {share ? <KloudVideoConference webcamLayoutMode="tile" /> : <MobileVideoLayout />}
              {share && (
                <button
                  type="button"
                  className="webcam-collapse-toggle"
                  onClick={() => setCollapsed((v) => !v)}
                  aria-expanded={!collapsed}
                  style={{
                    position: 'fixed',
                    top: 'max(60px, calc(env(safe-area-inset-top, 0px) + 48px), 7vh)',
                    left: 'max(10px, env(safe-area-inset-left, 0px))',
                    zIndex: 15000,
                    background: 'rgba(43, 44, 50, 0.96)',
                    color: 'var(--km-stage-text)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    width: '36px',
                    height: '50px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}>
                    {collapsed ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}
                  </svg>
                </button>
              )}
            </div>
          </div>
          <KloudMeetToolbar
            activeView={view}
            onViewChange={setView}
            onExit={noop}
            micEnabled={false}
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
            isDesktop={false}
            hasScreenShare={share}
            canSwitchViews
            canShowOperatorMenus={host}
            chatOpen={false}
            onToggleChat={noop}
            attendeeOpen={false}
            onToggleAttendee={noop}
            canRecord={host}
            isRecording={recording}
            recordingState={rec}
            canChangeRecordingPolicy={host}
            onRecordingAction={(action) => setRec((r) => ({ ...r, paused: action === 'pause' }))}
            onRecordingSettings={(patch) => setRec((r) => ({ ...r, ...patch }))}
            chatBadgeCount={2}
            meetingTitle="Weekly product review"
          />
        </div>
      </div>
    </RoomContext.Provider>
  );
}
