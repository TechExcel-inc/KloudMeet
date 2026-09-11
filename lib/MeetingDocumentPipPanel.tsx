'use client';

import React from 'react';
import { RoomEvent, Track, type Participant, type Room, type TrackPublication } from 'livekit-client';
import { VideoTrack } from '@livekit/components-react';
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
  endForEveryone: string;
  meeting: string;
  you: string;
  minimize: string;
  restore: string;
  shareBadge: string;
  shareScreen: string;
  stopSharing: string;
  shareConflict: string;
  invite: string;
  inviteCopied: string;
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
  onToggleShare: () => void;
  shareActive: boolean;
  hasScreenShare: boolean;
  onLeave: () => void;
  onEndForAll?: () => void;
  initialMinimized?: boolean;
  onMinimizedChange?: (minimized: boolean) => void;
}

export const PIP_EXPANDED_W = 240;
export const PIP_EXPANDED_H = 420;
export const PIP_MINIMIZED_H = 59.2;
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
const MINI_HOVER_W = 60;
const MINI_SHOW_DELAY_MS = 2000;

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

function pillWindowSize(count: number): { w: number; h: number } {
  return { w: PIP_EXPANDED_W, h: pillInnerSize(count).h };
}

function miniWindowSize(count: number): { w: number; h: number } {
  const pill = pillInnerSize(count);
  return {
    w: PIP_EXPANDED_W,
    h: pill.h + PREVIEW_GAP + PREVIEW_TILE + PREVIEW_PAD,
  };
}

export function pipPillWindowSize(count: number): { w: number; h: number } {
  return pillWindowSize(count);
}

export function pipMiniWindowSize(count: number): { w: number; h: number } {
  return miniWindowSize(count);
}

type ShareInfo = {
  participant: Participant;
  publication: TrackPublication;
  local: boolean;
  rosterId: string;
};

function findShare(room: Room): ShareInfo | null {
  const localPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
  if (localPub?.track && !localPub.isMuted) {
    return {
      participant: room.localParticipant,
      publication: localPub,
      local: true,
      rosterId: 'local',
    };
  }
  for (const p of room.remoteParticipants.values()) {
    const pub = p.getTrackPublication(Track.Source.ScreenShare);
    if (pub?.track && !pub.isMuted) {
      return {
        participant: p,
        publication: pub,
        local: false,
        rosterId: p.identity,
      };
    }
  }
  return null;
}

function focusOpener(win: Window): void {
  const opener = win.opener;
  if (!opener || opener.closed) return;
  try {
    opener.focus();
  } catch {
    // 部分环境不允许跨窗 focus
  }
}

function copyMeetingLink(pipWindow: Window): Promise<boolean> {
  let href = '';
  try {
    const opener = pipWindow.opener;
    href = opener && !opener.closed ? opener.location.href : window.location.href;
  } catch {
    href = window.location.href;
  }
  if (!href) return Promise.resolve(false);
  const clip = pipWindow.navigator.clipboard;
  if (clip) {
    return clip.writeText(href).then(
      () => true,
      () => copyWithExec(pipWindow.document, href),
    );
  }
  return Promise.resolve(copyWithExec(pipWindow.document, href));
}

function copyWithExec(doc: Document, text: string): boolean {
  const el = doc.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  doc.body.appendChild(el);
  el.select();
  const ok = doc.execCommand('copy');
  el.remove();
  return ok;
}

function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
      <path d="M20 18v-1c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v1H2v1c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-1h-2zM6 5h12v8H6V5z" />
    </svg>
  );
}

function fitCols(width: number, gap: number, min: number, max?: number): number {
  const inner = Math.max(0, width);
  const byMin = Math.floor((inner + gap) / (min + gap));
  const cols = Math.max(1, byMin);
  if (max === undefined) return cols;
  return Math.min(max, cols);
}

