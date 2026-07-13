'use client';

import React from 'react';
import {
  Participant,
  RemoteParticipant,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import {
  AudioTrack,
  ConnectionStateToast,
  ParticipantTile,
  useIsSpeaking,
  useRoomContext,
  useTracks,
  VideoTrack,
} from '@livekit/components-react';
import { ParticipantTileRoleMoreMenu } from '@/lib/ParticipantRoleMenu';
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

export type KloudTileMediaRestrictionProps = {
  hostMutedIdentities: string[];
  hostDisabledVideoIdentities: string[];
  muteAllActive: boolean;
  exemptFromMuteAllIdentities: string[];
  hostIdentity: string;
  cohostIdentities: string[];
  autoPresenterIdentity: string | null;
  copresenterIdentities: string[];
  roomLocalIdentity: string;
  isHost: boolean;
  isCohost: boolean;
};

function isKloudTargetOperator(identity: string, props: KloudTileMediaRestrictionProps): boolean {
  return (
    identity === props.hostIdentity ||
    props.cohostIdentities.includes(identity) ||
    props.autoPresenterIdentity === identity ||
    props.copresenterIdentities.includes(identity)
  );
}

function KloudFloatingMicIndicator({
  participant,
  mediaRestrictions,
}: {
  participant: Participant;
  mediaRestrictions: KloudTileMediaRestrictionProps;
}) {
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  const isMuted = !micPub?.track || micPub.isMuted;
  const identity = participant.identity;
  const operator = isKloudTargetOperator(identity, mediaRestrictions);
  const isHostMicRestricted =
    mediaRestrictions.hostMutedIdentities.includes(identity) && !operator;
  const isForceMuted =
    mediaRestrictions.muteAllActive &&
    !mediaRestrictions.exemptFromMuteAllIdentities.includes(identity) &&
    !operator &&
    isMuted;
  const isRed = isHostMicRestricted || isForceMuted;
  const color = isRed ? '#ff2020' : isMuted ? 'rgba(255, 255, 255, 0.75)' : '#22c55e';
  const isLocal = identity === mediaRestrictions.roomLocalIdentity;
  const operatorInteractive = !isLocal && (mediaRestrictions.isHost || mediaRestrictions.isCohost);
  const selfInteractive = isLocal && !isHostMicRestricted && !isForceMuted;

  return (
    <div
      className={`kloud-custom-mic-indicator${isRed ? ' kloud-custom-mic--force-muted' : ''}${operatorInteractive ? ' operator-interactive' : ''}${selfInteractive ? ' self-interactive' : ''}`}
      data-kloud-identity={identity}
      data-kloud-muted={isMuted ? 'true' : 'false'}
      data-kloud-host-restricted={isHostMicRestricted ? 'true' : 'false'}
      data-kloud-force-muted={isForceMuted ? 'true' : 'false'}
      style={{ color }}
      title={
        selfInteractive
          ? isMuted
            ? 'Turn on microphone'
            : 'Turn off microphone'
          : operatorInteractive
            ? isHostMicRestricted
              ? 'Cancel disable (does not turn on mic)'
              : 'Disable microphone'
            : undefined
      }
    >
      <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
        {isMuted ? (
          <>
            <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z" />
            <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </>
        ) : (
          <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z" />
        )}
      </svg>
    </div>
  );
}

function KloudFloatingCamIndicator({
  participant,
  mediaRestrictions,
}: {
  participant: Participant;
  mediaRestrictions: KloudTileMediaRestrictionProps;
}) {
  const camPub = participant.getTrackPublication(Track.Source.Camera);
  const isVideoDisabled = !camPub?.track || camPub.isMuted;
  const identity = participant.identity;
  const operator = isKloudTargetOperator(identity, mediaRestrictions);
  const isHostVideoRestricted =
    mediaRestrictions.hostDisabledVideoIdentities.includes(identity) && !operator;
  const color = isHostVideoRestricted
    ? '#ff2020'
    : isVideoDisabled
      ? 'rgba(255, 255, 255, 0.75)'
      : '#22c55e';
  const isLocal = identity === mediaRestrictions.roomLocalIdentity;
  const operatorInteractive = !isLocal && (mediaRestrictions.isHost || mediaRestrictions.isCohost);
  const selfInteractive = isLocal && !isHostVideoRestricted;

  return (
    <div
      className={`kloud-custom-cam-indicator${isHostVideoRestricted ? ' kloud-custom-cam--force-disabled' : ''}${operatorInteractive ? ' operator-interactive' : ''}${selfInteractive ? ' self-interactive' : ''}`}
      data-kloud-identity={identity}
      data-kloud-video-disabled={isVideoDisabled ? 'true' : 'false'}
      data-kloud-host-restricted={isHostVideoRestricted ? 'true' : 'false'}
      style={{ color }}
      title={
        selfInteractive
          ? isVideoDisabled
            ? 'Turn on camera'
            : 'Turn off camera'
          : operatorInteractive
            ? isHostVideoRestricted
              ? 'Cancel disable (does not turn on camera)'
              : 'Disable camera'
            : undefined
      }
    >
      <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
        {isVideoDisabled ? (
          <>
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
            <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </>
        ) : (
          <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
        )}
      </svg>
    </div>
  );
}

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

const MOBILE_AUDIO_SOURCES = new Set<Track.Source>([
  Track.Source.Microphone,
  Track.Source.ScreenShareAudio,
]);

function collectMobileRemoteAudioTracks(room: Room) {
  const refs: Array<{
    participant: RemoteParticipant;
    publication: RemoteTrackPublication;
    source: Track.Source;
  }> = [];

  room.remoteParticipants.forEach((participant) => {
    participant.audioTrackPublications.forEach((publication) => {
      if (!MOBILE_AUDIO_SOURCES.has(publication.source)) return;
      if (!publication.isSubscribed || !publication.track) return;
      refs.push({
        participant,
        publication,
        source: publication.source,
      });
    });
  });

  return refs;
}

/** Mobile-only: force-subscribe every remote mic and render one AudioTrack per participant. */
export function KloudMobileRoomAudioRenderer() {
  const room = useRoomContext();
  const [syncToken, setSyncToken] = React.useState(0);

  React.useEffect(() => {
    const ensureRemoteAudio = () => {
      let requestedSubscription = false;
      room.remoteParticipants.forEach((participant) => {
        participant.audioTrackPublications.forEach((publication) => {
          if (!MOBILE_AUDIO_SOURCES.has(publication.source)) return;
          if (!publication.isSubscribed) {
            publication.setSubscribed(true);
            requestedSubscription = true;
          }
        });
      });

      void room.startAudio().catch(() => null);
      if (requestedSubscription) {
        setSyncToken((v) => v + 1);
      }
    };

    const syncRemoteAudio = () => {
      ensureRemoteAudio();
      setSyncToken((v) => v + 1);
    };

    syncRemoteAudio();

    const events = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackSubscriptionStatusChanged,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.Reconnected,
      RoomEvent.ConnectionStateChanged,
    ] as const;

    events.forEach((event) => room.on(event, syncRemoteAudio));

    const intervalId = window.setInterval(ensureRemoteAudio, 4000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncRemoteAudio();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      events.forEach((event) => room.off(event, syncRemoteAudio));
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [room]);

  const audioTracks = React.useMemo(
    () => collectMobileRemoteAudioTracks(room),
    [room, syncToken],
  );

  return (
    <div style={{ display: 'none' }} aria-hidden="true">
      {audioTracks.map(({ participant, publication, source }) => (
        <AudioTrack
          key={`${participant.identity}-${publication.trackSid}`}
          trackRef={{ participant, publication, source }}
        />
      ))}
    </div>
  );
}

export function MobileVideoLayout() {
  const { t } = useI18n();
  const room = useRoomContext();
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

  // Mobile browsers often pause <video> after backgrounding or reconnecting.
  // Proactively resume playback (same recovery pattern as web VideoConference + startAudio).
  React.useEffect(() => {
    const container = gridRef.current;
    if (!container) return;

    let playTimer: ReturnType<typeof setTimeout> | null = null;

    const playVideos = () => {
      container.querySelectorAll('video').forEach((video) => {
        if (video.paused) {
          video.play().catch(() => null);
        }
      });
    };

    const schedulePlay = () => {
      if (playTimer) clearTimeout(playTimer);
      requestAnimationFrame(playVideos);
      playTimer = setTimeout(playVideos, 350);
    };

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      schedulePlay();
    };

    const handleMediaRecovery = () => schedulePlay();

    schedulePlay();
    document.addEventListener('visibilitychange', handleVisibility);
    room.on(RoomEvent.Reconnected, handleMediaRecovery);
    room.on(RoomEvent.TrackSubscribed, handleMediaRecovery);
    room.on(RoomEvent.TrackUnmuted, handleMediaRecovery);
    room.on(RoomEvent.LocalTrackPublished, handleMediaRecovery);

    return () => {
      if (playTimer) clearTimeout(playTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      room.off(RoomEvent.Reconnected, handleMediaRecovery);
      room.off(RoomEvent.TrackSubscribed, handleMediaRecovery);
      room.off(RoomEvent.TrackUnmuted, handleMediaRecovery);
      room.off(RoomEvent.LocalTrackPublished, handleMediaRecovery);
    };
  }, [room, visibleTracks.length]);

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

  const handleMobileGridBlankTap = React.useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        'button, a, input, select, textarea, .kloud-custom-mic-indicator, .kloud-custom-cam-indicator, .kloud-tile-more-menu-btn, .lk-device-menu',
      )
    ) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent('kloud-mobile-blank-tap', { detail: { target } }),
    );
  }, []);

  return (
    <div
      className="lk-mobile-scroll-grid"
      onPointerDown={handleMobileGridBlankTap}
      style={{ flex: 1, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}
    >
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

      <ConnectionStateToast />
    </div>
  );
}

