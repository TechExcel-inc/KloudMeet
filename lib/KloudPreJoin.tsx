'use client';

import React from 'react';
import { Track } from 'livekit-client';
import {
  MediaDeviceMenu,
  usePersistentUserChoices,
  usePreviewTracks,
} from '@livekit/components-react';
import type { LocalUserChoices } from '@livekit/components-react';
import { ChevronDown, Mic, MicOff, TriangleAlert, Video, VideoOff, Volume2 } from 'lucide-react';
import styles from '../styles/PreJoin.module.css';
import { useI18n } from './i18n';
import { saveAudioOutputDeviceId, loadAudioOutputDeviceId } from './audioOutputChoice';
import { classifyDeviceError, type DeviceIssue } from './deviceIssue';

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
  /** Right-column heading (e.g. "Ready to start?"). */
  title?: React.ReactNode;
  /** Right-column sub-heading. */
  subtitle?: React.ReactNode;
  /** Render the subtitle as a highlighted status notice (e.g. "already hosting in another session"). */
  subtitleIsNotice?: boolean;
  /** Rendered directly under the join button (e.g. "Or start a new meeting instead"). */
  joinFooter?: React.ReactNode;
  /** Rendered at the bottom of the right column (share link, desktop app entry). */
  footer?: React.ReactNode;
  /** Rendered above the name field (host meeting settings). */
  beforeName?: React.ReactNode;
  /** Rendered between the name field and the join button (host options). */
  children?: React.ReactNode;
  /** Small note rendered after the device chips, beside the camera (e.g. "No one else is here yet"). */
  nobodyHereText?: React.ReactNode;
}

type DeviceStatus = 'off' | 'starting' | 'live' | 'error';

/**
 * Preview state for one capture device. usePreviewTracks keeps its last tracks when a new
 * attempt fails or the device is turned off, so "live" is tracked per attempt, not inferred
 * from whether a track exists.
 */
function useDevicePreview(
  kind: 'audio' | 'video',
  enabled: boolean,
  deviceId: string,
  onError?: (e: Error) => void,
) {
  const attempt = enabled ? `${kind}:${deviceId}` : 'off';
  const attemptRef = React.useRef(attempt);
  attemptRef.current = attempt;
  const [result, setResult] = React.useState<{ attempt: string; issue?: DeviceIssue; track?: any }>(
    { attempt: 'off' },
  );

  const handleError = React.useCallback(
    (error: Error) => {
      setResult({ attempt: attemptRef.current, issue: classifyDeviceError(error) });
      onError?.(error);
    },
    [onError],
  );

  const tracks = usePreviewTracks(
    {
      audio: kind === 'audio' && enabled ? { deviceId } : false,
      video: kind === 'video' && enabled ? { deviceId } : false,
    },
    handleError,
  );

  React.useEffect(() => {
    const track = tracks?.find(
      (t) => t.kind === (kind === 'audio' ? Track.Kind.Audio : Track.Kind.Video),
    );
    if (track && attemptRef.current !== 'off') setResult({ attempt: attemptRef.current, track });
  }, [tracks, kind]);

  const current = result.attempt === attempt ? result : undefined;
  const status: DeviceStatus = !enabled
    ? 'off'
    : current?.issue
      ? 'error'
      : current?.track
        ? 'live'
        : 'starting';
  return { status, issue: current?.issue, track: status === 'live' ? current?.track : undefined };
}

/**
 * Writes the microphone's loudness (0–1) to `--km-level` on the given elements, so CSS can
 * animate a speaking ring without re-rendering React on every frame.
 */
