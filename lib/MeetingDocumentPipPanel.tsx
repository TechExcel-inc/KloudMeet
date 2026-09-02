'use client';

import React from 'react';
import { RoomEvent, Track, type Participant, type Room } from 'livekit-client';
import { LiveDocFloatingCollapsedAvatar, LiveDocFloatingGridTile } from '@/app/rooms/[roomName]/roomVideoLayouts';
import type { KloudTileMediaRestrictionProps } from '@/app/rooms/[roomName]/roomVideoLayouts';
import { getInitials } from '@/lib/getInitials';
import styles from '@/styles/MeetingDocumentPip.module.css';

export interface MeetingDocumentPipLabels {
  muteMic: string;
  unmuteMic: string;
  turnOffCam: string;
  turnOnCam: string;
  leave: string;
  meeting: string;
  you: string;
  minimize: string;
  restore: string;
}

export interface MeetingDocumentPipPanelProps {
  room: Room;
  pipWindow: Window;
  micEnabled: boolean;
  camEnabled: boolean;
  labels: MeetingDocumentPipLabels;
  localName: string;
  mediaRestrictions: KloudTileMediaRestrictionProps;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onLeave: () => void;
  initialMinimized?: boolean;
  onMinimizedChange?: (minimized: boolean) => void;
}

export const PIP_EXPANDED_W = 240;
export const PIP_EXPANDED_H = 420;
const HERO_ROWS = 2;
const HERO_GAP = 6;
const HERO_MIN = 64;
const PREVIEW_TILE = 108;
const COMPACT_GAP = 6;
const COMPACT_MIN = 48;
const COMPACT_COLS_MIN = 4;
const COMPACT_COLS_MAX = 8;
const COLLAPSED_MAX = 5;
const AVATAR_SIZE = 30;
const AVATAR_STEP = 22;
const PILL_PAD_X = 8;
const PILL_PAD_Y = 6;
const PILL_GAP = 6;
const CHEVRON_SIZE = 24;
const PREVIEW_GAP = 8;
const PREVIEW_PAD = 6;

type RosterRow = {
  id: string;
  name: string;
  participant: Participant;
};

function resizePip(win: Window, innerW: number, innerH: number): boolean {
  const chromeW = Math.max(0, win.outerWidth - win.innerWidth);
  const chromeH = Math.max(0, win.outerHeight - win.innerHeight);
  try {
    win.resizeTo(Math.ceil(innerW + chromeW), Math.ceil(innerH + chromeH));
    return true;
  } catch {
    return false;
  }
}

function pillInnerSize(count: number): { w: number; h: number } {
  const overflow = Math.max(0, count - COLLAPSED_MAX);
  const visible = Math.min(COLLAPSED_MAX, Math.max(1, count));
  const n = visible + (overflow > 0 ? 1 : 0);
  const stack = AVATAR_SIZE + Math.max(0, n - 1) * AVATAR_STEP;
  return {
    w: PILL_PAD_X * 2 + stack + PILL_GAP + CHEVRON_SIZE,
    h: PILL_PAD_Y * 2 + AVATAR_SIZE,
  };
}

function miniWindowSize(count: number): { w: number; h: number } {
  const pill = pillInnerSize(count);
  return {
    w: Math.max(pill.w, PREVIEW_TILE + PREVIEW_PAD * 2),
    h: pill.h + PREVIEW_GAP + PREVIEW_TILE + PREVIEW_PAD,
  };
}

export function pipPillWindowSize(count: number): { w: number; h: number } {
  return pillInnerSize(count);
}

export function pipMiniWindowSize(count: number): { w: number; h: number } {
  return miniWindowSize(count);
}

function fitCols(width: number, gap: number, min: number, max?: number): number {
  const inner = Math.max(0, width);
  const byMin = Math.floor((inner + gap) / (min + gap));
  const cols = Math.max(1, byMin);
  if (max === undefined) return cols;
  return Math.min(max, cols);
}

