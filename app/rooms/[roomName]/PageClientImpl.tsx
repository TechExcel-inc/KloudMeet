'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { SkyMeetToolbar, ViewMode } from '@/lib/SkyMeetToolbar';
import { LiveDocView } from '@/lib/LiveDocView';
import { ConnectionDetails } from '@/lib/types';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  PreJoin,
  RoomContext,
  VideoConference,
  useTracks,
} from '@livekit/components-react';
import {
  ExternalE2EEKeyProvider,
  RoomOptions,
  VideoCodec,
  VideoPresets,
  Room,
  DeviceUnsupportedError,
  RoomConnectOptions,
  RoomEvent,
  TrackPublishDefaults,
  VideoCaptureOptions,
  Track,
} from 'livekit-client';
import { useRouter } from 'next/navigation';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
}) {
  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const preJoinDefaults = React.useMemo(() => {
    return {
      username: '',
      videoEnabled: true,
      audioEnabled: true,
    };
  }, []);
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  const handlePreJoinSubmit = React.useCallback(async (values: LocalUserChoices) => {
    setPreJoinChoices(values);
    const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
    url.searchParams.append('roomName', props.roomName);
    url.searchParams.append('participantName', values.username);
    if (props.region) {
      url.searchParams.append('region', props.region);
    }
    const connectionDetailsResp = await fetch(url.toString());
    const connectionDetailsData = await connectionDetailsResp.json();
    setConnectionDetails(connectionDetailsData);
  }, []);
  const handlePreJoinError = React.useCallback((e: any) => console.error(e), []);

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      {connectionDetails === undefined || preJoinChoices === undefined ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <PreJoin
            defaults={preJoinDefaults}
            onSubmit={handlePreJoinSubmit}
            onError={handlePreJoinError}
          />
        </div>
      ) : (
        <VideoConferenceComponent
          connectionDetails={connectionDetails}
          userChoices={preJoinChoices}
          options={{ codec: props.codec, hq: props.hq }}
        />
      )}
    </main>
  );
}

