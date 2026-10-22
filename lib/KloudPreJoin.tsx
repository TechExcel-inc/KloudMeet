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
import styles from '../styles/PreJoin.module.css';
import { useI18n } from './i18n';

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
  /** 发起人准备页：始终默认打开麦克风（可随后再手动关闭） */
  forceAudioEnabled?: boolean;
  /** Right-column heading (e.g. "Starting Meeting"). */
  title?: React.ReactNode;
  /** Right-column sub-heading. */
  subtitle?: React.ReactNode;
  /** Render the subtitle as a highlighted status notice (e.g. "already hosting in another session"). */
  subtitleIsNotice?: boolean;
  /** Rendered directly under the join button (e.g. "Or start a new meeting instead"). */
  joinFooter?: React.ReactNode;
  /** Rendered at the bottom of the right column (share link, desktop app entry). */
  footer?: React.ReactNode;
  /** Rendered between the name field and the join button (host options). */
  children?: React.ReactNode;
}

/** Returns the translation, or `fallback` when the key is not in any locale yet. */
function useTextWithFallback() {
  const { t } = useI18n();
  return React.useCallback(
    (key: string, fallback: string) => {
      const value = t(key);
      return value === key ? fallback : value;
    },
    [t],
  );
}

/**
 * Shows the label of the currently selected capture device on the device chip.
 * Uses enumerateDevices only (never getUserMedia), so it can't trigger a permission prompt.
 */
function DeviceChipLabel({
  kind,
  deviceId,
  fallback,
  refreshKey,
}: {
  kind: MediaDeviceKind;
  deviceId: string;
  fallback: string;
  refreshKey?: unknown;
}) {
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);

  React.useEffect(() => {
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const load = () => {
      mediaDevices
        .enumerateDevices()
        .then((list) => {
          if (!cancelled) setDevices(list.filter((d) => d.kind === kind));
        })
        .catch(() => {
          /* label is cosmetic; ignore */
        });
    };
    load();
    mediaDevices.addEventListener?.('devicechange', load);
    return () => {
      cancelled = true;
      mediaDevices.removeEventListener?.('devicechange', load);
    };
  }, [kind, refreshKey]);

  const match =
    devices.find((d) => d.deviceId === deviceId) ??
    devices.find((d) => d.deviceId === 'default') ??
    devices[0];
  const label = match?.label?.trim();
  return <span className={styles.chipLabel}>{label || fallback}</span>;
}

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className={styles.chipIcon}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0014 0M12 18v3" />
  </svg>
);

const CamIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={styles.chipIcon}>
    <rect x="3" y="6" width="12" height="12" rx="3" />
    <path d="M15 10l6-3v10l-6-3z" />
  </svg>
);

const Caret = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" className={styles.chipCaret}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const MicOffIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M9 9v2a3 3 0 005 2.2M15 9.3V6a3 3 0 00-5.6-1.5M5 11a7 7 0 0011.5 5.4M19 11a7 7 0 01-.6 2.8M12 18v3M3 3l18 18" />
  </svg>
);

const CamOffIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 10l6-3v10l-6-3M15 13.5V16a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h2M11 6h2a2 2 0 012 2v2M3 3l18 18" />
  </svg>
);

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
  forceAudioEnabled = false,
  title,
  subtitle,
  subtitleIsNotice = false,
  joinFooter,
  footer,
  children,
}: KloudPreJoinProps) {
  const tf = useTextWithFallback();
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

  const [audioEnabled, setAudioEnabled] = React.useState<boolean>(
    forceAudioEnabled ? true : initialUserChoices.audioEnabled,
  );
  const [videoEnabled, setVideoEnabled] = React.useState<boolean>(initialUserChoices.videoEnabled);
  const [audioDeviceId, setAudioDeviceId] = React.useState<string>(initialUserChoices.audioDeviceId);
  const [videoDeviceId, setVideoDeviceId] = React.useState<string>(initialUserChoices.videoDeviceId);
  const [username, setUsername] = React.useState(initialUserChoices.username);
  const [micToggleEpoch, setMicToggleEpoch] = React.useState(0);
  const hostMicForcedRef = React.useRef(forceAudioEnabled);

  // 发起人身份晚于首屏就绪时补开麦克风，并同步 TrackToggle 初始态
  React.useEffect(() => {
    if (!forceAudioEnabled || hostMicForcedRef.current) return;
    hostMicForcedRef.current = true;
    setAudioEnabled(true);
    setMicToggleEpoch((n) => n + 1);
  }, [forceAudioEnabled]);

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

  const trimmedName = username.trim();
  const showVideo = !!(videoTrack && videoEnabled);
  const micShownOn = canUseMediaDevices && audioEnabled;
  const cameraOffLabel = tf('prejoin.cameraIsOff', 'Camera is off');
  const nameRequiredLabel = tf('prejoin.enterNameToJoin', 'Enter your name to join');

  return (
    <div className={styles.layout}>
      {/* ── Left: preview + devices ── */}
      <section className={styles.stage}>
        <div className={styles.preview}>
          {showVideo ? (
            <video
              ref={videoEl}
              width={1280}
              height={720}
              data-lk-facing-mode={facingMode}
              className={styles.video}
            />
          ) : (
            <div className={styles.placeholder}>
              {trimmedName ? (
                <div className={styles.avatar} aria-hidden="true">
                  {Array.from(trimmedName)[0]}
                </div>
              ) : (
                <div className={styles.placeholderSvg} aria-hidden="true">
                  <ParticipantPlaceholder />
                </div>
              )}
              <span className={styles.camOffText}>{cameraOffLabel}</span>
            </div>
          )}

          {trimmedName && (
            <div className={styles.previewName}>
              <span>{trimmedName}</span>
              {!micShownOn && (
                <span className={styles.mutedBadge} aria-hidden="true">
                  <MicOffIcon size={14} />
                </span>
              )}
            </div>
          )}

          {/* Mic + Camera toggles */}
          <div className={styles.previewControls}>
            {canUseMediaDevices ? (
              <>
                <TrackToggle
                  key={`mic-${micToggleEpoch}`}
                  initialState={audioEnabled}
                  source={Track.Source.Microphone}
                  onChange={(enabled) => setAudioEnabled(enabled)}
                  showIcon
                  className={styles.roundToggle}
                  title={micLabel}
                >
                  <span className={styles.srOnly}>{micLabel}</span>
                </TrackToggle>
                <TrackToggle
                  initialState={videoEnabled}
                  source={Track.Source.Camera}
                  onChange={(enabled) => setVideoEnabled(enabled)}
                  showIcon
                  className={styles.roundToggle}
                  title={camLabel}
                >
                  <span className={styles.srOnly}>{camLabel}</span>
                </TrackToggle>
              </>
            ) : (
              <>
                <button type="button" className={styles.roundToggle} aria-pressed={false} disabled title={micLabel}>
                  <MicOffIcon />
                  <span className={styles.srOnly}>{micLabel}</span>
                </button>
                <button type="button" className={styles.roundToggle} aria-pressed={false} disabled title={camLabel}>
                  <CamOffIcon />
                  <span className={styles.srOnly}>{camLabel}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Device chips with dropdown menus */}
        <div className={styles.chips}>
          {canUseMediaDevices ? (
            <>
              <div className={styles.chipWrap}>
                <MediaDeviceMenu
                  className={styles.chip}
                  initialSelection={audioDeviceId}
                  kind="audioinput"
                  requestPermissions
                  tracks={{ audioinput: audioTrack }}
                  onActiveDeviceChange={(_, id) => setAudioDeviceId(id)}
                  aria-haspopup="listbox"
                  title={micLabel}
                >
                  <MicIcon />
                  <DeviceChipLabel kind="audioinput" deviceId={audioDeviceId} fallback={micLabel} refreshKey={audioTrack} />
                  <Caret />
                </MediaDeviceMenu>
              </div>
              <div className={styles.chipWrap}>
                <MediaDeviceMenu
                  className={styles.chip}
                  initialSelection={videoDeviceId}
                  kind="videoinput"
                  requestPermissions
                  tracks={{ videoinput: videoTrack }}
                  onActiveDeviceChange={(_, id) => setVideoDeviceId(id)}
                  aria-haspopup="listbox"
                  title={camLabel}
                >
                  <CamIcon />
                  <DeviceChipLabel kind="videoinput" deviceId={videoDeviceId} fallback={camLabel} refreshKey={videoTrack} />
                  <Caret />
                </MediaDeviceMenu>
              </div>
            </>
          ) : (
            <>
              <div className={styles.chipWrap}>
                <button type="button" className={styles.chip} disabled>
                  <MicIcon />
                  <span className={styles.chipLabel}>{micLabel}</span>
                  <Caret />
                </button>
              </div>
              <div className={styles.chipWrap}>
                <button type="button" className={styles.chip} disabled>
                  <CamIcon />
                  <span className={styles.chipLabel}>{camLabel}</span>
                  <Caret />
                </button>
              </div>
            </>
          )}
        </div>
        {!canUseMediaDevices && mediaUnavailableLabel && (
          <p className={styles.mediaNote} role="status">
            {mediaUnavailableLabel}
          </p>
        )}
      </section>

      {/* ── Right: heading, name, options, join ── */}
      <section className={styles.panel}>
        {(title || subtitle) && (
          <div className={styles.heading}>
            {title && <h1 className={styles.title}>{title}</h1>}
            {subtitle &&
              (subtitleIsNotice ? (
                <p className={styles.notice} role="status">
                  {subtitle}
                </p>
              ) : (
                <p className={styles.subtitle}>{subtitle}</p>
              ))}
          </div>
        )}

        {/* Name field */}
        <label className={styles.field} htmlFor="kloud-prejoin-username">
          <input
            id="kloud-prejoin-username"
            className={styles.fieldInput}
            type="text"
            defaultValue={username}
            autoComplete="off"
            aria-required="true"
            aria-describedby={!isValid ? 'kloud-prejoin-join-reason' : undefined}
            onChange={(e) => setUsername(e.target.value)}
          />
          <span className={styles.fieldLabel}>{userLabel}</span>
        </label>

        {/* Injected children: host options */}
        {children}

        {/* Join button */}
        <div className={styles.joinArea}>
          <button
            type="submit"
            className={styles.joinBtn}
            onClick={handleSubmit}
            disabled={!isValid || joinButtonDisabled}
            aria-busy={joinButtonDisabled || undefined}
          >
            {joinLabel}
          </button>
          {!isValid && (
            <span id="kloud-prejoin-join-reason" className={styles.joinReason}>
              {nameRequiredLabel}
            </span>
          )}
          {joinFooter}
        </div>

        {footer}
      </section>
    </div>
  );
}
