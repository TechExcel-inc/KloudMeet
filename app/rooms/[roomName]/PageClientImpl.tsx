'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { KloudMeetToolbar, ViewMode } from '@/lib/KloudMeetToolbar';
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
  const [isWebcamSidebarCollapsed, setIsWebcamSidebarCollapsed] = React.useState(false);

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
    // Ignore user cancellation errors (like declining screen share)
    if (
      error.name === 'NotAllowedError' || 
      error.message?.toLowerCase().includes('permission') ||
      error.message?.toLowerCase().includes('notallowed')
    ) {
      console.warn('User cancelled or denied media request:', error);
      return;
    }
    
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

  // Force disable native Picture-in-Picture overlays (e.g. Firefox) on all videos
  React.useEffect(() => {
    const disablePiP = () => {
      document.querySelectorAll('video').forEach(video => {
        if (!video.hasAttribute('disablePictureInPicture')) {
          video.setAttribute('disablePictureInPicture', 'true');
        }
      });
    };
    disablePiP();
    const observer = new MutationObserver(disablePiP);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

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
          <div className={`sky-meet-video-wrapper ${isWebcamSidebarCollapsed ? 'sidebar-collapsed' : ''}`} style={{ flex: 1, position: 'relative', display: showLiveDoc ? 'none' : 'block' }}>
             <VideoConference
               chatMessageFormatter={formatChatMessageLinks}
               SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
             />

             {/* Webcam collapse/expand button during screenshare */}
             {hasScreenShare && (
               <button
                 className="webcam-collapse-toggle"
                 onClick={(e) => {
                   e.preventDefault();
                   e.stopPropagation();
                   setIsWebcamSidebarCollapsed(!isWebcamSidebarCollapsed);
                 }}
                 style={{
                   position: 'absolute',
                   top: '50%',
                   left: isWebcamSidebarCollapsed ? 0 : 160,
                   right: 'auto',
                   transform: 'translateY(-50%)',
                   zIndex: 2000,
                   background: 'rgba(30, 41, 59, 0.95)',
                   color: 'rgba(255,255,255,0.8)',
                   border: '1px solid rgba(255,255,255,0.1)',
                   borderLeft: 'none',
                   borderRadius: '0 8px 8px 0',
                   width: '28px',
                   height: '64px',
                   cursor: 'pointer',
                   display: 'flex',
                   alignItems: 'center',
                   justifyContent: 'center',
                   transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                   boxShadow: '4px 0 12px rgba(0,0,0,0.5)',
                 }}
                 title={isWebcamSidebarCollapsed ? "Expand Webcams" : "Collapse Webcams"}
                 onMouseOver={(e) => e.currentTarget.style.color = '#fff'}
                 onMouseOut={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.8)'}
               >
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}>
                   {isWebcamSidebarCollapsed ? (
                     <polyline points="9 18 15 12 9 6" />
                   ) : (
                     <polyline points="15 18 9 12 15 6" />
                   )}
                 </svg>
               </button>
             )}
          </div>

          {/* If the presenter is screen sharing, hide their own redundant screencast focus view so webcams can cleanly populate the 50% right layout! */}
          {isPresenterScreencast && (
            <style>{`
              .lk-focus-layout { display: none !important; }
              .lk-carousel { width: 100% !important; max-width: 100% !important; flex: 1 !important; }
            `}</style>
          )}

          {/* Dynamic layout injections */}
          <style>{`
            ${hasScreenShare ? `
              /* Clean, Native-Friendly Screenshare Layout Overrides */
              
              /* 1. Reset base containment so we can fill the window safely */
              .sky-meet-video-wrapper .lk-video-conference, 
              .sky-meet-video-wrapper .lk-room-container { padding: 0 !important; }
              .sky-meet-video-wrapper .lk-video-conference-inner { 
                padding: 0 !important; 
                margin: 0 !important; 
                display: flex !important; 
                flex-direction: row-reverse !important; /* Forces Carousel cleanly to the LEFT side natively */
                width: 100% !important;
                height: 100vh !important;
              }
              
              /* 2. Screenshare Wrapper cleanly gets all remaining width */
              .sky-meet-video-wrapper .lk-focus-layout-wrapper,
              .sky-meet-video-wrapper .lk-focus-layout {
                flex: 1 !important; 
                display: flex !important;
                width: 100% !important;
                height: 100% !important;
                min-width: 0 !important; 
                background: #000 !important;
                align-items: center !important;
                justify-content: center !important;
              }
              .sky-meet-video-wrapper .lk-focus-layout .lk-participant-tile {
                width: 100% !important;
                height: 100% !important;
                display: flex !important;
              }
              .sky-meet-video-wrapper .lk-focus-layout .lk-participant-tile .lk-video-container {
                width: 100% !important;
                height: 100% !important;
              }
              .sky-meet-video-wrapper .lk-focus-layout .lk-participant-tile video {
                width: 100% !important;
                height: 100% !important;
                object-fit: contain !important;
                pointer-events: none !important; /* CRITICAL: Blocks Firefox/Chrome from spawning native Picture-in-Picture hover overlays! */
              }

              /* 3. The Webcam Panel relies entirely on a CSS parent class for instant toggling without destroying the entire <style> block via React */
              .sky-meet-video-wrapper .lk-carousel { 
                display: flex !important;
                flex-direction: column !important;
                justify-content: flex-start !important; /* Align webcams from top down */
                align-items: center !important;
                width: 160px !important; 
                min-width: 160px !important; 
                max-width: 160px !important;
                height: 100% !important;
                margin: 0 !important;
                flex-shrink: 0 !important; 
                background: #111 !important;
                gap: 12px !important;
                overflow-y: auto !important;
                border-right: 1px solid rgba(255,255,255,0.1) !important;
                padding: 12px 8px !important;
              }
              
              /* This pure CSS toggle prevents the catastrophic Layout Thrashing bug */
              .sky-meet-video-wrapper.sidebar-collapsed .lk-carousel {
                display: none !important;
              }

              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile {
                pointer-events: none !important; /* Absolutely prevents accidental clicks which would swap the webcam into the FocusLayout! */
                flex: 0 0 auto !important; /* CRITICAL: Prevent flexbox from vertically stretching the tile to fill the 100vh sidebar */
                width: 100% !important;
                height: auto !important; /* Allow aspect-ratio to dictate height */
                min-height: 0 !important;
                aspect-ratio: 16 / 9 !important;
                border-radius: 8px !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important;
              }

              /* 4. Hide all redundant LiveKit controls (Maximize, PiP, etc.) from the screenshare tile entirely */
              .sky-meet-video-wrapper .lk-focus-layout button,
              .sky-meet-video-wrapper .lk-focus-layout .lk-button,
              .sky-meet-video-wrapper .lk-focus-layout .lk-focus-toggle-button,
              .sky-meet-video-wrapper .lk-focus-layout [class*="button"],
              .sky-meet-video-wrapper .lk-focus-layout [class*="action"],
              .sky-meet-video-wrapper .lk-focus-layout [class*="lk-pip"],
              .sky-meet-video-wrapper .lk-focus-layout [class*="focus-toggle"],
              .sky-meet-video-wrapper .lk-focus-layout [class*="lk-participant-metadata"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
              }

              /* 5. Mobile Responsiveness */
              @media (max-width: 768px) {
                .sky-meet-video-wrapper .lk-video-conference-inner {
                  flex-direction: column !important; /* Stack webcams nicely */
                }
                .sky-meet-video-wrapper .lk-carousel {
                  width: 100% !important;
                  max-width: 100% !important;
                  min-width: 0 !important;
                  height: 120px !important;
                  min-height: 120px !important;
                  flex-direction: row !important; /* Horizontal scrolling on phones */
                  overflow-x: auto !important;
                  overflow-y: hidden !important;
                  border-right: none !important;
                  border-bottom: 1px solid rgba(255,255,255,0.1) !important;
                  padding: 8px !important;
                  gap: 8px !important;
                }
                .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile {
                  height: 100% !important;
                  width: auto !important;
                  aspect-ratio: 16 / 9 !important;
                }
              }
            ` : ''}
          `}</style>
        </div>

        {/* Custom toolbar overlay */}
        <KloudMeetToolbar
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