function splitRoster(
  room: Room,
  entries: { id: string; name: string }[],
  hostIdentity: string,
  cohostIdentities: string[],
  heroCap: number,
): { heroes: RosterRow[]; rest: RosterRow[] } {
  const resolve = (id: string): Participant | undefined =>
    id === 'local' ? room.localParticipant : room.remoteParticipants.get(id);

  const identityFor = (id: string) => (id === 'local' ? room.localParticipant.identity : id);

  const hasVideo = (p: Participant) => {
    const camPub = p.getTrackPublication(Track.Source.Camera);
    return !!(camPub?.track && !camPub.isMuted);
  };

  const micLive = (p: Participant) => {
    const micPub = p.getTrackPublication(Track.Source.Microphone);
    return !!(micPub?.track && !micPub.isMuted);
  };

  const roleRank = (identity: string) => {
    if (identity === hostIdentity) return 0;
    if (cohostIdentities.includes(identity)) return 1;
    return 2;
  };

  const rows = entries
    .map((e) => {
      const participant = resolve(e.id);
      if (!participant) return null;
      return {
        id: e.id,
        name: e.name,
        participant,
        identity: identityFor(e.id),
        joinedAt: participant.joinedAt?.getTime() ?? 0,
        hasVideo: hasVideo(participant),
        micLive: micLive(participant),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const byJoin = (a: (typeof rows)[0], b: (typeof rows)[0]) => a.joinedAt - b.joinedAt;

  const heroTier = (r: (typeof rows)[0]): number => {
    if (r.micLive && r.hasVideo) return 0;
    if (r.hasVideo && !r.micLive) return 1;
    if (r.micLive && !r.hasVideo) return 2;
    return 3;
  };

  const sortedForHero = [...rows].sort((a, b) => {
    const ta = heroTier(a);
    const tb = heroTier(b);
    if (ta !== tb) return ta - tb;
    const poolSize = rows.filter((x) => heroTier(x) === ta).length;
    if (poolSize > heroCap) {
      const rr = roleRank(a.identity) - roleRank(b.identity);
      if (rr !== 0) return rr;
    }
    return byJoin(a, b);
  });

  const hero = sortedForHero.slice(0, Math.max(1, heroCap));
  const used = new Set(hero.map((r) => r.id));
  const rest = rows.filter((r) => !used.has(r.id)).sort(byJoin);
  return {
    heroes: hero.map(({ id, name, participant }) => ({ id, name, participant })),
    rest: rest.map(({ id, name, participant }) => ({ id, name, participant })),
  };
}

export function MeetingDocumentPipPanel({
  room,
  pipWindow,
  micEnabled,
  camEnabled,
  labels,
  localName,
  mediaRestrictions,
  onToggleMic,
  onToggleCam,
  onLeave,
  initialMinimized = false,
  onMinimizedChange,
}: MeetingDocumentPipPanelProps) {
  const [minimized, setMinimized] = React.useState(initialMinimized);
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const [rosterTick, setRosterTick] = React.useState(0);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = React.useState(() => Math.max(160, pipWindow.innerWidth - 16));

  React.useEffect(() => {
    const bump = () => setRosterTick((n) => n + 1);
    const evs = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.ParticipantNameChanged,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
    ] as const;
    for (const e of evs) {
      room.on(e, bump);
    }
    return () => {
      for (const e of evs) {
        room.off(e, bump);
      }
    };
  }, [room]);

  React.useEffect(() => {
    if (minimized) return;
    const el = stageRef.current;
    if (!el) return;
    const sync = () => {
      const cs = pipWindow.getComputedStyle(el);
      const pad = Number.parseFloat(cs.paddingLeft) + Number.parseFloat(cs.paddingRight);
      setStageW(Math.max(1, el.clientWidth - pad));
    };
    sync();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    pipWindow.addEventListener('resize', sync);
    return () => {
      ro?.disconnect();
      pipWindow.removeEventListener('resize', sync);
    };
  }, [pipWindow, minimized]);

  const sortedEntries = React.useMemo(() => {
    return [
      { id: 'local', name: room.localParticipant.name || localName || labels.you },
      ...Array.from(room.remoteParticipants.values()).map((p) => ({
        id: p.identity,
        name: p.name || p.identity || labels.you,
      })),
    ];
  }, [room, localName, labels.you, rosterTick]);

  const heroCols = fitCols(stageW, HERO_GAP, HERO_MIN);
  const compactCols = Math.max(
    COMPACT_COLS_MIN,
    fitCols(stageW, COMPACT_GAP, COMPACT_MIN, COMPACT_COLS_MAX),
  );
  const heroCap = heroCols * HERO_ROWS;
  const heroW = Math.max(1, (stageW - HERO_GAP * Math.max(0, heroCols - 1)) / heroCols);
  const compactW = Math.max(1, (stageW - COMPACT_GAP * Math.max(0, compactCols - 1)) / compactCols);

  const { heroes, rest } = React.useMemo(
    () =>
      splitRoster(
        room,
        sortedEntries,
        mediaRestrictions.hostIdentity,
        mediaRestrictions.cohostIdentities,
        heroCap,
      ),
    [room, sortedEntries, mediaRestrictions.hostIdentity, mediaRestrictions.cohostIdentities, heroCap],
  );

  const handleMinimize = () => {
    setPreviewId(null);
    if (minimized) {
      resizePip(pipWindow, PIP_EXPANDED_W, PIP_EXPANDED_H);
      setMinimized(false);
      onMinimizedChange?.(false);
      return;
    }
    const pill = pillInnerSize(sortedEntries.length);
    resizePip(pipWindow, pill.w, pill.h);
    setMinimized(true);
    onMinimizedChange?.(true);
  };

  const hidePreview = () => {
    if (!previewId) return;
    const pill = pillInnerSize(sortedEntries.length);
    resizePip(pipWindow, pill.w, pill.h);
    setPreviewId(null);
  };

  const togglePreview = (id: string) => {
    if (previewId === id) {
      hidePreview();
      return;
    }
    const mini = miniWindowSize(sortedEntries.length);
    resizePip(pipWindow, mini.w, mini.h);
    setPreviewId(id);
  };

  const previewRow = previewId ? sortedEntries.find((e) => e.id === previewId) : undefined;
  const previewParticipant = previewRow
    ? previewRow.id === 'local'
      ? room.localParticipant
      : room.remoteParticipants.get(previewRow.id)
    : undefined;
  const previewOpen = Boolean(previewRow && previewParticipant);

  return (
    <div className={`${styles.root}${minimized ? ` ${styles.rootMinimized}` : ''}`}>
      {minimized ? (
        <div className={`${styles.mini}${previewOpen ? ` ${styles.miniOpen}` : ''}`}>
          <div className={styles.pill}>
            <div className={styles.stack}>
              {sortedEntries.slice(0, COLLAPSED_MAX).map((e, i) => {
                const participant =
                  e.id === 'local' ? room.localParticipant : room.remoteParticipants.get(e.id);
                const z = { zIndex: COLLAPSED_MAX - i };
                if (!participant) {
                  return (
                    <div
                      key={e.id}
                      className={styles.avatar}
                      title={e.name}
                      style={z}
                      onClick={() => togglePreview(e.id)}
                    >
                      {getInitials(e.name || e.id || '?')}
                    </div>
                  );
                }
                return (
                  <LiveDocFloatingCollapsedAvatar
                    key={e.id}
                    participant={participant}
                    name={e.name}
                    style={z}
                    selected={previewId === e.id}
                    onClick={() => togglePreview(e.id)}
                  />
                );
              })}
              {sortedEntries.length > COLLAPSED_MAX && (
                <div className={`${styles.avatar} ${styles.overflow}`}>
                  +{sortedEntries.length - COLLAPSED_MAX}
                </div>
              )}
            </div>
            <button
              type="button"
              className={styles.chevron}
              onClick={handleMinimize}
              aria-label={labels.restore}
              title={labels.restore}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {previewOpen ? (
              <button
                type="button"
                className={styles.pillDismiss}
                onClick={hidePreview}
                aria-label={labels.minimize}
              />
            ) : null}
          </div>
          {previewOpen && previewParticipant && previewRow ? (
            <div
              className={styles.previewWrap}
              style={{ ['--pip-preview-tile' as string]: `${PREVIEW_TILE}px` } as React.CSSProperties}
            >
              <LiveDocFloatingGridTile
                participant={previewParticipant}
                name={previewRow.name}
                size="hero"
                mediaRestrictions={mediaRestrictions}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <header className={styles.header}>
            <span className={styles.title}>{labels.meeting}</span>
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={handleMinimize}
                aria-label={labels.minimize}
                title={labels.minimize}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </header>
          <div
            ref={stageRef}
            className={`${styles.stage} lk-room-container`}
            style={
              {
                ['--pip-hero-cols' as string]: String(heroCols),
                ['--pip-compact-cols' as string]: String(compactCols),
                ['--pip-hero-gap' as string]: `${HERO_GAP}px`,
                ['--pip-compact-gap' as string]: `${COMPACT_GAP}px`,
                ['--pip-hero-tile' as string]: `${heroW}px`,
                ['--pip-compact-tile' as string]: `${compactW}px`,
              } as React.CSSProperties
            }
          >
            <div className={styles.heroGrid}>
              {heroes.map((e) => (
                <div key={e.id} className={styles.heroCell}>
                  <LiveDocFloatingGridTile
                    participant={e.participant}
                    name={e.name}
                    size="hero"
                    mediaRestrictions={mediaRestrictions}
                  />
                </div>
              ))}
            </div>

            {rest.length > 0 && (
              <div className={styles.compactGrid}>
                {rest.map((e, i) => (
                  <div
                    key={e.id}
                    className={`${styles.compactCell}${(i + 1) % compactCols === 0 ? ` ${styles.compactCellRowEnd}` : ''}`}
                  >
                    <LiveDocFloatingGridTile
                      participant={e.participant}
                      name={e.name}
                      size="compact"
                      mediaRestrictions={mediaRestrictions}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.controls}>
            <button
              type="button"
              className={`${styles.controlBtn} ${micEnabled ? '' : styles.controlOff}`}
              onClick={onToggleMic}
              aria-label={micEnabled ? labels.muteMic : labels.unmuteMic}
              title={micEnabled ? labels.muteMic : labels.unmuteMic}
            >
              {micEnabled ? (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2z" />
                  <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                </svg>
              )}
            </button>

            <button
              type="button"
              className={`${styles.controlBtn} ${camEnabled ? '' : styles.controlOff}`}
              onClick={onToggleCam}
              aria-label={camEnabled ? labels.turnOffCam : labels.turnOnCam}
              title={camEnabled ? labels.turnOffCam : labels.turnOnCam}
            >
              {camEnabled ? (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M17 10.5V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-3.5l4 4v-11l-4 4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M17 10.5V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-3.5l4 4v-11l-4 4z" />
                  <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                </svg>
              )}
            </button>

            <button
              type="button"
              className={`${styles.controlBtn} ${styles.leaveBtn}`}
              onClick={onLeave}
              aria-label={labels.leave}
              title={labels.leave}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 010-1.41C3.34 8.69 7.46 7 12 7s8.66 1.69 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
