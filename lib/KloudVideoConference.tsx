'use client';

import type {
  MessageDecoder,
  MessageEncoder,
  TrackReferenceOrPlaceholder,
  WidgetState,
} from '@livekit/components-core';
import { isEqualTrackRef, isTrackReference, isWeb } from '@livekit/components-core';
import { Track } from 'livekit-client';
import * as React from 'react';
import {
  CarouselLayout,
  Chat,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  LayoutContextProvider,
  ParticipantTile,
  useCreateLayoutContext,
  usePinnedTracks,
  useRoomContext,
  useTracks,
  type MessageFormatter,
} from '@livekit/components-react';
import { KloudConnectionStateToast } from './KloudConnectionStateToast';
import { applyBalancedGrid } from './tileLayout';
import { KloudGridLayout } from './KloudGridLayout';
import { DEFAULT_GALLERY_PREFS, type GalleryPrefs } from './galleryPrefs';

export type WebcamLayoutMode = 'tile' | 'spotlight';

export interface KloudVideoConferenceProps extends React.HTMLAttributes<HTMLDivElement> {
  chatMessageFormatter?: MessageFormatter;
  chatMessageEncoder?: MessageEncoder;
  chatMessageDecoder?: MessageDecoder;
  SettingsComponent?: React.ComponentType;
  /** Webcam 子布局：tile 宫格 / spotlight 焦点（无屏幕共享时生效） */
  webcamLayoutMode?: WebcamLayoutMode;
  /** The viewer's own gallery settings (tiles per page, video first, hide without video) */
  galleryPrefs?: GalleryPrefs;
  /** Recorder bot in gallery mode: keep the video grid even while someone shares their screen */
  ignoreScreenShare?: boolean;
}

function trackKey(track: TrackReferenceOrPlaceholder): string {
  if (isTrackReference(track)) {
    return `${track.participant.identity}_${track.source}_${track.publication.trackSid}`;
  }
  return `${track.participant.identity}_${track.source}_placeholder`;
}

/**
 * LiveKit VideoConference 的 SkyMeet 变体：
 * - 屏幕共享：渲染期直接 FocusLayout（不依赖 pin effect 时序）
 * - Webcam Spotlight：渲染期直接选焦点轨
 * - Webcam Tile：GridLayout
 */
