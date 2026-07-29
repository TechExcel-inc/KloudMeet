'use client';

import type {
  MessageDecoder,
  MessageEncoder,
  TrackReferenceOrPlaceholder,
  WidgetState,
} from '@livekit/components-core';
import { isEqualTrackRef, isTrackReference, isWeb } from '@livekit/components-core';
import { RoomEvent, Track } from 'livekit-client';
import * as React from 'react';
import {
  CarouselLayout,
  Chat,
  ConnectionStateToast,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  ParticipantTile,
  RoomAudioRenderer,
  useCreateLayoutContext,
  usePinnedTracks,
  useRoomContext,
  useTracks,
  type MessageFormatter,
} from '@livekit/components-react';

export type WebcamLayoutMode = 'tile' | 'spotlight';

export interface KloudVideoConferenceProps extends React.HTMLAttributes<HTMLDivElement> {
  chatMessageFormatter?: MessageFormatter;
  chatMessageEncoder?: MessageEncoder;
  chatMessageDecoder?: MessageDecoder;
  SettingsComponent?: React.ComponentType;
  /** Webcam 子布局：tile 宫格 / spotlight 焦点（无屏幕共享时生效） */
  webcamLayoutMode?: WebcamLayoutMode;
}

function trackKey(track: TrackReferenceOrPlaceholder): string {
  if (isTrackReference(track)) {
    return `${track.participant.identity}_${track.source}_${track.publication.trackSid}`;
  }
  return `${track.participant.identity}_${track.source}_placeholder`;
}

/**
 * LiveKit VideoConference 的 SkyMeet 变体：
 * - 屏幕共享：自动 pin → FocusLayout
 * - Webcam Spotlight：渲染期直接选焦点轨（不依赖 effect 时序）
 * - Webcam Tile：GridLayout
 */
