'use client';

import React from 'react';
import { Track } from 'livekit-client';
import {
  TrackToggle,
  MediaDeviceMenu,
  ParticipantPlaceholder,
  usePersistentUserChoices,
  usePreviewTracks,
} from '@livekit/components-react';
import type { LocalUserChoices } from '@livekit/components-react';

export interface KloudPreJoinProps {
  defaults?: Partial<LocalUserChoices>;
  onSubmit: (values: LocalUserChoices) => void;
  onError?: (error: Error) => void;
  joinLabel: string;
  userLabel: string;
  micLabel: string;
  camLabel: string;
  mediaUnavailableLabel?: string;
  joinButtonDisabled?: boolean;
  children?: React.ReactNode;
}

export function KloudPreJoin({
  defaults = {},
  onSubmit,
  onError,
  joinLabel,
  userLabel,
  micLabel,
  camLabel,
  mediaUnavailableLabel,
  joinButtonDisabled = false,
  children,
}: KloudPreJoinProps) {
  const canUseMediaDevices =
    typeof navigator !== 'undefined' &&
    typeof window !== 'undefined' &&
    !!window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!navigator.mediaDevices?.enumerateDevices;

  const {
    userChoices: initialUserChoices,
    saveAudioInputEnabled,
    saveVideoInputEnabled,
    saveAudioInputDeviceId,
    saveVideoInputDeviceId,
    saveUsername,
  } = usePersistentUserChoices({ defaults });

  const [audioEnabled, setAudioEnabled] = React.useState<boolean>(initialUserChoices.audioEnabled);
  const [videoEnabled, setVideoEnabled] = React.useState<boolean>(initialUserChoices.videoEnabled);
  const [audioDeviceId, setAudioDeviceId] = React.useState<string>(initialUserChoices.audioDeviceId);
  const [videoDeviceId, setVideoDeviceId] = React.useState<string>(initialUserChoices.videoDeviceId);
  const [username, setUsername] = React.useState(initialUserChoices.username);

  React.useEffect(() => { saveAudioInputEnabled(audioEnabled); }, [audioEnabled, saveAudioInputEnabled]);
  React.useEffect(() => { saveVideoInputEnabled(videoEnabled); }, [videoEnabled, saveVideoInputEnabled]);
  React.useEffect(() => { saveAudioInputDeviceId(audioDeviceId); }, [audioDeviceId, saveAudioInputDeviceId]);
  React.useEffect(() => { saveVideoInputDeviceId(videoDeviceId); }, [videoDeviceId, saveVideoInputDeviceId]);
  React.useEffect(() => { saveUsername(username); }, [username, saveUsername]);

  const tracks = usePreviewTracks(
    {
      audio: canUseMediaDevices && audioEnabled ? { deviceId: audioDeviceId } : false,
      video: canUseMediaDevices && videoEnabled ? { deviceId: videoDeviceId } : false,
    },
    onError,
  );

  const videoEl = React.useRef<HTMLVideoElement | null>(null);

  const videoTrack = React.useMemo(
    () => tracks?.filter((t) => t.kind === Track.Kind.Video)[0] as any,
    [tracks],
  );

  const audioTrack = React.useMemo(
    () => tracks?.filter((t) => t.kind === Track.Kind.Audio)[0] as any,
    [tracks],
  );

  const facingMode = React.useMemo(() => {
    if (!videoTrack) return 'undefined';
    try {
      return videoTrack.getFacingMode?.() ?? 'undefined';
    } catch {
      return 'undefined';
    }
  }, [videoTrack]);

  React.useEffect(() => {
    if (videoEl.current && videoTrack) {
      videoTrack.unmute();
      videoTrack.attach(videoEl.current);
    }
    return () => { videoTrack?.detach(); };
  }, [videoTrack]);

  const isValid = React.useMemo(() => username.trim() !== '', [username]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    onSubmit({
      username,
      videoEnabled: canUseMediaDevices ? videoEnabled : false,
      videoDeviceId,
      audioEnabled: canUseMediaDevices ? audioEnabled : false,
      audioDeviceId,
    });
  }

  return (
    <div className="kloud-prejoin-card">
      {/* Video preview */}
      <div className="kloud-prejoin-video-preview">
        {videoTrack && videoEnabled ? (
          <video
            ref={videoEl}
            width={1280}
            height={720}
            data-lk-facing-mode={facingMode}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <ParticipantPlaceholder />
        )}
      </div>

      {/* Mic + Camera controls */}
      <div className="kloud-prejoin-device-controls">
        {canUseMediaDevices ? (
          <>
            <div className="kloud-prejoin-device-group lk-button-group">
              <TrackToggle
                initialState={audioEnabled}
                source={Track.Source.Microphone}
                onChange={(enabled) => setAudioEnabled(enabled)}
                showIcon
              >
                {micLabel}
              </TrackToggle>
              <div className="lk-button-group-menu">
                <MediaDeviceMenu
                  initialSelection={audioDeviceId}
                  kind="audioinput"
                  requestPermissions
                  tracks={{ audioinput: audioTrack }}
                  onActiveDeviceChange={(_, id) => setAudioDeviceId(id)}
                />
              </div>
            </div>
            <div className="kloud-prejoin-device-group lk-button-group">
              <TrackToggle
                initialState={videoEnabled}
                source={Track.Source.Camera}
                onChange={(enabled) => setVideoEnabled(enabled)}
                showIcon
              >
                {camLabel}
              </TrackToggle>
              <div className="lk-button-group-menu">
                <MediaDeviceMenu
                  initialSelection={videoDeviceId}
                  kind="videoinput"
                  requestPermissions
                  tracks={{ videoinput: videoTrack }}
                  onActiveDeviceChange={(_, id) => setVideoDeviceId(id)}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="kloud-prejoin-device-group lk-button-group">
              <button type="button" className="lk-button" disabled>
                {micLabel}
              </button>
              <button type="button" className="lk-button lk-button-menu" disabled>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            </div>
            <div className="kloud-prejoin-device-group lk-button-group">
              <button type="button" className="lk-button" disabled>
                {camLabel}
              </button>
              <button type="button" className="lk-button lk-button-menu" disabled>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
      {!canUseMediaDevices && mediaUnavailableLabel && (
        <p className="kloud-prejoin-media-unavailable" role="status">
          {mediaUnavailableLabel}
        </p>
      )}

      {/* Name field */}
      <div className="kloud-prejoin-name-row">
        <label htmlFor="kloud-prejoin-username">{userLabel}</label>
        <input
          id="kloud-prejoin-username"
          className="lk-form-control"
          type="text"
          defaultValue={username}
          placeholder={userLabel}
          autoComplete="off"
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>

      {/* Injected children: share link, personal room checkbox */}
      {children}

      {/* Join button */}
      <button
        type="submit"
        className="kloud-prejoin-join-btn"
        onClick={handleSubmit}
        disabled={!isValid || joinButtonDisabled}
      >
        {joinLabel}
      </button>
    </div>
  );
}