function pillEntries(
  entries: { id: string; name: string }[],
  shareId: string | null,
): { id: string; name: string }[] {
  const shown = entries.slice(0, COLLAPSED_MAX);
  if (!shareId || shown.some((e) => e.id === shareId)) return shown;
  const sharer = entries.find((e) => e.id === shareId);
  if (!sharer) return shown;
  if (shown.length < COLLAPSED_MAX) return [...shown, sharer];
  return [...shown.slice(0, COLLAPSED_MAX - 1), sharer];
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
  onToggleShare,
  shareActive,
  hasScreenShare,
  onLeave,
  onEndForAll,
  initialMinimized = false,
  onMinimizedChange,
}: MeetingDocumentPipPanelProps) {
  const [minimized, setMinimized] = React.useState(initialMinimized);
  const [exitMenuOpen, setExitMenuOpen] = React.useState(false);
  const [shareMenuOpen, setShareMenuOpen] = React.useState(false);
  const [miniControls, setMiniControls] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copiedTimerRef = React.useRef<number | null>(null);
  const leaveWrapRef = React.useRef<HTMLDivElement>(null);
  const shareWrapRef = React.useRef<HTMLDivElement>(null);
  const showMiniTimerRef = React.useRef<number | null>(null);
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
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
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

  React.useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) pipWindow.clearTimeout(copiedTimerRef.current);
    };
  }, [pipWindow]);

  const canEndForAll = Boolean(
    onEndForAll && (mediaRestrictions.isHost || mediaRestrictions.isCohost),
  );

  React.useEffect(() => {
    if (minimized) {
      setExitMenuOpen(false);
      setShareMenuOpen(false);
    } else {
      clearShowMiniTimer();
      setMiniControls(false);
    }
  }, [minimized]);

  React.useEffect(() => {
    if (!minimized) return;
    const root = pipWindow.document.documentElement;
    const hide = () => {
      clearShowMiniTimer();
      setShareMenuOpen(false);
      setMiniControls(false);
    };
    root.addEventListener('mouseleave', hide);
    return () => {
      root.removeEventListener('mouseleave', hide);
      clearShowMiniTimer();
    };
  }, [minimized, pipWindow]);

  React.useEffect(() => {
    if (!shareActive) setShareMenuOpen(false);
  }, [shareActive]);

  React.useEffect(() => {
    if (!exitMenuOpen && !shareMenuOpen) return;
    const doc = pipWindow.document;
    const onPointer = (e: Event) => {
      const target = e.target as Node | null;
      if (leaveWrapRef.current?.contains(target)) return;
      if (shareWrapRef.current?.contains(target)) return;
      setExitMenuOpen(false);
      setShareMenuOpen(false);
    };
    doc.addEventListener('pointerdown', onPointer, true);
    return () => doc.removeEventListener('pointerdown', onPointer, true);
  }, [exitMenuOpen, shareMenuOpen, pipWindow]);

  const handleLeaveClick = () => {
    if (canEndForAll) {
      setShareMenuOpen(false);
      setExitMenuOpen((open) => !open);
      return;
    }
    onLeave();
  };

  const handleShareClick = () => {
    if (shareActive) {
      setExitMenuOpen(false);
      setShareMenuOpen((open) => !open);
      return;
    }
    onToggleShare();
  };

  const sortedEntries = React.useMemo(() => {
    return [
      { id: 'local', name: room.localParticipant.name || localName || labels.you },
      ...Array.from(room.remoteParticipants.values()).map((p) => ({
        id: p.identity,
        name: p.name || p.identity || labels.you,
      })),
    ];
  }, [room, localName, labels.you, rosterTick]);

  const share = React.useMemo(() => findShare(room), [room, rosterTick]);

  const heroCols = fitCols(stageW, HERO_GAP, HERO_MIN);
  const compactCols = Math.max(
    COMPACT_COLS_MIN,
    fitCols(stageW, COMPACT_GAP, COMPACT_MIN, COMPACT_COLS_MAX),
  );
  const heroCap = heroCols * HERO_ROWS;
  const heroW = Math.max(1, (stageW - HERO_GAP * Math.max(0, heroCols - 1)) / heroCols);

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
    const pill = pillWindowSize(sortedEntries.length);
    resizePip(pipWindow, pill.w, pill.h);
    setMinimized(true);
    onMinimizedChange?.(true);
  };

  const hidePreview = () => {
    if (!previewId) return;
    const pill = pillWindowSize(sortedEntries.length);
    resizePip(pipWindow, pill.w, pill.h);
    setPreviewId(null);
  };

  const clearShowMiniTimer = () => {
    if (showMiniTimerRef.current === null) return;
    pipWindow.clearTimeout(showMiniTimerRef.current);
    showMiniTimerRef.current = null;
  };

  const showMiniControls = () => {
    hidePreview();
    setMiniControls(true);
  };

  const armShowMiniControls = () => {
    if (miniControls) return;
    if (showMiniTimerRef.current !== null) return;
    showMiniTimerRef.current = pipWindow.setTimeout(() => {
      showMiniTimerRef.current = null;
      showMiniControls();
    }, MINI_SHOW_DELAY_MS);
  };

  const toggleMiniControls = () => {
    if (miniControls) {
      setShareMenuOpen(false);
      setMiniControls(false);
      return;
    }
    showMiniControls();
  };

  const onChevronEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    const from = e.relatedTarget;
    const cluster = e.currentTarget.parentElement;
    if (from instanceof Node && cluster?.contains(from)) return;
    toggleMiniControls();
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
  const isSharer = (id: string) => Boolean(share && share.rosterId === id);
  const shareInHero = Boolean(share && rest.length === 0);
  const collapsed = pillEntries(sortedEntries, share ? share.rosterId : null);

  const backToTab = (e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    focusOpener(pipWindow);
  };

  const personBadge = (id: string) =>
    isSharer(id) ? <span className={styles.shareBadge}>{labels.shareBadge}</span> : null;

  const shareVideo = share ? (
    <div
      className={styles.shareTile}
      role="button"
      tabIndex={0}
      title={labels.shareBadge}
      aria-label={labels.shareBadge}
      onClick={backToTab}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        backToTab(e);
      }}
    >
      <VideoTrack
        trackRef={{
          participant: share.participant,
          source: Track.Source.ScreenShare,
          publication: share.publication,
        }}
      />
    </div>
  ) : null;

  const flashCopied = () => {
    void copyMeetingLink(pipWindow).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (copiedTimerRef.current !== null) pipWindow.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = pipWindow.setTimeout(() => {
        copiedTimerRef.current = null;
        setCopied(false);
      }, 1800);
    });
  };

  const renderControls = (compact: boolean) => {
    const icon = compact ? 14 : 16;
    const shareConflict = hasScreenShare && !shareActive;
    const shareLabel = shareConflict
      ? labels.shareConflict
      : shareActive
        ? labels.stopSharing
        : labels.shareScreen;

    const row = (
      <>
        <button
          type="button"
          className={`${styles.controlBtn} ${micEnabled ? '' : styles.controlOff}`}
          onClick={onToggleMic}
          aria-label={micEnabled ? labels.muteMic : labels.unmuteMic}
          title={micEnabled ? labels.muteMic : labels.unmuteMic}
        >
          {micEnabled ? (
            <svg viewBox="0 0 24 24" width={icon} height={icon} fill="currentColor">
              <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width={icon} height={icon} fill="currentColor">
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
            <svg viewBox="0 0 24 24" width={icon} height={icon} fill="currentColor">
              <path d="M17 10.5V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-3.5l4 4v-11l-4 4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width={icon} height={icon} fill="currentColor">
              <path d="M17 10.5V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-3.5l4 4v-11l-4 4z" />
              <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className={`${styles.controlBtn} ${styles.inviteBtn}`}
          aria-label={labels.invite}
          title={labels.invite}
          onClick={flashCopied}
        >
          <svg viewBox="0 0 24 24" width={icon} height={icon} fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
          </svg>
        </button>
        <div ref={shareWrapRef} className={styles.shareWrap}>
          {shareMenuOpen && shareActive ? (
            <div
              className={compact ? styles.shareMenuCover : styles.shareMenuAbove}
              role="menu"
            >
              <button
                type="button"
                className={styles.exitMenuItem}
                role="menuitem"
                onClick={() => {
                  setShareMenuOpen(false);
                  onToggleShare();
                }}
              >
                {labels.stopSharing}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className={`${styles.controlBtn}${hasScreenShare ? ` ${styles.shareBtnConflict}` : ''}`}
            onClick={handleShareClick}
            aria-label={shareLabel}
            title={shareLabel}
            aria-haspopup={shareActive ? 'menu' : undefined}
            aria-expanded={shareActive ? shareMenuOpen : undefined}
          >
            {hasScreenShare ? <span className={styles.shareConflictDot} /> : null}
            <svg viewBox="0 0 24 24" width={icon} height={icon} fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
        <div ref={compact ? undefined : leaveWrapRef} className={styles.leaveWrap}>
          {!compact && exitMenuOpen && canEndForAll ? (
            <div className={`${styles.shareMenuAbove} ${styles.leaveMenu}`} role="menu">
              <button type="button" className={styles.exitMenuItem} role="menuitem" onClick={onLeave}>
                {labels.leave}
              </button>
              <button
                type="button"
                className={`${styles.exitMenuItem} ${styles.exitMenuItemDanger}`}
                role="menuitem"
                onClick={() => onEndForAll?.()}
              >
                {labels.endForEveryone}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className={`${styles.controlBtn} ${styles.leaveBtn}`}
            onClick={compact ? onLeave : handleLeaveClick}
            aria-label={labels.leave}
            title={labels.leave}
            aria-haspopup={!compact && canEndForAll ? 'menu' : undefined}
            aria-expanded={!compact && canEndForAll ? exitMenuOpen : undefined}
          >
            <svg viewBox="0 0 24 24" width={icon} height={icon} fill="currentColor">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 010-1.41C3.34 8.69 7.46 7 12 7s8.66 1.69 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
            </svg>
          </button>
        </div>
      </>
    );

    if (compact) {
      return <div className={styles.miniControls}>{row}</div>;
    }
    return <div className={styles.controls}>{row}</div>;
  };

  return (
    <div className={`${styles.root}${minimized ? ` ${styles.rootMinimized}` : ''}`}>
      {copied ? (
        <div className={styles.copyToast} role="status">
          {labels.inviteCopied}
        </div>
      ) : null}
      {minimized ? (
        <div
          className={`${styles.mini}${previewOpen ? ` ${styles.miniOpen}` : ''}`}
          onMouseLeave={() => {
            clearShowMiniTimer();
            setShareMenuOpen(false);
            setMiniControls(false);
          }}
        >
          <div className={styles.pill}>
            {miniControls ? (
              renderControls(true)
            ) : (
              <div className={styles.stack}>
                {collapsed.map((e, i) => {
                  const participant =
                    e.id === 'local' ? room.localParticipant : room.remoteParticipants.get(e.id);
                  const z = { zIndex: COLLAPSED_MAX - i };
                  const mark = isSharer(e.id);
                  if (!participant) {
                    return (
                      <div key={e.id} className={styles.pillPerson} style={z}>
                        <div
                          className={styles.avatar}
                          title={e.name}
                          onClick={() => togglePreview(e.id)}
                        >
                          {getInitials(e.name || e.id || '?')}
                        </div>
                        {mark ? (
                          <span className={styles.pillShareMark} aria-hidden>
                            <ShareGlyph />
                          </span>
                        ) : null}
                      </div>
                    );
                  }
                  return (
                    <div key={e.id} className={styles.pillPerson} style={z}>
                      <LiveDocFloatingCollapsedAvatar
                        participant={participant}
                        name={e.name}
                        style={{ zIndex: 1 }}
                        selected={previewId === e.id}
                        onClick={() => togglePreview(e.id)}
                      />
                      {mark ? (
                        <span className={styles.pillShareMark} aria-hidden>
                          <ShareGlyph />
                        </span>
                      ) : null}
                    </div>
                  );
                })}
                {sortedEntries.length > COLLAPSED_MAX && (
                  <button
                    type="button"
                    className={`${styles.avatar} ${styles.overflow}`}
                    onClick={handleMinimize}
                    aria-label={labels.restore}
                    title={labels.restore}
                  >
                    +{sortedEntries.length - COLLAPSED_MAX}
                  </button>
                )}
              </div>
            )}
            {previewOpen && !miniControls ? (
              <button
                type="button"
                className={styles.pillDismiss}
                onClick={hidePreview}
                aria-label={labels.minimize}
              />
            ) : null}
            <div className={styles.hoverCluster}>
              <div
                className={styles.hoverHit}
                style={{ width: MINI_HOVER_W }}
                onMouseEnter={armShowMiniControls}
                onMouseLeave={clearShowMiniTimer}
              />
              <button
                type="button"
                className={styles.chevron}
                onClick={handleMinimize}
                onMouseEnter={onChevronEnter}
                aria-label={labels.restore}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
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
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="6 15 12 9 18 15" />
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
                  {personBadge(e.id)}
                </div>
              ))}
              {shareInHero && shareVideo ? <div className={styles.heroCell}>{shareVideo}</div> : null}
            </div>

            {(rest.length > 0 || (share && !shareInHero)) && (
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
                    {personBadge(e.id)}
                  </div>
                ))}
                {share && !shareInHero && shareVideo ? (
                  <div
                    className={`${styles.compactCell}${(rest.length + 1) % compactCols === 0 ? ` ${styles.compactCellRowEnd}` : ''}`}
                  >
                    {shareVideo}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {renderControls(false)}
        </>
      )}
    </div>
  );
}