function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  options: {
    hq: boolean;
    codec: VideoCodec;
  };
}) {
  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);

  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);
  const [activeView, setActiveView] = React.useState<ViewMode>('webcam');
  const [micEnabled, setMicEnabled] = React.useState(props.userChoices.audioEnabled);
  const [camEnabled, setCamEnabled] = React.useState(props.userChoices.videoEnabled);
  const [screenShareActive, setScreenShareActive] = React.useState(false);

  const roomOptions = React.useMemo((): RoomOptions => {
    let videoCodec: VideoCodec | undefined = props.options.codec ? props.options.codec : 'vp9';
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
      videoCodec = undefined;
    }
    const videoCaptureDefaults: VideoCaptureOptions = {
      deviceId: props.userChoices.videoDeviceId ?? undefined,
      resolution: props.options.hq ? VideoPresets.h2160 : VideoPresets.h720,
    };
    const publishDefaults: TrackPublishDefaults = {
      dtx: false,
      videoSimulcastLayers: props.options.hq
        ? [VideoPresets.h1080, VideoPresets.h720]
        : [VideoPresets.h540, VideoPresets.h216],
      red: !e2eeEnabled,
      videoCodec,
    };
    return {
      videoCaptureDefaults: videoCaptureDefaults,
      publishDefaults: publishDefaults,
      audioCaptureDefaults: {
        deviceId: props.userChoices.audioDeviceId ?? undefined,
      },
      adaptiveStream: true,
      dynacast: true,
      e2ee: keyProvider && worker && e2eeEnabled ? { keyProvider, worker } : undefined,
      singlePeerConnection: true,
    };
  }, [props.userChoices, props.options.hq, props.options.codec]);

  const room = React.useMemo(() => new Room(roomOptions), []);

  // Check for any active screen share tracks in the room
  const screenShareTracks = useTracks([Track.Source.ScreenShare], { room });
  const hasScreenShare = screenShareTracks.length > 0;

  // React to screen share status logic automatically
  React.useEffect(() => {
    if (hasScreenShare) {
      // Force everybody to highlight the Screen Share tab (presenter will natively see the LiveDoc layout under the hood)
      setActiveView('shareScreen');
    } else {
      // Screen share ended, revert to webcam if we were watching a share
      setActiveView((prev) => (prev === 'shareScreen' ? 'webcam' : prev));
    }
  }, [hasScreenShare]);

  const handleViewChange = React.useCallback((view: ViewMode) => {
    // If we navigate away from the shared screen view, auto-disable our local screen share
    if (view !== 'shareScreen' && screenShareActive) {
      setScreenShareActive(false);
      room.localParticipant.setScreenShareEnabled(false).catch(console.error);
    }
    setActiveView(view);
  }, [screenShareActive, room]);

  React.useEffect(() => {
    if (e2eeEnabled) {
      keyProvider
        .setKey(decodePassphrase(e2eePassphrase))
        .then(() => {
          room.setE2EEEnabled(true).catch((e) => {
            if (e instanceof DeviceUnsupportedError) {
              alert(
                `You're trying to join an encrypted meeting, but your browser does not support it. Please update it to the latest version and try again.`,
              );
              console.error(e);
            } else {
              throw e;
            }
          });
        })
        .then(() => setE2eeSetupComplete(true));
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, room, e2eePassphrase]);

  const connectOptions = React.useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  React.useEffect(() => {
    room.on(RoomEvent.Disconnected, handleOnLeave);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleError);

    if (e2eeSetupComplete) {
      room
        .connect(
          props.connectionDetails.serverUrl,
          props.connectionDetails.participantToken,
          connectOptions,
        )
        .catch((error) => {
          handleError(error);
        });
      if (props.userChoices.videoEnabled) {
        room.localParticipant.setCameraEnabled(true).catch((error) => {
          handleError(error);
        });
      }
      if (props.userChoices.audioEnabled) {
        room.localParticipant.setMicrophoneEnabled(true).catch((error) => {
          handleError(error);
        });
      }
    }
    return () => {
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
    };
  }, [e2eeSetupComplete, room, props.connectionDetails, props.userChoices]);

  const lowPowerMode = useLowCPUOptimizer(room);

  const router = useRouter();
  const handleOnLeave = React.useCallback(() => router.push('/'), [router]);
  const handleError = React.useCallback((error: Error) => {
    console.error(error);
    alert(`Encountered an unexpected error, check the console logs for details: ${error.message}`);
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    alert(
      `Encountered an unexpected encryption error, check the console logs for details: ${error.message}`,
    );
  }, []);

  React.useEffect(() => {
    if (lowPowerMode) {
      console.warn('Low power mode enabled');
    }
  }, [lowPowerMode]);

  const handleToggleMic = React.useCallback(() => {
    const next = !micEnabled;
    setMicEnabled(next);
    room.localParticipant.setMicrophoneEnabled(next).catch(handleError);
  }, [micEnabled, room]);

  const handleToggleCam = React.useCallback(() => {
    const next = !camEnabled;
    setCamEnabled(next);
    room.localParticipant.setCameraEnabled(next).catch(handleError);
  }, [camEnabled, room]);

  const handleShareScreen = React.useCallback(() => {
    // If someone else is actively sharing, we cannot share
    if (hasScreenShare && !screenShareActive) {
      alert('Only one person can share their screen at a time.');
      return;
    }

    const next = !screenShareActive;
    setScreenShareActive(next);

    room.localParticipant.setScreenShareEnabled(next).catch((e) => {
      setScreenShareActive(false);
      console.error(e);
    });
  }, [screenShareActive, room, hasScreenShare]);

  const handleExit = React.useCallback(() => {
    room.disconnect();
    router.push('/');
  }, [room, router]);

  // Extract room name from connection URL for display
  const displayRoomName = props.connectionDetails.serverUrl
    ? props.connectionDetails.serverUrl.split('/').pop() || 'Room'
    : 'Room';

  const isPresenterScreencast = screenShareActive;
  const isPureLiveDoc = activeView === 'liveDoc';
  const showLiveDoc = isPureLiveDoc || isPresenterScreencast;

  return (
    <div className="lk-room-container" style={{ position: 'relative', height: '100%' }}>
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />

        {/* View content area */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', display: 'flex' }}>
          
          {/* Left panel: LiveDoc content */}
          {showLiveDoc && (
             <div style={{ width: '100%', flexShrink: 0, position: 'relative' }}>
               <LiveDocView
                 roomName={displayRoomName}
                 participantName={props.userChoices.username}
               />
             </div>
          )}

          {/* Right panel: Webcam grids and screen shares */}
          <div style={{ flex: 1, position: 'relative', display: showLiveDoc ? 'none' : 'block' }}>
             <VideoConference
               chatMessageFormatter={formatChatMessageLinks}
               SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
             />
          </div>

          {/* If the presenter is screen sharing, hide their own redundant screencast focus view so webcams can cleanly populate the 50% right layout! */}
          {isPresenterScreencast && (
            <style>{`
              .lk-focus-layout { display: none !important; }
              .lk-carousel { width: 100% !important; max-width: 100% !important; flex: 1 !important; }
            `}</style>
          )}
        </div>

        {/* Custom toolbar overlay */}
        <SkyMeetToolbar
          activeView={activeView}
          onViewChange={handleViewChange}
          onExit={handleExit}
          micEnabled={micEnabled}
          camEnabled={camEnabled}
          onToggleMic={handleToggleMic}
          onToggleCam={handleToggleCam}
          onShareScreen={handleShareScreen}
          screenShareActive={screenShareActive}
          canShareScreen={!hasScreenShare || screenShareActive}
        />

        <DebugMode />
        <RecordingIndicator />
      </RoomContext.Provider>
    </div>
  );
}