export function KloudVideoConference({
  chatMessageFormatter,
  chatMessageDecoder,
  chatMessageEncoder,
  SettingsComponent,
  webcamLayoutMode = 'tile',
  galleryPrefs = DEFAULT_GALLERY_PREFS,
  ignoreScreenShare = false,
  ...props
}: KloudVideoConferenceProps) {
  const room = useRoomContext();
  const [widgetState, setWidgetState] = React.useState<WidgetState>({
    showChat: false,
    unreadMessages: 0,
    showSettings: false,
  });
  const lastAutoFocusedScreenShareTrack = React.useRef<TrackReferenceOrPlaceholder | null>(null);

  // 勿限制为仅 ActiveSpeakersChanged：否则屏幕共享 publish/subscribe 后 tracks 可能不刷新，
  // 表现为 Tab 已是 shareScreen，主画面仍停在摄像头宫格。
  // 不传 updateOnlyOn 时走默认 allParticipantRoomEvents（含 ActiveSpeakers + Track*）。
  const allTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const tracks = React.useMemo(
    () => (ignoreScreenShare ? allTracks.filter((track) => track.source !== Track.Source.ScreenShare) : allTracks),
    [allTracks, ignoreScreenShare],
  );

  const layoutContext = useCreateLayoutContext();

  /** Gallery tile size (lib/tileLayout.ts), re-applied whenever tiles come and go or the stage resizes. */
  const gridWrapperRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const wrapper = gridWrapperRef.current;
    if (!wrapper) return;
    const apply = () => {
      const grid = wrapper.querySelector<HTMLElement>('.lk-grid-layout');
      if (!grid) return;
      applyBalancedGrid(grid);
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(wrapper, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-lk-name'],
    });
    // Tile size follows the stage size (window resize, side panels opening)
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    resize?.observe(wrapper);
    return () => {
      observer.disconnect();
      resize?.disconnect();
    };
  });

  const screenShareTracks = React.useMemo(
    () =>
      tracks
        .filter(isTrackReference)
        .filter((track) => track.publication.source === Track.Source.ScreenShare),
    [tracks],
  );

  /**
   * 本地优先，否则取列表末路（通常为最新接管）。
   * 有媒体轨的优先；订阅被暂停时仍留在焦点上，避免画面一卸掉 adaptiveStream 就不再恢复。
   */
  const activeScreenShareTrack = React.useMemo(() => {
    if (screenShareTracks.length === 0) return undefined;
    const live = screenShareTracks.filter(
      (track) => track.publication.isSubscribed || Boolean(track.publication.track),
    );
    const pool = live.length > 0 ? live : screenShareTracks;
    const localId = room.localParticipant.identity;
    const localShare = pool.find((track) => track.participant.identity === localId);
    return localShare ?? pool[pool.length - 1];
  }, [room.localParticipant.identity, screenShareTracks]);
  const hasActiveScreenShare = Boolean(activeScreenShareTrack);
  const pinnedTracks = usePinnedTracks(layoutContext);
  const pinnedTrack = pinnedTracks[0];

  const spotlightTrack = React.useMemo((): TrackReferenceOrPlaceholder | undefined => {
    const cameraTracks = tracks.filter((track) => track.source === Track.Source.Camera);
    if (cameraTracks.length === 0) return undefined;

    // 优先有真实 publication 的轨，再回退 placeholder（关摄像头）
    const published = cameraTracks.filter(isTrackReference);
    const pool = published.length > 0 ? published : cameraTracks;

    const activeIdentity = room.activeSpeakers[0]?.identity;
    if (activeIdentity) {
      const speaking = pool.find((track) => track.participant.identity === activeIdentity);
      if (speaking) return speaking;
    }

    const anySpeaking = pool.find((track) => track.participant.isSpeaking);
    if (anySpeaking) return anySpeaking;

    // 多人时优先远端；单人则用本地
    const remote = pool.find((track) => track.participant.identity !== room.localParticipant.identity);
    return remote ?? pool[0];
  }, [room.activeSpeakers, room.localParticipant.identity, tracks]);

  // 渲染期决定焦点：屏幕共享以当前活动轨为准（勿沿用旧 pin，否则接管后仍停在上一人）
  const focusTrack: TrackReferenceOrPlaceholder | undefined = (() => {
    if (activeScreenShareTrack) return activeScreenShareTrack;
    if (webcamLayoutMode === 'spotlight') return spotlightTrack;
    return pinnedTrack;
  })();

  const carouselTracks = React.useMemo(
    () => tracks.filter((track) => !isEqualTrackRef(track, focusTrack)),
    [tracks, focusTrack],
  );

  const pinDispatch = layoutContext.pin.dispatch;
  const pinState = layoutContext.pin.state;
  const screenShareKey = screenShareTracks
    .map((ref) => `${ref.publication.trackSid}_${ref.publication.isSubscribed}`)
    .join();

  // 仅维护屏幕共享自动 pin：活动轨 SID 变化时重钉（接管）
  React.useEffect(() => {
    if (activeScreenShareTrack) {
      const lastSid = lastAutoFocusedScreenShareTrack.current?.publication?.trackSid;
      const nextSid = activeScreenShareTrack.publication.trackSid;
      if (lastSid !== nextSid) {
        pinDispatch?.({ msg: 'set_pin', trackReference: activeScreenShareTrack });
        lastAutoFocusedScreenShareTrack.current = activeScreenShareTrack;
      }
      return;
    }

    if (lastAutoFocusedScreenShareTrack.current) {
      pinDispatch?.({ msg: 'clear_pin' });
      lastAutoFocusedScreenShareTrack.current = null;
    }
  }, [activeScreenShareTrack, pinDispatch, screenShareKey]);

  // Spotlight 的焦点由布局直接决定，不沿用 Tile 中手动选择的人物。
  React.useEffect(() => {
    if (hasActiveScreenShare) return;
    if (webcamLayoutMode !== 'spotlight' || !pinState?.length) return;
    pinDispatch?.({ msg: 'clear_pin' });
  }, [
    hasActiveScreenShare,
    pinDispatch,
    pinState,
    webcamLayoutMode,
  ]);

  const showFocusLayout = Boolean(focusTrack);

  return (
    <div
      className="lk-video-conference"
      data-kloud-webcam-layout={hasActiveScreenShare ? 'screenshare' : webcamLayoutMode}
      data-kloud-focus-track={focusTrack ? trackKey(focusTrack) : ''}
      {...props}
    >
      {isWeb() && (
        <LayoutContextProvider value={layoutContext} onWidgetChange={setWidgetState}>
          <div className="lk-video-conference-inner">
            {!showFocusLayout ? (
              <div className="lk-grid-layout-wrapper" ref={gridWrapperRef}>
                <KloudGridLayout tracks={tracks} prefs={galleryPrefs}>
                  <ParticipantTile />
                </KloudGridLayout>
              </div>
            ) : (
              <div className="lk-focus-layout-wrapper">
                <FocusLayoutContainer>
                  <CarouselLayout tracks={carouselTracks}>
                    <ParticipantTile />
                  </CarouselLayout>
                  {focusTrack ? <FocusLayout trackRef={focusTrack} /> : null}
                </FocusLayoutContainer>
              </div>
            )}
            <ControlBar controls={{ chat: true, settings: !!SettingsComponent }} />
          </div>
          <Chat
            style={{ display: widgetState.showChat ? 'grid' : 'none' }}
            messageFormatter={chatMessageFormatter}
            messageEncoder={chatMessageEncoder}
            messageDecoder={chatMessageDecoder}
          />
          {SettingsComponent && (
            <div
              className="lk-settings-menu-modal"
              style={{ display: widgetState.showSettings ? 'block' : 'none' }}
            >
              <SettingsComponent />
            </div>
          )}
        </LayoutContextProvider>
      )}
      {/* 远端音频由会议页顶层渲染（错误边界之外），此处不再重复挂载 */}
      <KloudConnectionStateToast />
    </div>
  );
}
