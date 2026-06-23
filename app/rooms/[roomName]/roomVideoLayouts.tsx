'use client';

import React from 'react';
import { Participant, Room, RoomEvent, Track } from 'livekit-client';
import {
  ConnectionStateToast,
  ParticipantTile,
  RoomAudioRenderer,
  TrackMutedIndicator,
  useIsSpeaking,
  useTracks,
  VideoTrack,
} from '@livekit/components-react';
import { getInitials } from '@/lib/getInitials';
import { useI18n } from '@/lib/i18n';
import { parseKloudMemberIdFromMetadata } from '@/lib/meetingOwner';
import {
  FLOATING_WEBCAM_BOTTOM_TOOLBAR_INSET,
  FLOATING_WEBCAM_DEFAULT_GAP_FROM_LIVEDOC_PANEL,
  FLOATING_WEBCAM_RIGHT_DRAG_CLAMP_MARGIN,
  FLOATING_WEBCAM_RIGHT_INSET,
  FLOATING_WEBCAM_TOP_INSET,
  LIVEDOC_FILE_PANEL_COLLAPSED_WIDTH,
  LIVEDOC_FILE_PANEL_EXPANDED_WIDTH,
} from './roomConstants';

export function calcGridCols(count: number): number {
  if (count <= 1) return 1;
  if (count <= 2) return 2;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  if (count <= 9) return 3;
  if (count <= 12) return 4;
  return 4; // 13-16
}

export const MAX_VISIBLE = 16;

