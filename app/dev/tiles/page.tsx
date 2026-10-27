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
import { DEFAULT_GALLERY_PREFS, type GalleryPrefs } from '@/lib/galleryPrefs';
import { IDLE_RECORDING_STATE, type RecordingState } from '@/lib/recordingControls';
import { DesignStage } from '@/lib/DesignStage';
import { DesignLinkDialog } from '@/lib/DesignLinkDialog';
import { parseDesignLink, type DesignLink } from '@/lib/designLink';
import { checkDesignLinkEmbed, rememberDesignLink } from '@/lib/designLinkClient';
import { parseDesignSyncMessage } from '@/lib/designSync';
import { useDesignSync, type DesignSyncTransport } from '@/lib/useDesignSync';

/* Design mode between preview windows: the host window drives, attendee windows follow,
   over a BroadcastChannel instead of a meeting's data channel. */
const DEV_HOST_IDENTITY = 'dev-host';
function useDevDesignTransport(identity: string, name: string): DesignSyncTransport | null {
  return React.useMemo(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
    const channel = new BroadcastChannel('km-dev-design');
    // kmDesignOffline(true) in the console drops messages both ways like a lost connection;
    // kmDesignOffline(false) comes back and fires onConnected, as a meeting reconnect does.
    let offline = false;
    const onConnected = new Set<() => void>();
    (window as unknown as { kmDesignOffline?: (off: boolean) => void }).kmDesignOffline = (off) => {
      offline = off;
      if (!off) onConnected.forEach((handler) => handler());
    };
    return {
      send: (msg, opts) => {
        if (!offline) channel.postMessage({ from: identity, name, msg, ...(opts?.to ? { to: opts.to } : {}) });
      },
      subscribe: (handler) => {
        const onMessage = (event: MessageEvent) => {
          if (offline || (event.data?.to && event.data.to !== identity)) return;
          const msg = parseDesignSyncMessage(event.data?.msg);
          if (msg) handler(msg, { identity: String(event.data.from), name: String(event.data.name || '') });
        };
        channel.addEventListener('message', onMessage);
        return () => channel.removeEventListener('message', onMessage);
      },
      onConnected: (handler) => {
        onConnected.add(handler);
        return () => {
          onConnected.delete(handler);
        };
      },
    };
  }, [identity, name]);
}

const BASE_NAMES = [
  'Kloud Solution', 'Tieren Zhou', 'Angela', 'Shad Z Daly', 'Mark Butteris', 'Natalia Kushner',
  'ying huang', 'Akira Sato', 'Min-jun Kim', 'Laura Chen', 'Diego Ruiz', 'Priya Nair',
  'Tom Becker', 'Sara Lind', 'Omar Haddad', 'Yuki Mori',
];
const NAMES = Array.from({ length: 40 }, (_, i) =>
  i < BASE_NAMES.length ? BASE_NAMES[i] : `${BASE_NAMES[i % BASE_NAMES.length].split(' ')[0]} ${i + 1}`,
);
const COUNTS = [1, 2, 3, 4, 5, 7, 9, 12, 16, 25, 40];
/* Like LiveKit's GridLayout on a wide stage: 25 tiles a page, then arrows and "n of m" */
const PAGE_SIZE = 25;

/* The mic / camera chips a real room injects into each tile (VideoConferenceComponent.tsx,
   "Custom Microphone Indicator DOM Injection"), with the same classes, attributes and glyphs.
   Sample states: speaking (tile 1), mic off, muted by the host (tile 3), mic on but silent,
   camera disabled by the host (tile 5). */
const MIC_PATH =
  'M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z';
const CAM_PATH =
  'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z';
const Slash = () => <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />;

function TileChips({ index, host }: { index: number; host: boolean }) {
  const hostMuted = index === 2;
  const muted = hostMuted || index % 3 === 1;
  const camDisabledByHost = index === 4;
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
        className={`kloud-custom-cam-indicator${camDisabledByHost ? ' kloud-custom-cam--force-disabled' : ''} ${interactive}`}
        data-kloud-video-disabled="true"
        data-kloud-host-restricted={camDisabledByHost ? 'true' : 'false'}
        title={host ? (camDisabledByHost ? 'Cancel disable (does not turn on camera)' : 'Disable camera') : undefined}
      >
        <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
          <path d={CAM_PATH} />
          <Slash />
        </svg>
      </div>
    </>
  );
}

/* The room's tile chrome lives in VideoConferenceComponent's inline stylesheet ("2026-10
   redesign — Meet-style tile chrome"); this mirrors the part the grid uses so the preview looks
   like a meeting: name bottom-left, status chips top-right. */