function useMicLevel(
  mediaStreamTrack: MediaStreamTrack | undefined,
  targets: React.RefObject<HTMLElement | null>[],
) {
  React.useEffect(() => {
    const els = () => targets.map((r) => r.current).filter(Boolean) as HTMLElement[];
    const reset = () => els().forEach((el) => el.style.setProperty('--km-level', '0'));
    if (!mediaStreamTrack || typeof window === 'undefined' || !window.AudioContext) {
      reset();
      return;
    }
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let level = 0;
    let frame = 0;
    // Audio contexts start suspended until the page has had a user gesture.
    const resume = () => void ctx.resume().catch(() => {});
    resume();
    window.addEventListener('pointerdown', resume);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const target = Math.min(1, Math.sqrt(sum / data.length) * 6);
      level = target > level ? target : level * 0.85 + target * 0.15;
      const value = level < 0.04 ? '0' : level.toFixed(3);
      els().forEach((el) => el.style.setProperty('--km-level', value));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', resume);
      source.disconnect();
      void ctx.close().catch(() => {});
      reset();
    };
    // targets are stable refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaStreamTrack]);
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
 * Shows the label of the currently selected device on the device chip.
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

/** A calm, stable background tint per name, like a blurred profile photo. */
function tileBackground(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) | 0;
  const hue = 170 + (Math.abs(hash) % 90); // teal → blue → indigo
  return `radial-gradient(120% 120% at 75% 15%, hsl(${hue} 28% 42%), hsl(${hue + 20} 38% 24%) 70%)`;
}

const canPickSpeaker =
  typeof window !== 'undefined' &&
  typeof HTMLMediaElement !== 'undefined' &&
  'setSinkId' in HTMLMediaElement.prototype;

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
  beforeName,
  children,
  nobodyHereText,
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
  const [audioDeviceId, setAudioDeviceId] = React.useState<string>(
    initialUserChoices.audioDeviceId,
  );
  const [videoDeviceId, setVideoDeviceId] = React.useState<string>(
    initialUserChoices.videoDeviceId,
  );
  const [outputDeviceId, setOutputDeviceId] = React.useState<string>(
    () => loadAudioOutputDeviceId() ?? 'default',
  );
  const [username, setUsername] = React.useState(initialUserChoices.username);
  const hostMicForcedRef = React.useRef(forceAudioEnabled);

  // 发起人身份晚于首屏就绪时补开麦克风
  React.useEffect(() => {
    if (!forceAudioEnabled || hostMicForcedRef.current) return;
    hostMicForcedRef.current = true;
    setAudioEnabled(true);
  }, [forceAudioEnabled]);

  React.useEffect(() => {
    saveAudioInputEnabled(audioEnabled);
  }, [audioEnabled, saveAudioInputEnabled]);
  React.useEffect(() => {
    saveVideoInputEnabled(videoEnabled);
  }, [videoEnabled, saveVideoInputEnabled]);
  React.useEffect(() => {
    saveAudioInputDeviceId(audioDeviceId);
  }, [audioDeviceId, saveAudioInputDeviceId]);
  React.useEffect(() => {
    saveVideoInputDeviceId(videoDeviceId);
  }, [videoDeviceId, saveVideoInputDeviceId]);
  React.useEffect(() => {
    saveUsername(username);
  }, [username, saveUsername]);

  const mic = useDevicePreview('audio', canUseMediaDevices && audioEnabled, audioDeviceId, onError);
  const cam = useDevicePreview('video', canUseMediaDevices && videoEnabled, videoDeviceId, onError);

  // A capture request that hasn't settled after a few seconds is almost always waiting on the
  // browser's permission prompt; say so instead of "Starting camera…" forever.
  const [waitingForPermission, setWaitingForPermission] = React.useState(false);
  const anyStarting = cam.status === 'starting' || mic.status === 'starting';
  React.useEffect(() => {
    setWaitingForPermission(false);
    if (!anyStarting) return;
    const timer = window.setTimeout(() => setWaitingForPermission(true), 3000);
    return () => window.clearTimeout(timer);
  }, [anyStarting]);

  const videoEl = React.useRef<HTMLVideoElement | null>(null);
  const avatarRef = React.useRef<HTMLDivElement | null>(null);
  const micBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const levelBadgeRef = React.useRef<HTMLSpanElement | null>(null);
  useMicLevel(mic.track?.mediaStreamTrack, [avatarRef, micBtnRef, levelBadgeRef]);

  const facingMode = React.useMemo(() => {
    if (!cam.track) return 'undefined';
    try {
      return cam.track.getFacingMode?.() ?? 'undefined';
    } catch {
      return 'undefined';
    }
  }, [cam.track]);

  React.useEffect(() => {
    const track = cam.track;
    if (videoEl.current && track) {
      track.unmute();
      track.attach(videoEl.current);
    }
    return () => {
      track?.detach();
    };
  }, [cam.track]);

  /** Turning a failed device off and on again makes the preview hook request it afresh. */
  const retry = (set: React.Dispatch<React.SetStateAction<boolean>>) => {
    set(false);
    requestAnimationFrame(() => set(true));
  };

  const isValid = React.useMemo(() => username.trim() !== '', [username]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    saveAudioOutputDeviceId(outputDeviceId);
    onSubmit({
      username,
      videoEnabled: canUseMediaDevices ? videoEnabled : false,
      videoDeviceId,
      audioEnabled: canUseMediaDevices ? audioEnabled : false,
      audioDeviceId,
    });
  }

  const trimmedName = username.trim();
  const nameRequiredLabel = tf('prejoin.enterNameToJoin', 'Enter your name to join');
  const tryAgainLabel = tf('prejoin.tryAgain', 'Try again');

  const cameraText: Record<DeviceIssue | 'off' | 'starting', [string, string?]> = {
    off: [tf('prejoin.cameraIsOff', 'Camera is off')],
    starting: [tf('prejoin.cameraStarting', 'Starting camera…')],
    blocked: [
      tf('prejoin.cameraBlocked', 'Camera access is blocked'),
      tf(
        'prejoin.cameraBlockedHint',
        "Allow camera access in your browser's address bar, then try again.",
      ),
    ],
    'in-use': [
      tf('prejoin.cameraInUse', 'Your camera is in use by another app'),
      tf(
        'prejoin.cameraInUseHint',
        'Close the other app or pick a different camera, then try again.',
      ),
    ],
    'not-found': [
      tf('prejoin.cameraNotFound', 'No camera found'),
      tf('prejoin.cameraNotFoundHint', 'Connect a camera or pick a different one below.'),
    ],
    failed: [
      tf('prejoin.cameraFailed', "Your camera couldn't start"),
      tf('prejoin.cameraFailedHint', 'Pick a different camera below, or try again.'),
    ],
  };
  const micText: Record<DeviceIssue, string> = {
    blocked: tf(
      'prejoin.micBlocked',
      "Microphone access is blocked. Allow it in your browser's address bar, then try again.",
    ),
    'in-use': tf(
      'prejoin.micInUse',
      'Your microphone is in use by another app. Close it or pick a different mic.',
    ),
    'not-found': tf(
      'prejoin.micNotFound',
      'No microphone found. Connect one or pick a different one below.',
    ),
    failed: tf(
      'prejoin.micFailed',
      "Your microphone couldn't start. Pick a different one below, or try again.",
    ),
  };
  const [camTitle, camHint] =
    waitingForPermission && cam.status !== 'error' && cam.status !== 'live'
      ? [tf('prejoin.allowPermission', 'Allow camera and microphone when your browser asks')]
      : cameraText[
          cam.status === 'error'
            ? (cam.issue ?? 'failed')
            : cam.status === 'starting'
              ? 'starting'
              : 'off'
        ];

  const micOn = mic.status !== 'off';
  const camOn = cam.status !== 'off';
  const micToggleLabel = micOn
    ? tf('toolbar.muteMic', 'Turn off microphone')
    : tf('toolbar.unmuteMic', 'Turn on microphone');
  const camToggleLabel = camOn
    ? tf('toolbar.turnOffCam', 'Turn off camera')
    : tf('toolbar.turnOnCam', 'Turn on camera');

  return (
    <div className={styles.layout}>
      {/* ── Left: preview + devices ── */}
      <section className={styles.stage}>
        <div
          className={styles.preview}
          style={
            cam.status === 'live' ? undefined : { background: tileBackground(trimmedName || '?') }
          }
        >
          {cam.status === 'live' ? (
            <video
              ref={videoEl}
              width={1280}
              height={720}
              data-lk-facing-mode={facingMode}
              className={styles.video}
            />
          ) : (
            <div className={styles.placeholder}>
              {cam.status === 'error' ? (
                <div className={styles.deviceIssue} role="status">
                  <TriangleAlert size={28} strokeWidth={1.75} aria-hidden="true" />
                  <span className={styles.camOffText}>{camTitle}</span>
                  {camHint && <span className={styles.camOffHint}>{camHint}</span>}
                  <button
                    type="button"
                    className={styles.issueBtn}
                    onClick={() => retry(setVideoEnabled)}
                  >
                    {tryAgainLabel}
                  </button>
                </div>
              ) : (
                <>
                  <div
                    ref={avatarRef}
                    className={`${styles.avatar}${mic.status === 'live' ? ` ${styles.avatarSpeaking}` : ''}`}
                    aria-hidden="true"
                  >
                    {trimmedName ? Array.from(trimmedName)[0] : '?'}
                  </div>
                  <span className={styles.camOffText} role="status">
                    {camTitle}
                  </span>
                </>
              )}
            </div>
          )}

          {trimmedName && (
            <div className={styles.previewName}>
              <span>{trimmedName}</span>
            </div>
          )}

          {/* Speaking indicator / muted badge, top-right like a meeting tile */}
          {mic.status === 'live' ? (
            <span ref={levelBadgeRef} className={styles.levelBadge} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : (
            !micOn && (
              <span className={styles.mutedBadge} aria-hidden="true">
                <MicOff size={16} />
              </span>
            )
          )}

          {/* Mic + Camera toggles */}
          <div className={styles.previewControls}>
            <button
              ref={micBtnRef}
              type="button"
              className={styles.roundToggle}
              data-state={mic.status}
              aria-pressed={micOn}
              aria-label={micToggleLabel}
              title={micToggleLabel}
              disabled={!canUseMediaDevices}
              onClick={() =>
                mic.status === 'error' ? retry(setAudioEnabled) : setAudioEnabled((v) => !v)
              }
            >
              {micOn ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
              {mic.status === 'error' && (
                <span className={styles.toggleAlert} aria-hidden="true">
                  <TriangleAlert size={12} strokeWidth={2.5} />
                </span>
              )}
            </button>
            <button
              type="button"
              className={styles.roundToggle}
              data-state={cam.status}
              aria-pressed={camOn}
              aria-label={camToggleLabel}
              title={camToggleLabel}
              disabled={!canUseMediaDevices}
              onClick={() =>
                cam.status === 'error' ? retry(setVideoEnabled) : setVideoEnabled((v) => !v)
              }
            >
              {camOn ? <Video aria-hidden="true" /> : <VideoOff aria-hidden="true" />}
              {cam.status === 'error' && (
                <span className={styles.toggleAlert} aria-hidden="true">
                  <TriangleAlert size={12} strokeWidth={2.5} />
                </span>
              )}
            </button>
          </div>
        </div>

        {mic.status === 'error' && (
          <p className={styles.mediaNote} role="status">
            <span>{micText[mic.issue ?? 'failed']}</span>
            <button type="button" className={styles.noteBtn} onClick={() => retry(setAudioEnabled)}>
              {tryAgainLabel}
            </button>
          </p>
        )}

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
                  tracks={{ audioinput: mic.track }}
                  onActiveDeviceChange={(_, id) => setAudioDeviceId(id)}
                  aria-haspopup="listbox"
                  title={micLabel}
                >
                  <Mic size={18} className={styles.chipIcon} aria-hidden="true" />
                  <DeviceChipLabel
                    kind="audioinput"
                    deviceId={audioDeviceId}
                    fallback={micLabel}
                    refreshKey={mic.track}
                  />
                  <ChevronDown size={16} className={styles.chipCaret} aria-hidden="true" />
                </MediaDeviceMenu>
              </div>
              {canPickSpeaker && (
                <div className={styles.chipWrap}>
                  <MediaDeviceMenu
                    className={styles.chip}
                    initialSelection={outputDeviceId}
                    kind="audiooutput"
                    onActiveDeviceChange={(_, id) => setOutputDeviceId(id)}
                    aria-haspopup="listbox"
                    title={tf('prejoin.speaker', 'Speaker')}
                  >
                    <Volume2 size={18} className={styles.chipIcon} aria-hidden="true" />
                    <DeviceChipLabel
                      kind="audiooutput"
                      deviceId={outputDeviceId}
                      fallback={tf('prejoin.speaker', 'Speaker')}
                      refreshKey={mic.track}
                    />
                    <ChevronDown size={16} className={styles.chipCaret} aria-hidden="true" />
                  </MediaDeviceMenu>
                </div>
              )}
              <div className={styles.chipWrap}>
                <MediaDeviceMenu
                  className={styles.chip}
                  initialSelection={videoDeviceId}
                  kind="videoinput"
                  requestPermissions
                  tracks={{ videoinput: cam.track }}
                  onActiveDeviceChange={(_, id) => setVideoDeviceId(id)}
                  aria-haspopup="listbox"
                  title={camLabel}
                >
                  <Video size={18} className={styles.chipIcon} aria-hidden="true" />
                  <DeviceChipLabel
                    kind="videoinput"
                    deviceId={videoDeviceId}
                    fallback={camLabel}
                    refreshKey={cam.track}
                  />
                  <ChevronDown size={16} className={styles.chipCaret} aria-hidden="true" />
                </MediaDeviceMenu>
              </div>
            </>
          ) : (
            <>
              <div className={styles.chipWrap}>
                <button type="button" className={styles.chip} disabled>
                  <Mic size={18} className={styles.chipIcon} aria-hidden="true" />
                  <span className={styles.chipLabel}>{micLabel}</span>
                  <ChevronDown size={16} className={styles.chipCaret} aria-hidden="true" />
                </button>
              </div>
              <div className={styles.chipWrap}>
                <button type="button" className={styles.chip} disabled>
                  <Video size={18} className={styles.chipIcon} aria-hidden="true" />
                  <span className={styles.chipLabel}>{camLabel}</span>
                  <ChevronDown size={16} className={styles.chipCaret} aria-hidden="true" />
                </button>
              </div>
            </>
          )}
          {nobodyHereText && <p className={styles.nobodyHere}>{nobodyHereText}</p>}
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

        {/* Injected settings above the name (host meeting settings) */}
        {beforeName}

        {/* Name field */}
        <div className={styles.rowField}>
          <label className={styles.rowLabel} htmlFor="kloud-prejoin-username">
            {userLabel}
          </label>
          <input
            id="kloud-prejoin-username"
            className={styles.rowInput}
            type="text"
            defaultValue={username}
            autoComplete="off"
            aria-required="true"
            aria-describedby={!isValid ? 'kloud-prejoin-join-reason' : undefined}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

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
