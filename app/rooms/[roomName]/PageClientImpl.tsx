'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { KloudMeetToolbar, ViewMode } from '@/lib/KloudMeetToolbar';
import { LiveDocView } from '@/lib/LiveDocView';
import { AnnotationCanvas } from '@/lib/AnnotationCanvas';
import { RemoteControlOverlay } from '@/lib/RemoteControlOverlay';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { ConnectionDetails } from '@/lib/types';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  PreJoin,
  RoomContext,
  VideoConference,
  VideoTrack,
  Chat,
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
  DataPacket_Kind,
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
    try {
      setPreJoinChoices(values);
      const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
      url.searchParams.append('roomName', props.roomName);
      url.searchParams.append('participantName', values.username);
      if (props.region) {
        url.searchParams.append('region', props.region);
      }
      const connectionDetailsResp = await fetch(url.toString());
      if (!connectionDetailsResp.ok) {
        throw new Error(`Server error ${connectionDetailsResp.status}: ${await connectionDetailsResp.text()}`);
      }
      const connectionDetailsData = await connectionDetailsResp.json();
      setConnectionDetails(connectionDetailsData);
    } catch (error: any) {
      console.error('Failed to get connection details:', error);
      alert(`Could not connect to the room. Is your LiveKit server running? Error: ${error.message}`);
    }
  }, []);
  const handlePreJoinError = React.useCallback((error: any) => {
    console.error('PreJoin Validation Error:', error);
    alert(`LiveKit PreJoin Error: ${error?.message || String(error)}`);
  }, []);

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
  const [isDrawingMode, setIsDrawingMode] = React.useState(false);
  const [isRemoteControlMode, setIsRemoteControlMode] = React.useState(false);
  const [screenShareSurface, setScreenShareSurface] = React.useState<'monitor' | 'window' | 'browser' | 'current-tab' | 'unknown'>('unknown');
  const isDesktop = useIsDesktop();

  React.useEffect(() => {
    if (navigator.mediaDevices && (navigator.mediaDevices as any).setCaptureHandleConfig) {
      try {
        (navigator.mediaDevices as any).setCaptureHandleConfig({
          handle: "kloudmeet",
          exposeOrigin: true,
          permittedOrigins: ["*"]
        });
      } catch (e) {
        console.warn("Capture Handle Config failed", e);
      }
    }
  }, []);

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
      if (screenShareActive) {
        setTimeout(() => {
          const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
          if (pub && pub.track) {
            const nativeStr = pub.track.mediaStreamTrack;
            if (nativeStr) {
               const settings = nativeStr.getSettings();
               let surf = (settings.displaySurface as any) || 'unknown';
               if ((nativeStr as any).getCaptureHandle) {
                  const handle = (nativeStr as any).getCaptureHandle();
                  if (handle && handle.handle === 'kloudmeet') {
                     surf = 'current-tab';
                  }
               }
               setScreenShareSurface(surf);
            }
          }
        }, 500);
      } else {
        setScreenShareSurface('unknown');
      }
      setActiveView('shareScreen');
      // Broadcast to all: switch to shareScreen view
      if (screenShareActive) {
        broadcastViewChangeRef.current?.('shareScreen');
      }
    } else {
      setIsDrawingMode(false);
      setScreenShareSurface('unknown');
      setActiveView((prev) => {
        if (prev === 'shareScreen') {
          // Broadcast fallback to webcam
          broadcastViewChangeRef.current?.('webcam');
          return 'webcam';
        }
        return prev;
      });
    }
  }, [hasScreenShare, screenShareActive, room.localParticipant]);

  // Ref for broadcast function (defined later in DataChannel sync block)
  const broadcastViewChangeRef = React.useRef<((view: ViewMode) => void) | null>(null);

  const handleViewChange = React.useCallback((view: ViewMode) => {
    if (view !== 'shareScreen') {
      setIsDrawingMode(false);
      setIsRemoteControlMode(false);
      if (screenShareActive) {
        setScreenShareActive(false);
        room.localParticipant.setScreenShareEnabled(false).catch(console.error);
      }
    }
    setActiveView(view);
    // Broadcast view change to all participants
    broadcastViewChangeRef.current?.(view);
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
        .then(() => {
          // Auto-copy the meeting link to clipboard when joining to make it easy to invite others,
          // especially if the app goes to the background during screen sharing.
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(window.location.href).catch(console.error);
            console.log('Meeting URL auto-copied to clipboard!');
          }
        })
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
  // Mirror-blocked: presenter is sharing but it's NOT a safe "another tab" share
  const isMirrorBlocked = screenShareActive && screenShareSurface !== 'browser';

  // Determine if user can switch views (host = first joiner, or active presenter)
  const isHost = React.useMemo(() => {
    const allJoinTimes = [
      room.localParticipant.joinedAt?.getTime() || Infinity,
      ...Array.from(room.remoteParticipants.values()).map(p => p.joinedAt?.getTime() || Infinity)
    ];
    const earliest = Math.min(...allJoinTimes);
    return (room.localParticipant.joinedAt?.getTime() || Infinity) === earliest;
  }, [room.localParticipant, room.remoteParticipants]);
  const [presenterIdentity, setPresenterIdentity] = React.useState<string | null>(null);
  const isPresenter = presenterIdentity === room.localParticipant.identity;
  const canSwitchViews = isHost || isPresenter || screenShareActive;

  // ═══ Meeting Control Sync via DataChannel ═══
  const TOPIC = 'meeting-control';
  const encoder = React.useMemo(() => new TextEncoder(), []);
  const decoder = React.useMemo(() => new TextDecoder(), []);

  // Host's authoritative state (only used when isHost)
  const authState = React.useRef<{ view: ViewMode; presenter: string | null }>({
    view: activeView,
    presenter: null,
  });

  // Keep authState in sync when host changes view locally
  React.useEffect(() => {
    if (isHost) {
      authState.current.view = activeView;
    }
  }, [isHost, activeView]);

  // Helper: send a meeting control message
  const sendMeetingMsg = React.useCallback((msg: object, destinationIdentities?: string[]) => {
    const data = encoder.encode(JSON.stringify(msg));
    const opts: any = { reliable: true, topic: TOPIC };
    if (destinationIdentities) {
      opts.destinationIdentities = destinationIdentities;
    }
    room.localParticipant.publishData(data, opts).catch(() => {
      room.localParticipant.publishData(data, { topic: TOPIC, ...(destinationIdentities ? { destinationIdentities } : {}) }).catch(console.error);
    });
  }, [room, encoder]);

  // Host/Presenter: broadcast VIEW_CHANGE to all participants
  const broadcastViewChange = React.useCallback((view: ViewMode) => {
    if (isHost) {
      authState.current.view = view;
    }
    sendMeetingMsg({ type: 'VIEW_CHANGE', view });
  }, [isHost, sendMeetingMsg]);

  // Keep the ref in sync for handleViewChange
  React.useEffect(() => {
    broadcastViewChangeRef.current = broadcastViewChange;
  }, [broadcastViewChange]);

  // Listen for incoming DataChannel messages
  React.useEffect(() => {
    const handleData = (payload: Uint8Array, participant?: any, kind?: any, topic?: string) => {
      if (topic !== TOPIC) return;
      try {
        const msg = JSON.parse(decoder.decode(payload));
        const senderIdentity = participant?.identity;

        if (msg.type === 'VIEW_CHANGE') {
          // View change from host/presenter — update immediately
          setActiveView(msg.view as ViewMode);
        } else if (msg.type === 'CORRECTION') {
          // Correction from host — update to authoritative state
          setActiveView(msg.view as ViewMode);
          if (msg.presenter !== undefined) {
            setPresenterIdentity(msg.presenter);
          }
        } else if (msg.type === 'SET_PRESENTER') {
          setPresenterIdentity(msg.identity);
        } else if (msg.type === 'HEARTBEAT' && isHost && senderIdentity) {
          // Host receives heartbeat — compare and correct if needed
          const auth = authState.current;
          if (msg.view !== auth.view || msg.presenter !== (auth.presenter || null)) {
            // State differs — send correction to this participant only
            sendMeetingMsg(
              { type: 'CORRECTION', view: auth.view, presenter: auth.presenter },
              [senderIdentity]
            );
          }
        }
      } catch (e) {
        console.error('Meeting control message error:', e);
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => { room.off(RoomEvent.DataReceived, handleData); };
  }, [room, isHost, decoder, sendMeetingMsg]);

  // All participants: send heartbeat every 5s
  React.useEffect(() => {
    if (!room.localParticipant.identity) return;

    // Find host identity (earliest joiner)
    const getHostIdentity = () => {
      let earliestTime = room.localParticipant.joinedAt?.getTime() || Infinity;
      let hostId = room.localParticipant.identity;
      for (const [, p] of room.remoteParticipants) {
        const t = p.joinedAt?.getTime() || Infinity;
        if (t < earliestTime) {
          earliestTime = t;
          hostId = p.identity;
        }
      }
      return hostId;
    };

    const interval = setInterval(() => {
      const hostId = getHostIdentity();
      if (hostId === room.localParticipant.identity) return; // host doesn't heartbeat to itself
      sendMeetingMsg(
        { type: 'HEARTBEAT', view: activeView, presenter: presenterIdentity, identity: room.localParticipant.identity },
        [hostId]
      );
    }, 5000);

    return () => clearInterval(interval);
  }, [room, activeView, presenterIdentity, sendMeetingMsg]);

  // Draggable floating webcam panel state
  const floatingRef = React.useRef<HTMLDivElement>(null);
  const [floatingPos, setFloatingPos] = React.useState({ x: 12, y: 12 });
  const [floatingExpanded, setFloatingExpanded] = React.useState(false);
  const isDragging = React.useRef(false);
  const dragOffset = React.useRef({ x: 0, y: 0 });

  const handleFloatingMouseDown = React.useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragOffset.current = { x: e.clientX - floatingPos.x, y: e.clientY - floatingPos.y };
    e.preventDefault();
  }, [floatingPos]);

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      setFloatingPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
    };
    const handleMouseUp = () => { isDragging.current = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Chat overlay state
  const [chatOpen, setChatOpen] = React.useState(false);

  return (
    <div className="lk-room-container" style={{ position: 'relative', height: '100%' }}>
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />

        {/* View content area */}
        <div className="main-meeting-area" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', display: 'flex' }}>

          {/* Standalone LiveDoc (when user clicks LiveDoc tab, no screen share) */}
          {isPureLiveDoc && !hasScreenShare && (
             <div style={{ flex: 1, position: 'relative', overflow: 'auto' }}>
               <LiveDocView
                 roomName={displayRoomName}
                 participantName={props.userChoices.username}
               />
             </div>
          )}

          {/* VideoConference: always visible when not in pure LiveDoc mode */}
          <div 
            className={`sky-meet-video-wrapper ${isWebcamSidebarCollapsed ? 'sidebar-collapsed' : ''} ${screenShareActive ? 'presenter-sharing' : ''} ${isMirrorBlocked ? 'mirror-blocked' : ''}`} 
            style={{ 
              flex: 1, 
              position: 'relative', 
              display: (isPureLiveDoc && !hasScreenShare) ? 'none' : 'block' 
            }}>
             <VideoConference
               chatMessageFormatter={formatChatMessageLinks}
               SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
             />

             {/* Mirror-blocked: overlay LiveDoc on top of the entire screenshare view */}
             {hasScreenShare && isMirrorBlocked && (
                <div className="mirror-livedoc-overlay" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, overflow: 'auto', background: '#f5f5f5' }}>
                  <LiveDocView
                    roomName={displayRoomName}
                    participantName={props.userChoices.username}
                  />
                </div>
             )}

             {/* Safe preview badge (another tab only) */}
             {hasScreenShare && activeView === 'shareScreen' && !isMirrorBlocked && (
                <div className="screenshare-overlay-container">
                   <div className="screenshare-overlay-badge">
                      {!screenShareActive ? "Viewing [Attendee]'s screen." :
                       "Preview: Another Tab."}
                   </div>
                </div>
             )}

             {hasScreenShare && activeView === 'shareScreen' && isDesktop && (
               <>
                 <AnnotationCanvas isDrawingMode={isDrawingMode} />
                 <RemoteControlOverlay 
                   isActive={isRemoteControlMode} 
                   isPresenter={screenShareActive} 
                 />
               </>
             )}

             {/* Attendee sidebar collapse button (only for non-presenters watching screen share) */}
             {hasScreenShare && !screenShareActive && (
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
                 title={isWebcamSidebarCollapsed ? 'Expand Webcams' : 'Collapse Webcams'}
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

          {/* Floating draggable webcam pill — at main-meeting-area level for LiveDoc + ScreenShare */}
          {activeView !== 'webcam' && (screenShareActive || (activeView === 'liveDoc' && !hasScreenShare)) && (() => {
            const allParticipants = [
              { id: 'local', name: props.userChoices.username || 'You' },
              ...Array.from(room.remoteParticipants.values()).map(p => ({
                id: p.identity, name: p.name || p.identity || '??'
              }))
            ];
            const sortByJoinTime = (a: typeof allParticipants[0], b: typeof allParticipants[0]) => {
              const pA = a.id === 'local' ? room.localParticipant : room.remoteParticipants.get(a.id);
              const pB = b.id === 'local' ? room.localParticipant : room.remoteParticipants.get(b.id);
              return (pA?.joinedAt?.getTime() || 0) - (pB?.joinedAt?.getTime() || 0);
            };
            allParticipants.sort(sortByJoinTime);
            const maxVisible = 5;
            const overflow = allParticipants.length - maxVisible;

            return (
              <div
                ref={floatingRef}
                className={`floating-webcam-panel ${floatingExpanded ? 'expanded' : ''}`}
                onMouseDown={handleFloatingMouseDown}
                style={{
                  position: 'absolute',
                  top: floatingPos.y,
                  left: floatingPos.x,
                  zIndex: 200,
                  cursor: isDragging.current ? 'grabbing' : 'grab',
                  userSelect: 'none',
                }}
              >
                {!floatingExpanded && (
                  <div className="floating-collapsed-row">
                    <div className="floating-stacked-avatars">
                      {allParticipants.slice(0, maxVisible).map((p, i) => (
                        <div key={p.id} className="floating-avatar" title={p.name} style={{ zIndex: maxVisible - i }}>
                          {p.name.slice(0, 2).toUpperCase()}
                        </div>
                      ))}
                      {overflow > 0 && (
                        <div className="floating-avatar overflow-badge" style={{ zIndex: 0 }}>
                          +{overflow}
                        </div>
                      )}
                    </div>
                    <button
                      className="floating-chevron-btn"
                      onClick={(e) => { e.stopPropagation(); setFloatingExpanded(true); }}
                      onMouseDown={(e) => e.stopPropagation()}
                      title="Expand webcams"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 14, height: 14 }}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  </div>
                )}
                {floatingExpanded && (() => {
                  return (
                    <>
                      <div className="floating-expanded-header">
                        <span className="floating-expanded-title">{allParticipants.length} Participants</span>
                        <button
                          className="floating-chevron-btn up"
                          onClick={(e) => { e.stopPropagation(); setFloatingExpanded(false); }}
                          onMouseDown={(e) => e.stopPropagation()}
                          title="Collapse webcams"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 14, height: 14 }}>
                            <polyline points="18 15 12 9 6 15" />
                          </svg>
                        </button>
                      </div>
                      <div className="floating-expanded-grid">
                        {allParticipants.map((p) => {
                          const participant = p.id === 'local'
                            ? room.localParticipant
                            : room.remoteParticipants.get(p.id);
                          const camPub = participant?.getTrackPublication(Track.Source.Camera);
                          const hasVideo = camPub?.track && !camPub.isMuted;
                          return (
                            <div key={p.id} className="floating-grid-tile">
                              <div className="floating-grid-video">
                                {hasVideo && camPub?.track ? (
                                  <VideoTrack trackRef={{ participant: participant!, source: Track.Source.Camera, publication: camPub }} />
                                ) : (
                                  <div className="floating-grid-avatar">
                                    {p.name.slice(0, 2).toUpperCase()}
                                  </div>
                                )}
                              </div>
                              <span className="floating-grid-name">{p.name}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </div>
            );
          })()}

          {/* Chat overlay panel — works on all views */}
          {chatOpen && (
            <div className="chat-overlay-panel">
              <div className="chat-overlay-header">
                <span>Chat</span>
                <button className="chat-overlay-close" onClick={() => setChatOpen(false)}>✕</button>
              </div>
              <div className="chat-overlay-body">
                <Chat messageFormatter={formatChatMessageLinks} />
              </div>
            </div>
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
                .main-meeting-area {
                  flex-direction: column !important; /* Stack vertically */
                }
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

              /* 6. Presenter Sharing: hide webcam sidebar, show floating panel */
              .sky-meet-video-wrapper.presenter-sharing .lk-carousel {
                 display: none !important;
              }
              /* Mirror-block: NUCLEAR — hide ALL video wrapper content, only show LiveDoc overlay */
              .sky-meet-video-wrapper.mirror-blocked {
                 visibility: hidden !important;
              }
              .sky-meet-video-wrapper.mirror-blocked .mirror-livedoc-overlay,
              .sky-meet-video-wrapper.mirror-blocked .mirror-livedoc-overlay * {
                 visibility: visible !important;
              }
              .screenshare-overlay-badge {
                 background: rgba(0,0,0,0.75);
                 color: #fff;
                 padding: 8px 16px;
                 border-radius: 20px;
                 font-size: 14px;
                 font-weight: 500;
                 backdrop-filter: blur(8px);
                 border: 1px solid rgba(255,255,255,0.1);
                 box-shadow: 0 4px 12px rgba(0,0,0,0.5);
              }

            ` : ''}

            /* ═══ Always-available styles (floating panel, chat overlay) ═══ */

            /* Screenshare Overlays */
            .screenshare-overlay-container {
               position: absolute;
               top: 60px;
               left: 0;
               width: 100%;
               pointer-events: none;
               display: flex;
               justify-content: center;
               align-items: flex-start;
               z-index: 100;
            }
            @media (max-width: 768px) {
               .screenshare-overlay-container { width: 100%; left: 0; top: 32px; }
               .sky-meet-video-wrapper.hide-mirror-video { width: 100% !important; min-width: 0 !important; flex: 0 0 120px !important; }
            }

            .floating-webcam-panel {
               background: rgba(15, 23, 42, 0.9);
               backdrop-filter: blur(16px);
               border: 1px solid rgba(255,255,255,0.12);
               border-radius: 20px;
               padding: 6px 8px;
               box-shadow: 0 8px 32px rgba(0,0,0,0.45);
            }
            .floating-webcam-panel.expanded {
               border-radius: 16px;
               padding: 10px 12px;
               min-width: 200px;
            }
            .floating-collapsed-row {
               display: flex;
               align-items: center;
               gap: 6px;
            }
            .floating-stacked-avatars {
               display: flex;
               align-items: center;
            }
            .floating-stacked-avatars .floating-avatar {
               margin-left: -8px;
               transition: transform 0.15s ease;
            }
            .floating-stacked-avatars .floating-avatar:first-child {
               margin-left: 0;
            }
            .floating-stacked-avatars .floating-avatar:hover {
               transform: scale(1.15);
            }
            .floating-avatar {
               width: 30px;
               height: 30px;
               border-radius: 50%;
               background: linear-gradient(135deg, #3b82f6, #6366f1);
               color: #fff;
               font-size: 10px;
               font-weight: 700;
               display: flex;
               align-items: center;
               justify-content: center;
               border: 2px solid rgba(15, 23, 42, 0.9);
               flex-shrink: 0;
               position: relative;
            }
            .floating-avatar.overflow-badge {
               background: rgba(255,255,255,0.15);
               font-size: 10px;
               color: rgba(255,255,255,0.8);
               border-color: rgba(255,255,255,0.2);
            }
            .floating-chevron-btn {
               background: rgba(255,255,255,0.1);
               border: none;
               color: rgba(255,255,255,0.7);
               width: 24px;
               height: 24px;
               border-radius: 50%;
               cursor: pointer;
               display: flex;
               align-items: center;
               justify-content: center;
               transition: all 0.15s ease;
               flex-shrink: 0;
            }
            .floating-chevron-btn:hover {
               background: rgba(255,255,255,0.25);
               color: #fff;
            }
            .floating-expanded-header {
               display: flex;
               align-items: center;
               justify-content: space-between;
               margin-bottom: 8px;
            }
            .floating-expanded-title {
               color: rgba(255,255,255,0.5);
               font-size: 11px;
               font-weight: 600;
               text-transform: uppercase;
               letter-spacing: 0.5px;
            }
            .floating-expanded-grid {
               display: grid;
               grid-template-columns: repeat(3, 1fr);
               gap: 8px;
               max-height: 300px;
               overflow-y: auto;
            }
            .floating-grid-tile {
               display: flex;
               flex-direction: column;
               align-items: center;
               gap: 3px;
            }
            .floating-grid-video {
               width: 64px;
               height: 64px;
               border-radius: 10px;
               overflow: hidden;
               background: #1e293b;
               position: relative;
            }
            .floating-grid-video video {
               width: 100%;
               height: 100%;
               object-fit: cover;
            }
            .floating-grid-avatar {
               width: 100%;
               height: 100%;
               background: linear-gradient(135deg, #3b82f6, #6366f1);
               color: #fff;
               font-size: 16px;
               font-weight: 700;
               display: flex;
               align-items: center;
               justify-content: center;
            }
            .floating-grid-tile:hover .floating-grid-video {
               box-shadow: 0 0 0 2px #3b82f6;
            }
            .floating-grid-name {
               color: rgba(255,255,255,0.6);
               font-size: 9px;
               font-weight: 500;
               max-width: 72px;
               overflow: hidden;
               text-overflow: ellipsis;
               white-space: nowrap;
               text-align: center;
            }

            /* 8. Chat Overlay Panel — always available */
            .chat-overlay-panel {
               position: absolute;
               bottom: 70px;
               right: 16px;
               width: 320px;
               height: 420px;
               background: rgba(15, 23, 42, 0.92);
               backdrop-filter: blur(20px);
               border: 1px solid rgba(255,255,255,0.12);
               border-radius: 16px;
               box-shadow: 0 12px 40px rgba(0,0,0,0.5);
               z-index: 300;
               display: flex;
               flex-direction: column;
               overflow: hidden;
            }
            .chat-overlay-header {
               display: flex;
               align-items: center;
               justify-content: space-between;
               padding: 12px 16px;
               border-bottom: 1px solid rgba(255,255,255,0.08);
               color: #fff;
               font-size: 14px;
               font-weight: 600;
            }
            .chat-overlay-close {
               background: rgba(255,255,255,0.1);
               border: none;
               color: rgba(255,255,255,0.7);
               width: 28px;
               height: 28px;
               border-radius: 50%;
               cursor: pointer;
               font-size: 14px;
               display: flex;
               align-items: center;
               justify-content: center;
               transition: all 0.15s ease;
            }
            .chat-overlay-close:hover {
               background: rgba(255,255,255,0.25);
               color: #fff;
            }
            .chat-overlay-body {
               flex: 1;
               overflow: hidden;
               display: flex;
               flex-direction: column;
            }
            .chat-overlay-body .lk-chat {
               height: 100% !important;
               background: transparent !important;
               border: none !important;
            }
            .chat-overlay-body .lk-chat-messages {
               flex: 1;
               overflow-y: auto;
               padding: 8px;
            }
            .chat-overlay-body .lk-chat-form {
               padding: 8px;
               border-top: 1px solid rgba(255,255,255,0.08);
            }
            .chat-overlay-body .lk-chat-form input {
               background: rgba(255,255,255,0.08) !important;
               border: 1px solid rgba(255,255,255,0.12) !important;
               color: #fff !important;
               border-radius: 8px !important;
            }
            @media (max-width: 768px) {
               .chat-overlay-panel {
                  width: calc(100% - 32px);
                  left: 16px;
                  right: 16px;
                  height: 50vh;
               }
            }
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
          isDrawingMode={isDrawingMode}
          onToggleDrawingMode={() => {
            if (hasScreenShare) setIsDrawingMode(prev => !prev);
          }}
          isRemoteControlMode={isRemoteControlMode}
          onToggleRemoteControlMode={() => {
            if (hasScreenShare) setIsRemoteControlMode(prev => !prev);
          }}
          hasScreenShare={hasScreenShare}
          isDesktop={isDesktop}
          canSwitchViews={canSwitchViews}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen(prev => !prev)}
        />

        <DebugMode />
        <RecordingIndicator />
      </RoomContext.Provider>
    </div>
  );
}
