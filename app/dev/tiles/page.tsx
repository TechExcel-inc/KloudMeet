'use client';

/**
 * Development-only preview of the meeting gallery (camera-off tiles, balanced rows, per-person
 * colours) and the bottom toolbar, using the same classes, CSS and component as a real room,
 * so they can be checked without joining a meeting. Not served in production.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { applyBalancedGrid, applyTileHue } from '@/lib/tileLayout';
import { getInitials } from '@/lib/getInitials';
import { KloudMeetToolbar, type ViewMode } from '@/lib/KloudMeetToolbar';
import { MeetingTopBar } from '@/lib/MeetingTopBar';
import { SoloMeetingCard } from '@/lib/SoloMeetingCard';
import { RoomContext } from '@livekit/components-react';
import { Room } from 'livekit-client';

const NAMES = [
  'Kloud Solution', 'Tieren Zhou', 'Angela', 'Shad Z Daly', 'Mark Butteris', 'Natalia Kushner',
  'ying huang', 'Akira Sato', 'Min-jun Kim', 'Laura Chen', 'Diego Ruiz', 'Priya Nair',
  'Tom Becker', 'Sara Lind', 'Omar Haddad', 'Yuki Mori',
];
const COUNTS = [1, 2, 3, 4, 5, 7, 9, 12, 16];

/* The mic / camera chips a real room injects into each tile (VideoConferenceComponent.tsx,
   "Custom Microphone Indicator DOM Injection"), with the same classes, attributes and glyphs.
   Sample states: mic on, mic off, and one person muted by the host. */
const MIC_PATH =
  'M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z';
const CAM_PATH =
  'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z';
const Slash = () => <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />;

function TileChips({ index, host }: { index: number; host: boolean }) {
  const hostMuted = index === 2;
  const muted = hostMuted || index % 3 === 1;
  const interactive = host ? 'operator-interactive' : '';
  return (
    <>
      <div
        className={`kloud-custom-mic-indicator${hostMuted ? ' kloud-custom-mic--force-muted' : ''} ${interactive}`}
        data-kloud-muted={muted ? 'true' : 'false'}
        data-kloud-host-restricted={hostMuted ? 'true' : 'false'}
        data-kloud-force-muted="false"
        title={host ? (hostMuted ? 'Cancel disable (does not turn on mic)' : 'Disable microphone') : undefined}
      >
        <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
          <path d={MIC_PATH} />
          {muted && <Slash />}
        </svg>
      </div>
      <div
        className={`kloud-custom-cam-indicator ${interactive}`}
        data-kloud-video-disabled="true"
        data-kloud-host-restricted="false"
        title={host ? 'Disable camera' : undefined}
      >
        <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
          <path d={CAM_PATH} />
          <Slash />
        </svg>
      </div>
    </>
  );
}

/* The room's chip styles live in VideoConferenceComponent's inline stylesheet; this is the
   subset the grid uses, so the preview looks like a meeting. */
const CHIP_CSS = `
.km-dev-tiles .lk-participant-metadata-item { display: inline-flex !important; align-items: center !important; gap: 6px !important; }
.km-dev-tiles .kloud-custom-mic-indicator,
.km-dev-tiles .kloud-custom-cam-indicator {
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: 28px; height: 28px; padding: 3px; box-sizing: border-box; border-radius: 50%;
  background: rgba(32, 33, 36, 0.75); backdrop-filter: blur(4px);
}
.km-dev-tiles .operator-interactive { cursor: pointer; }
.km-dev-tiles .operator-interactive:hover { background: rgba(60, 64, 67, 0.92); }
.km-dev-tiles .kloud-custom-mic-indicator[data-kloud-muted="false"] { color: #22c55e; }
.km-dev-tiles .kloud-custom-mic-indicator[data-kloud-muted="true"],
.km-dev-tiles .kloud-custom-cam-indicator[data-kloud-video-disabled="true"] { color: rgba(255, 255, 255, 0.75); }
.km-dev-tiles .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] {
  color: #ff2020; filter: drop-shadow(0 0 5px rgba(255, 32, 32, 0.8));
}
`;