const CHIP_CSS = `
.km-dev-tiles .lk-grid-layout-wrapper .lk-participant-tile > .lk-participant-metadata {
  top: 0; left: 0; right: 0; bottom: 0; padding: 10px 52px 10px 14px; align-items: flex-end; pointer-events: none; z-index: 3;
}
.km-dev-tiles .lk-participant-metadata-item { display: inline-flex !important; align-items: center !important; gap: 6px !important; position: static !important; }
.km-dev-tiles .kloud-custom-mic-indicator,
.km-dev-tiles .kloud-custom-cam-indicator {
  position: absolute !important; top: 10px; right: 10px;
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 7px; box-sizing: border-box; border-radius: 50%;
  background: rgba(32, 33, 36, 0.75); backdrop-filter: blur(4px); pointer-events: auto;
}
.km-dev-tiles .kloud-custom-cam-indicator { right: 46px; }
.km-dev-tiles .operator-interactive { cursor: pointer; }
.km-dev-tiles .operator-interactive:hover { background: rgba(60, 64, 67, 0.92); }
.km-dev-tiles .kloud-custom-mic-indicator[data-kloud-muted="false"] { color: #22c55e; }
.km-dev-tiles .kloud-custom-mic-indicator[data-kloud-muted="true"] { color: rgba(255, 255, 255, 0.85); }
.km-dev-tiles .kloud-custom-mic-indicator[data-kloud-host-restricted="true"],
.km-dev-tiles .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] {
  color: #ff2020; filter: drop-shadow(0 0 5px rgba(255, 32, 32, 0.8));
}
`;