/** LiveDoc 右侧栏 / 浮窗：与 ParticipantTile 一致的说话高亮 + 名字左侧麦克风指示 */
export function LiveDocWebcamSidebarTile({
  participant,
  name,
  mediaRestrictions,
}: {
  participant: Participant;
  name: string;
  mediaRestrictions: KloudTileMediaRestrictionProps;
}) {
  const camPub = participant.getTrackPublication(Track.Source.Camera);
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  const hasVideo = !!(camPub?.track && !camPub.isMuted);
  const micMuted = !micPub?.track || micPub.isMuted;
  const isSpeaking = useIsSpeaking(participant);
  return (
    <div
      className="webcam-sidebar-tile lk-participant-tile"
      data-lk-participant={participant.identity}
      data-lk-speaking={isSpeaking}
      data-lk-audio-muted={micMuted}
      data-lk-video-muted={!hasVideo}
      data-lk-local-participant={participant.isLocal ? 'true' : 'false'}
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
          <KloudFloatingMicIndicator participant={participant} mediaRestrictions={mediaRestrictions} />
          <KloudFloatingCamIndicator participant={participant} mediaRestrictions={mediaRestrictions} />
          <span className="webcam-sidebar-name">{name}</span>
          <ParticipantTileRoleMoreMenu identity={participant.identity} placement="inline" />
        </div>
      </div>
    </div>
  );
}