export default function DevTilesPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [count, setCount] = React.useState(7);
  const [view, setView] = React.useState<ViewMode>('webcam');
  const [host, setHost] = React.useState(true);
  const [mic, setMic] = React.useState(false);
  const [cam, setCam] = React.useState(false);
  const [hand, setHand] = React.useState(false);
  const noop = React.useCallback(() => {}, []);
  // The toolbar probes media devices, so (as in a real room) it only renders in the browser.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  // Never connected: only gives the solo card a room with no one else in it.
  const [devRoom] = React.useState(() => new Room());

  React.useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    applyBalancedGrid(grid);
    grid.querySelectorAll<HTMLElement>(':scope > .lk-participant-tile').forEach((tile, i) => {
      applyTileHue(tile, NAMES[i]);
    });
  }, [count]);

  return (
    <div className="lk-room-container km-dev-tiles" style={{ position: 'relative', height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--km-stage, #17181c)' }}>
      <style>{CHIP_CSS}</style>
      <div style={{ display: 'flex', gap: 8, padding: '12px 16px 0' }}>
        {COUNTS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setCount(n)}
            aria-pressed={n === count}
            style={{ height: 32, padding: '0 12px', borderRadius: 8, border: 0, cursor: 'pointer', background: n === count ? '#7c79ff' : '#2e3036', color: '#fff' }}
          >
            {n} people
          </button>
        ))}
        <button
          type="button"
          onClick={() => setHost((v) => !v)}
          style={{ marginLeft: 'auto', height: 32, padding: '0 12px', borderRadius: 8, border: 0, cursor: 'pointer', background: '#2e3036', color: '#fff' }}
        >
          Viewing as: {host ? 'host' : 'attendee'}
        </button>
      </div>
      <div style={{ position: 'relative', height: 56, flex: 'none' }}>
        <MeetingTopBar
          meetingTitle="Weekly product review"
          modeLabel={view === 'liveDoc' ? 'LiveDoc' : view === 'shareScreen' ? 'Screen share' : 'Video · Grid'}
          isRecording={host}
          recordingLabel="Recording"
          captionsOn
          captionsLabel="Captions on"
        />
      </div>
      <div className="lk-grid-layout-wrapper" style={{ flex: 1, minHeight: 0, height: 0, paddingBottom: 88 }}>
        <div className="lk-grid-layout" ref={gridRef} key={count}>
          {NAMES.slice(0, count).map((name, i) => (
            <div
              key={name}
              className="lk-participant-tile"
              data-lk-source="camera"
              data-lk-video-muted="true"
              data-lk-speaking={i === 0 ? 'true' : 'false'}
            >
              <div className="lk-participant-placeholder" data-lk-name={name} data-lk-initials={getInitials(name)} />
              <div className="lk-participant-metadata">
                <div className="lk-participant-metadata-item">
                  <TileChips index={i} host={host} />
                  <span className="lk-participant-name">{name}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {mounted && count === 1 && (
        <RoomContext.Provider value={devRoom}>
          <SoloMeetingCard isDesktop={false} canOpenLiveDoc={host} onOpenLiveDoc={() => setView('liveDoc')} />
        </RoomContext.Provider>
      )}
      {mounted && (
      <KloudMeetToolbar
        activeView={view}
        onViewChange={setView}
        onExit={noop}
        micEnabled={mic}
        camEnabled={cam}
        onToggleMic={() => setMic((v) => !v)}
        onToggleCam={() => setCam((v) => !v)}
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
        canShowOperatorMenus={host}
        canToggleLiveDocAnnotation={host}
        participantLiveDocAi
        chatOpen={false}
        onToggleChat={noop}
        attendeeOpen={false}
        onToggleAttendee={noop}
        canRecord={host}
        isRecording={host}
        handRaised={hand}
        onToggleHand={() => setHand((v) => !v)}
        raisedHandCount={1}
        chatBadgeCount={2}
        canDocumentPip
        canToggleCaptions={host}
        captionsEnabled
        meetingTitle="Weekly product review"
      />
      )}
    </div>
  );
}