export default function DevTilesPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [count, setCount] = React.useState(7);
  const [page, setPage] = React.useState(1);
  const [gallery, setGallery] = React.useState<GalleryPrefs>(DEFAULT_GALLERY_PREFS);
  // Recording panel preview: a running recording whose controls change local state only
  const [rec, setRec] = React.useState<RecordingState>({ ...IDLE_RECORDING_STATE, active: true });
  const perPage = gallery.tilesPerPage === 'auto' ? PAGE_SIZE : gallery.tilesPerPage;
  const pageCount = Math.max(1, Math.ceil(count / perPage));
  const pageStart = (Math.min(page, pageCount) - 1) * perPage;
  const shown = NAMES.slice(0, count).slice(pageStart, pageStart + perPage);
  const [view, setView] = React.useState<ViewMode>('webcam');
  const [host, setHost] = React.useState(true);
  const [mic, setMic] = React.useState(false);
  const [cam, setCam] = React.useState(false);
  const [hand, setHand] = React.useState(false);
  // ?share=presenter|viewer previews a screen share in progress; ?desktop=1 as the desktop app.
  const [share, setShare] = React.useState<'presenter' | 'viewer' | null>(null);
  const [desktop, setDesktop] = React.useState(false);
  const [drawing, setDrawing] = React.useState(false);
  const [control, setControl] = React.useState(false);
  const noop = React.useCallback(() => {}, []);
  // The toolbar probes media devices, so (as in a real room) it only renders in the browser.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  // Design mode preview: ?design=<link> opens straight on the stage, ?dialog=1 opens "Show a
  // link", ?as=attendee views as an attendee following the host window (open both side by side).
  const [designLink, setDesignLink] = React.useState<DesignLink | null>(null);
  const [designDialog, setDesignDialog] = React.useState(false);
  /** ?blocked=1 previews the card a site that refuses framing gets (normally set by the embed check) */
  const [designBlocked, setDesignBlocked] = React.useState(false);
  React.useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('as') === 'attendee') setHost(false);
    if (query.get('dialog') === '1') setDesignDialog(true);
    if (query.get('blocked') === '1') setDesignBlocked(true);
    const shareQuery = query.get('share');
    if (shareQuery === 'presenter' || shareQuery === 'viewer') setShare(shareQuery);
    if (query.get('desktop') === '1') setDesktop(true);
    const preset = query.get('design');
    if (!preset) return;
    const parsed = parseDesignLink(preset, { appOrigin: window.location.origin, allowLocalHttp: true });
    if (parsed.ok) {
      setDesignLink(parsed.link);
      setView('design');
    }
  }, []);
  const devIdentity = React.useMemo(
    () => (host ? DEV_HOST_IDENTITY : `dev-attendee-${Math.random().toString(36).slice(2, 7)}`),
    [host],
  );
  const designTransport = useDevDesignTransport(devIdentity, host ? 'ying huang' : 'Attendee');
  const designSync = useDesignSync({
    transport: designTransport,
    active: view === 'design' && !!designLink,
    linkUrl: designLink?.url ?? null,
    isDriver: host,
    isAllowedSender: React.useCallback((identity: string) => identity === DEV_HOST_IDENTITY, []),
    localIdentity: devIdentity,
    localName: host ? 'ying huang' : 'Attendee',
  });
  const gridRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    applyBalancedGrid(grid);
    grid.querySelectorAll<HTMLElement>(':scope > .lk-participant-tile').forEach((tile, i) => {
      applyTileHue(tile, NAMES[pageStart + i]);
    });
    const resize = new ResizeObserver(() => applyBalancedGrid(grid));
    resize.observe(grid);
    return () => resize.disconnect();
  }, [count, pageStart, perPage]);

  return (
    <div className="lk-room-container km-dev-tiles" style={{ position: 'relative', height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--km-stage, #17181c)' }}>
      <style>{CHIP_CSS}</style>
      <div style={{ display: 'flex', gap: 8, padding: '12px 16px 0' }}>
        {COUNTS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => {
              setCount(n);
              setPage(1);
            }}
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
      {view === 'design' && designLink ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', paddingBottom: 88 }}>
          <DesignStage
            link={designLink}
            presenterName="ying huang"
            isDriver={host}
            canControl={host}
            sync={designSync}
            embedBlocked={designBlocked}
            onChangeLink={() => setDesignDialog(true)}
            onStop={() => {
              setDesignLink(null);
              setView('webcam');
            }}
          />
        </div>
      ) : (
      <div className="lk-grid-layout-wrapper" style={{ flex: 1, minHeight: 0, height: 0, paddingBottom: 88 }}>
        <div className="lk-grid-layout" ref={gridRef} key={`${count}-${pageStart}-${perPage}`} data-lk-pagination={pageCount > 1}>
          {shown.map((name, i) => (
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
                  <TileChips index={pageStart + i} host={host} />
                  <span className="lk-participant-name">{name}</span>
                </div>
              </div>
            </div>
          ))}
          {pageCount > 1 && (
            /* Same markup as LiveKit's: one right chevron, the first is rotated by LiveKit's CSS */
            <div className="lk-pagination-control">
              <button type="button" className="lk-button" onClick={() => setPage((p) => (p <= 1 ? pageCount : p - 1))} aria-label="Previous page">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
              </button>
              <span className="lk-pagination-count">{`${Math.min(page, pageCount)} of ${pageCount}`}</span>
              <button type="button" className="lk-button" onClick={() => setPage((p) => (p >= pageCount ? 1 : p + 1))} aria-label="Next page">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            </div>
          )}
        </div>
      </div>
      )}
      {designDialog && (
        <DesignLinkDialog
          currentUrl={designLink?.url}
          appOrigin={window.location.origin}
          checkEmbed={(url) => checkDesignLinkEmbed({ roomName: 'dev-preview', url })}
          onSubmit={(link, check) => {
            rememberDesignLink({ url: link.url, label: link.kind === 'figma' ? link.label : link.host, kind: link.kind });
            setDesignBlocked(check?.embed === 'blocked');
            setDesignLink(link);
            setDesignDialog(false);
            setView('design');
          }}
          onClose={() => setDesignDialog(false)}
        />
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
        screenShareActive={share === 'presenter'}
        canShareScreen
        isDrawingMode={drawing}
        onToggleDrawingMode={() => setDrawing((v) => !v)}
        isRemoteControlMode={control}
        onToggleRemoteControlMode={() => setControl((v) => !v)}
        hasScreenShare={share !== null}
        isDesktop={desktop}
        canSwitchViews
        designItem={
          designLink
            ? {
                label: designLink.kind === 'figma' ? designLink.label : designLink.host,
                kind: designLink.kind,
                kindLabel: designLink.kind === 'figma' ? 'Figma design' : 'Web page',
                setByName: 'You',
                showing: view === 'design',
              }
            : null
        }
        onShowDesign={() => designLink && setView('design')}
        onAddDesignLink={() => setDesignDialog(true)}
        canShowOperatorMenus={host}
        canToggleLiveDocAnnotation={host}
        participantLiveDocAi
        chatOpen={false}
        onToggleChat={noop}
        attendeeOpen={false}
        onToggleAttendee={noop}
        canRecord={host}
        isRecording
        recordingState={rec}
        canChangeRecordingPolicy={host}
        onRecordingAction={(action) => setRec((r) => ({ ...r, paused: action === 'pause' }))}
        onRecordingSettings={(patch) => setRec((r) => ({ ...r, ...patch }))}
        handRaised={hand}
        onToggleHand={() => setHand((v) => !v)}
        raisedHandCount={1}
        chatBadgeCount={2}
        canDocumentPip
        galleryPrefs={gallery}
        onGalleryPrefsChange={(next) => {
          setGallery(next);
          setPage(1);
        }}
        canToggleCaptions={host}
        captionsEnabled
        meetingTitle="Weekly product review"
      />
      )}
    </div>
  );
}