export function LiveDocFloatingGridTile({
  participant,
  name,
  size = 'compact',
  mediaRestrictions,
}: {
  participant: Participant;
  name: string;
  size?: 'hero' | 'compact';
  mediaRestrictions: KloudTileMediaRestrictionProps;
}) {
  const camPub = participant.getTrackPublication(Track.Source.Camera);
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  const hasVideo = !!(camPub?.track && !camPub.isMuted);
  const micMuted = !micPub?.track || micPub.isMuted;
  const isSpeaking = useIsSpeaking(participant);
  const identity = participant.identity;
  const operator = isKloudTargetOperator(identity, mediaRestrictions);
  const isForceMuted =
    mediaRestrictions.muteAllActive &&
    !mediaRestrictions.exemptFromMuteAllIdentities.includes(identity) &&
    !operator &&
    micMuted;

  return (
    <div
      className={`floating-grid-tile lk-participant-tile floating-grid-tile--${size}`}
      data-lk-participant={participant.identity}
      data-lk-speaking={isSpeaking}
      data-lk-audio-muted={micMuted}
      data-lk-video-muted={!hasVideo}
      data-lk-local-participant={participant.isLocal}
      data-lk-source={Track.Source.Camera}
      data-kloud-force-muted={isForceMuted ? 'true' : 'false'}
    >
      <ParticipantTileRoleMoreMenu identity={identity} />
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
          <KloudFloatingMicIndicator participant={participant} mediaRestrictions={mediaRestrictions} />
          <KloudFloatingCamIndicator participant={participant} mediaRestrictions={mediaRestrictions} />
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
  mediaRestrictions,
}: {
  room: Room;
  hostIdentity: string;
  cohostIdentities: string[];
  sortedEntries: FloatingParticipantEntry[];
  mediaRestrictions: KloudTileMediaRestrictionProps;
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
  }, [room, sortedEntries, hostIdentity, cohostIdentities]);

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
          <LiveDocFloatingGridTile
            key={e.id}
            participant={e.participant}
            name={e.name}
            size="hero"
            mediaRestrictions={mediaRestrictions}
          />
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
                  <div key={e.id} className="floating-compact-slot">
                    <LiveDocFloatingGridTile
                      participant={e.participant}
                      name={e.name}
                      size="compact"
                      mediaRestrictions={mediaRestrictions}
                    />
                  </div>
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
  onClick,
  selected,
}: {
  participant: Participant;
  name: string;
  style: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
  selected?: boolean;
}) {
  const isSpeaking = useIsSpeaking(participant);
  return (
    <div
      className={`floating-avatar-shell lk-participant-tile${selected ? ' selected' : ''}`}
      data-lk-speaking={isSpeaking}
      data-lk-source={Track.Source.Camera}
      data-lk-local-participant={participant.isLocal}
      style={style}
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="floating-avatar" title={name}>
        {getInitials(name || participant.identity || '?')}
      </div>
    </div>
  );
}

export { parseKloudMemberIdFromMetadata };
