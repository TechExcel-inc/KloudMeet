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
    <div className="lk-room-container" style={{ position: 'relative', height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--km-stage, #17181c)' }}>
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
        meetingTitle="Weekly product review"
      />
      )}
    </div>
  );
}