export function KloudVideoConference({
  chatMessageFormatter,
  chatMessageDecoder,
  chatMessageEncoder,
  SettingsComponent,
  webcamLayoutMode = 'tile',
  ...props
}: KloudVideoConferenceProps) {
  const room = useRoomContext();
  const [widgetState, setWidgetState] = React.useState<WidgetState>({
    showChat: false,
    unreadMessages: 0,
    showSettings: false,
  });
  const lastAutoFocusedScreenShareTrack = React.useRef<TrackReferenceOrPlaceholder | null>(null);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );

  const layoutContext = useCreateLayoutContext();

  const screenShareTracks = React.useMemo(
    () =>
      tracks
        .filter(isTrackReference)
        .filter((track) => track.publication.source === Track.Source.ScreenShare),
    [tracks],
  );

  const hasSubscribedScreenShare = screenShareTracks.some((track) => track.publication.isSubscribed);
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

  // 渲染期决定焦点：Spotlight 不依赖 pin effect，避免时序/空 publication 导致不切换
  const focusTrack: TrackReferenceOrPlaceholder | undefined = hasSubscribedScreenShare
    ? pinnedTrack
    : webcamLayoutMode === 'spotlight'
      ? spotlightTrack
      : undefined;

  const carouselTracks = React.useMemo(
    () => tracks.filter((track) => !isEqualTrackRef(track, focusTrack)),
    [tracks, focusTrack],
  );

  const pinDispatch = layoutContext.pin.dispatch;
  const pinState = layoutContext.pin.state;
  const screenShareKey = screenShareTracks
    .map((ref) => `${ref.publication.trackSid}_${ref.publication.isSubscribed}`)
    .join();

  // 仅维护屏幕共享自动 pin（与上游 VideoConference 一致）
  React.useEffect(() => {
    if (
      hasSubscribedScreenShare &&
      lastAutoFocusedScreenShareTrack.current === null &&
      screenShareTracks[0]
    ) {
      pinDispatch?.({ msg: 'set_pin', trackReference: screenShareTracks[0] });
      lastAutoFocusedScreenShareTrack.current = screenShareTracks[0];
      return;
    }

    if (
      lastAutoFocusedScreenShareTrack.current &&
      !screenShareTracks.some(
        (track) =>
          track.publication.trackSid ===
          lastAutoFocusedScreenShareTrack.current?.publication?.trackSid,
      )
    ) {
      pinDispatch?.({ msg: 'clear_pin' });
      lastAutoFocusedScreenShareTrack.current = null;
    }

    if (pinnedTrack && !isTrackReference(pinnedTrack) && hasSubscribedScreenShare) {
      const updatedFocusTrack = tracks.find(
        (tr) =>
          tr.participant.identity === pinnedTrack.participant.identity &&
          tr.source === pinnedTrack.source,
      );
      if (updatedFocusTrack !== pinnedTrack && isTrackReference(updatedFocusTrack)) {
        pinDispatch?.({ msg: 'set_pin', trackReference: updatedFocusTrack });
      }
    }
  }, [
    hasSubscribedScreenShare,
    pinDispatch,
    pinnedTrack,
    screenShareKey,
    screenShareTracks,
    tracks,
  ]);

  // Spotlight 时同步 pin；Tile 仅在确有 pin 时清理（避免 clear_pin 每次返回新 [] 导致死循环）
  React.useEffect(() => {
    if (hasSubscribedScreenShare) return;

    if (webcamLayoutMode === 'tile') {
      if (pinState && pinState.length > 0) {
        pinDispatch?.({ msg: 'clear_pin' });
      }
      return;
    }

    if (webcamLayoutMode !== 'spotlight' || !spotlightTrack) return;
    if (isEqualTrackRef(pinnedTrack, spotlightTrack)) return;
    pinDispatch?.({ msg: 'set_pin', trackReference: spotlightTrack });
  }, [
    hasSubscribedScreenShare,
    pinDispatch,
    pinState,
    pinnedTrack,
    spotlightTrack,
    webcamLayoutMode,
  ]);

  const showFocusLayout = Boolean(focusTrack);

  return (
    <div
      className="lk-video-conference"
      data-kloud-webcam-layout={hasSubscribedScreenShare ? 'screenshare' : webcamLayoutMode}
      data-kloud-focus-track={focusTrack ? trackKey(focusTrack) : ''}
      {...props}
    >
      {/* Spotlight 自带布局样式，不依赖父级注入是否生效 */}
      {webcamLayoutMode === 'spotlight' && !hasSubscribedScreenShare && (
        <style>{`
          .lk-video-conference[data-kloud-webcam-layout="spotlight"] {
            width: 100%;
            height: 100%;
            min-height: 0;
          }
          .lk-video-conference[data-kloud-webcam-layout="spotlight"] .lk-video-conference-inner {
            display: flex !important;
            flex-direction: row-reverse !important;
            width: 100% !important;
            height: 100% !important;
            min-height: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .lk-video-conference[data-kloud-webcam-layout="spotlight"] .lk-focus-layout-wrapper,
          .lk-video-conference[data-kloud-webcam-layout="spotlight"] .lk-focus-layout {
            flex: 1 1 auto !important;
            display: flex !important;
            width: 100% !important;
            height: 100% !important;
            min-width: 0 !important;
            min-height: 0 !important;
            background: #000 !important;
            align-items: center !important;
            justify-content: center !important;
          }
          .lk-video-conference[data-kloud-webcam-layout="spotlight"] .lk-focus-layout > .lk-participant-tile {
            width: 100% !important;
            height: 100% !important;
            max-height: 100% !important;
          }
          .lk-video-conference[data-kloud-webcam-layout="spotlight"] .lk-carousel {
            --kloud-spotlight-tile: 120px;
            flex: 0 0 calc(var(--kloud-spotlight-tile) + 16px) !important;
            width: calc(var(--kloud-spotlight-tile) + 16px) !important;
            max-width: calc(var(--kloud-spotlight-tile) + 16px) !important;
            min-width: calc(var(--kloud-spotlight-tile) + 16px) !important;
            height: 100% !important;
            overflow-x: hidden !important;
            overflow-y: auto !important;
            padding: 8px !important;
            gap: 8px !important;
            box-sizing: border-box !important;
            border-right: 1px solid rgba(255,255,255,0.12) !important;
            background: rgba(0,0,0,0.35) !important;
          }
          .lk-video-conference[data-kloud-webcam-layout="spotlight"] .lk-carousel > .lk-participant-tile {
            width: var(--kloud-spotlight-tile) !important;
            max-width: var(--kloud-spotlight-tile) !important;
            height: auto !important;
            aspect-ratio: 1 / 1 !important;
            flex: 0 0 auto !important;
          }
          .lk-video-conference[data-kloud-webcam-layout="spotlight"] .lk-focus-toggle-button {
            display: none !important;
          }
        `}</style>
      )}
      {isWeb() && (
        <LayoutContextProvider value={layoutContext} onWidgetChange={setWidgetState}>
          <div className="lk-video-conference-inner">
            {!showFocusLayout ? (
              <div className="lk-grid-layout-wrapper">
                <GridLayout tracks={tracks}>
                  <ParticipantTile />
                </GridLayout>
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
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}