export function MobileVideoLayout() {
  const { t } = useI18n();
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );

  const [expanded, setExpanded] = React.useState(false);
  const gridRef = React.useRef<HTMLDivElement>(null);

  const totalCount = tracks.length;
  const isOver = totalCount > MAX_VISIBLE;
  // 收起时只显示 MAX_VISIBLE 个
  const visibleTracks = (!isOver || expanded) ? tracks : tracks.slice(0, MAX_VISIBLE);
  const hiddenCount = totalCount - MAX_VISIBLE;

  const cols = calcGridCols(Math.min(totalCount, MAX_VISIBLE));

  // 注入 data-lk-initials 到每个 placeholder 元素
  React.useEffect(() => {
    const container = gridRef.current;
    if (!container) return;

    const applyInitials = () => {
      container.querySelectorAll<HTMLElement>('.lk-participant-tile').forEach((tile) => {
        const placeholder = tile.querySelector<HTMLElement>('.lk-participant-placeholder');
        if (!placeholder) return;
        // 获取名字：先尝试 data-lk-name，再找 .lk-participant-name 文字
        const name =
          placeholder.getAttribute('data-lk-name') ||
          tile.querySelector('.lk-participant-name')?.textContent ||
          '';
        placeholder.setAttribute('data-lk-initials', getInitials(name));
      });
    };

    applyInitials();
    // MutationObserver 监听 DOM 变化（新人加入/摄像头切换）
    const observer = new MutationObserver(applyInitials);
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-lk-name', 'data-lk-video-muted'] });
    return () => observer.disconnect();
  }, [visibleTracks.length]);

  // 不滚动模式：用 CSS Grid 填满父容器高度
  const gridStyle: React.CSSProperties = isOver && expanded
    ? {
      // 展开后允许滚动
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: '6px',
      padding: '6px',
      overflowY: 'auto',
      height: '100%',
      background: '#0a0a0a',
      boxSizing: 'border-box',
    }
    : {
      // 不超16人 or 收起时：填满高度，不滚动
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridAutoRows: '1fr',
      gap: '6px',
      padding: '6px',
      height: '100%',
      overflow: 'hidden',
      background: '#0a0a0a',
      boxSizing: 'border-box',
    };

  return (
    <div className="lk-mobile-scroll-grid" style={{ flex: 1, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      <div ref={gridRef} style={gridStyle}>
        {visibleTracks.map((track, i) => (
          <div
            key={track.participant?.identity ?? i}
            style={{
              borderRadius: '12px',
              overflow: 'hidden',
              position: 'relative',
              background: '#1e1e2e',
              minHeight: 0,
            }}
          >
            <ParticipantTile
              trackRef={track}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        ))}

        {/* More 按钮 —— 占据一个格子 */}
        {isOver && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            style={{
              borderRadius: '12px',
              border: 'none',
              background: 'rgba(99, 102, 241, 0.25)',
              backdropFilter: 'blur(8px)',
              color: '#fff',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 600,
              fontFamily: 'Inter, sans-serif',
              minHeight: 0,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="28" height="28">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {`+${hiddenCount} ${t('toolbar.moreParticipants')}`}
          </button>
        )}
      </div>

      {/* 展开后收起按钮 */}
      {isOver && expanded && (
        <button
          onClick={() => setExpanded(false)}
          style={{
            flexShrink: 0,
            background: 'rgba(30,30,46,0.95)',
            border: 'none',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.6)',
            padding: '10px',
            fontSize: '0.8rem',
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M18 15l-6-6-6 6" />
          </svg>
          {t('toolbar.showLess')}
        </button>
      )}

      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}

/** LiveDoc 右侧栏 / 浮窗：与 ParticipantTile 一致的说话高亮 + 名字左侧麦克风指示 */
export function LiveDocWebcamSidebarTile({ participant, name }: { participant: Participant; name: string }) {
  const camPub = participant.getTrackPublication(Track.Source.Camera);
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  const hasVideo = !!(camPub?.track && !camPub.isMuted);
  const micMuted = !micPub?.track || micPub.isMuted;
  const isSpeaking = useIsSpeaking(participant);
  const micTrackRef = React.useMemo(
    () => ({
      participant,
      source: Track.Source.Microphone as const,
      publication: micPub,
    }),
    [participant, micPub],
  );
  return (
    <div
      className="webcam-sidebar-tile lk-participant-tile"
      data-lk-participant={participant.identity}
      data-lk-speaking={isSpeaking}
      data-lk-audio-muted={micMuted}
      data-lk-video-muted={!hasVideo}
      data-lk-local-participant={participant.isLocal}
      data-lk-source={Track.Source.Camera}
    >
      <div className="webcam-sidebar-video">
        {hasVideo && camPub?.track ? (
          <VideoTrack
            trackRef={{
              participant,
              source: Track.Source.Camera,
              publication: camPub,
            }}
          />
        ) : (
          <div className="webcam-sidebar-avatar">{getInitials(name || participant.identity || '?')}</div>
        )}
      </div>
      <div className="lk-participant-metadata webcam-sidebar-participant-metadata">
        <div className="webcam-sidebar-meta lk-participant-metadata-item">
          <TrackMutedIndicator trackRef={micTrackRef} show="always" />
          <span className="webcam-sidebar-name">{name}</span>
        </div>
      </div>
    </div>
  );
}

export function LiveDocFloatingGridTile({
  participant,
  name,
  size = 'compact',
}: {
  participant: Participant;
  name: string;
  size?: 'hero' | 'compact';
}) {
  const camPub = participant.getTrackPublication(Track.Source.Camera);
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  const hasVideo = !!(camPub?.track && !camPub.isMuted);
  const micMuted = !micPub?.track || micPub.isMuted;
  const isSpeaking = useIsSpeaking(participant);
  const micTrackRef = React.useMemo(
    () => ({
      participant,
      source: Track.Source.Microphone as const,
      publication: micPub,
    }),
    [participant, micPub],
  );
  return (
    <div
      className={`floating-grid-tile lk-participant-tile floating-grid-tile--${size}`}
      data-lk-participant={participant.identity}
      data-lk-speaking={isSpeaking}
      data-lk-audio-muted={micMuted}
      data-lk-video-muted={!hasVideo}
      data-lk-local-participant={participant.isLocal}
      data-lk-source={Track.Source.Camera}
    >
      <div className="floating-grid-video">
        {hasVideo && camPub?.track ? (
          <VideoTrack
            trackRef={{
              participant,
              source: Track.Source.Camera,
              publication: camPub,
            }}
          />
        ) : (
          <div className="floating-grid-avatar">
            <span className="floating-grid-avatar-initials">{getInitials(name)}</span>
            <span className="floating-grid-avatar-fullname" title={name}>
              {name}
            </span>
          </div>
        )}
      </div>
      <div className="lk-participant-metadata webcam-floating-participant-metadata">
        <div className="floating-grid-name-row lk-participant-metadata-item">
          <TrackMutedIndicator trackRef={micTrackRef} show="always" />
          <span className="floating-grid-name" title={name}>
            {name}
          </span>
        </div>
      </div>
    </div>
  );
}

type FloatingParticipantEntry = { id: string; name: string };

/** 右侧每列人数：6、7、6、7…；超过 13 人时底部可横向翻页 */
const FLOATING_REST_COL_PATTERN = [6, 7] as const;

function chunkRestIntoColumns<T>(items: T[]): T[][] {
  const cols: T[][] = [];
  let i = 0;
  let colIdx = 0;
  while (i < items.length) {
    const cap = FLOATING_REST_COL_PATTERN[colIdx % FLOATING_REST_COL_PATTERN.length];
    cols.push(items.slice(i, i + cap));
    i += cap;
    colIdx += 1;
  }
  return cols;
}

/** 浮窗展开：左 3 大格按麦/镜头优先级（不含说话）取前 3，右侧按列 6/7 排布，>13 人底部横向翻 */
export function LiveDocFloatingExpandedParticipantLayout({
  room,
  hostIdentity,
  cohostIdentities,
  sortedEntries,
}: {
  room: Room;
  hostIdentity: string;
  cohostIdentities: string[];
  sortedEntries: FloatingParticipantEntry[];
}) {
  const heroColumnRef = React.useRef<HTMLDivElement>(null);
  const restHScrollRef = React.useRef<HTMLDivElement>(null);
  const [restMaxHeight, setRestMaxHeight] = React.useState<number | undefined>(undefined);
  const [hScrollEdge, setHScrollEdge] = React.useState({ canLeft: false, canRight: false });
  const [layoutKey, bumpLayout] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    const onLayout = () => bumpLayout();
    const evs = [
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
    ] as const;
    for (const e of evs) {
      room.on(e, onLayout);
    }
    return () => {
      for (const e of evs) {
        room.off(e, onLayout);
      }
    };
  }, [room]);

  React.useLayoutEffect(() => {
    const el = heroColumnRef.current;
    if (!el) return;
    const sync = () => setRestMaxHeight(el.getBoundingClientRect().height);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    sync();
    return () => {
      ro?.disconnect();
    };
  }, [sortedEntries, layoutKey]);

  const { heroEntries, restEntries, heroesOnly } = React.useMemo(() => {
    const resolve = (id: string): Participant | undefined =>
      id === 'local' ? room.localParticipant : room.remoteParticipants.get(id);

    const identityFor = (id: string) =>
      id === 'local' ? room.localParticipant.identity : id;

    const hasVideo = (p: Participant | undefined) => {
      if (!p) return false;
      const camPub = p.getTrackPublication(Track.Source.Camera);
      return !!(camPub?.track && !camPub.isMuted);
    };

    const micLive = (p: Participant | undefined) => {
      if (!p) return false;
      const micPub = p.getTrackPublication(Track.Source.Microphone);
      return !!(micPub?.track && !micPub.isMuted);
    };

    const roleRank = (identity: string) => {
      if (identity === hostIdentity) return 0;
      if (cohostIdentities.includes(identity)) return 1;
      return 2;
    };

    const rows = sortedEntries
      .map((e) => {
        const participant = resolve(e.id);
        if (!participant) return null;
        const identity = identityFor(e.id);
        return {
          id: e.id,
          name: e.name,
          participant,
          identity,
          joinedAt: participant.joinedAt?.getTime() ?? 0,
          hasVideo: hasVideo(participant),
          micLive: micLive(participant),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const byJoin = (a: (typeof rows)[0], b: (typeof rows)[0]) => a.joinedAt - b.joinedAt;

    /** 左侧 3 格：开麦+开摄像头 → 仅开摄像头 → 仅开麦 → 其余（不含说话，避免多人说话时位置跳动） */
    const heroTier = (r: (typeof rows)[0]): number => {
      if (r.micLive && r.hasVideo) return 0;
      if (r.hasVideo && !r.micLive) return 1;
      if (r.micLive && !r.hasVideo) return 2;
      return 3;
    };

    const compareWithinSameTier = (a: (typeof rows)[0], b: (typeof rows)[0], tier: number) => {
      const poolSize = rows.filter((x) => heroTier(x) === tier).length;
      if (poolSize > 3) {
        const rr = roleRank(a.identity) - roleRank(b.identity);
        if (rr !== 0) return rr;
      }
      return byJoin(a, b);
    };

    const sortedForHero = [...rows].sort((a, b) => {
      const ta = heroTier(a);
      const tb = heroTier(b);
      if (ta !== tb) return ta - tb;
      return compareWithinSameTier(a, b, ta);
    });

    const hero = sortedForHero.slice(0, 3);
    const used = new Set(hero.map((r) => r.id));

    const rest = rows.filter((r) => !used.has(r.id)).sort(byJoin);
    return { heroEntries: hero, restEntries: rest, heroesOnly: rest.length === 0 };
  }, [room, sortedEntries, hostIdentity, cohostIdentities, layoutKey]);

  const restColumns = React.useMemo(() => chunkRestIntoColumns(restEntries), [restEntries]);
  const showRestHNav = restEntries.length > 13;

  const syncHScrollEdges = React.useCallback(() => {
    const el = restHScrollRef.current;
    if (!el) {
      setHScrollEdge({ canLeft: false, canRight: false });
      return;
    }
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setHScrollEdge({
      canLeft: scrollLeft > 2,
      canRight: scrollLeft + clientWidth < scrollWidth - 2,
    });
  }, []);

  React.useLayoutEffect(() => {
    syncHScrollEdges();
  }, [restColumns, restMaxHeight, layoutKey, showRestHNav, syncHScrollEdges]);

  React.useEffect(() => {
    const el = restHScrollRef.current;
    if (!el) return;
    const onScroll = () => syncHScrollEdges();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => syncHScrollEdges()) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
  }, [syncHScrollEdges, showRestHNav, heroesOnly]);

  const scrollRestHorizontal = React.useCallback(
    (dir: -1 | 1) => {
      const el = restHScrollRef.current;
      if (!el) return;
      const step = Math.max(100, Math.floor(el.clientWidth * 0.88));
      el.scrollBy({ left: dir * step, behavior: 'smooth' });
      window.setTimeout(syncHScrollEdges, 350);
    },
    [syncHScrollEdges],
  );

  const restVisibleCols = heroesOnly ? 0 : Math.min(restColumns.length, 3);

  return (
    <div
      className={`floating-expanded-grid${heroesOnly ? ' floating-expanded-grid--heroes-only' : ''}`}
      style={{ ['--floating-rest-visible-cols' as string]: String(restVisibleCols) }}
    >
      <div ref={heroColumnRef} className="floating-expanded-hero-column">
        {heroEntries.map((e) => (
          <LiveDocFloatingGridTile key={e.id} participant={e.participant} name={e.name} size="hero" />
        ))}
      </div>
      {!heroesOnly && (
        <div
          className="floating-expanded-rest-wrap"
          style={restMaxHeight !== undefined ? { maxHeight: restMaxHeight } : undefined}
        >
          <div ref={restHScrollRef} className="floating-expanded-rest-scroll">
            {restColumns.map((col, ci) => (
              <div key={`rest-col-${ci}`} className="floating-expanded-rest-col">
                {col.map((e) => (
                  <LiveDocFloatingGridTile key={e.id} participant={e.participant} name={e.name} size="compact" />
                ))}
              </div>
            ))}
          </div>
          {showRestHNav && (
            <div className="floating-expanded-rest-hnav">
              <button
                type="button"
                className="floating-expanded-rest-hnav-btn"
                disabled={!hScrollEdge.canLeft}
                onClick={() => scrollRestHorizontal(-1)}
                aria-label="向左查看更多参与者"
                title="向左"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <polyline points="15 6 9 12 15 18" />
                </svg>
              </button>
              <button
                type="button"
                className="floating-expanded-rest-hnav-btn floating-expanded-rest-hnav-btn--primary"
                disabled={!hScrollEdge.canRight}
                onClick={() => scrollRestHorizontal(1)}
                aria-label="向右查看更多参与者"
                title="向右"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LiveDocFloatingCollapsedAvatar({
  participant,
  name,
  style,
}: {
  participant: Participant;
  name: string;
  style: React.CSSProperties;
}) {
  const isSpeaking = useIsSpeaking(participant);
  return (
    <div
      className="floating-avatar-shell lk-participant-tile"
      data-lk-speaking={isSpeaking}
      data-lk-source={Track.Source.Camera}
      data-lk-local-participant={participant.isLocal}
      style={style}
    >
      <div className="floating-avatar" title={name}>
        {getInitials(name || participant.identity || '?')}
      </div>
    </div>
  );
}

export { parseKloudMemberIdFromMetadata };
