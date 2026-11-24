'use client';

import React from 'react';
import { authHeaders } from './kloudSession';
import { useI18n } from './i18n';
import {
  buildLiveDocIframeSrc,
  createOrUpdateInstantAccount,
  syncLivedocLessonMember,
  type LiveDocRuntimeSettings,
} from './livedoc/client';
import { shotAt, type ShareShot } from './shareShot';

/** What the replay API returns for a LiveDoc Full recording. */
export interface LiveDocReplayInfo {
  /** Kloud recording id (its saved actions) */
  recordingId: number;
  /** The meeting's LiveDoc (Kloud meeting / lesson) id */
  kloudMeetingId: number;
  /** Kloud time (ms) = media time (ms) + offsetMs */
  offsetMs: number;
  /** Screen shares on Kloud's timeline */
  screens: Array<{ url: string; startMs: number; endMs: number | null }>;
}

export interface LiveDocReplayClock {
  seconds: number;
  playing: boolean;
  rate: number;
  seekId: number;
}

export interface ReplaySpeaker {
  name: string;
  photo?: string;
  color?: string;
}

const TICK_MS = 200;
/** Re-seek the screen-share video when it drifts this far from the clock */
const SCREEN_DRIFT_S = 0.3;

/**
 * Replay stage for a LiveDoc Full recording. The recording's media element (the meeting's voice)
 * is the clock; this shows what the meeting showed at that time:
 *   - LiveDoc: the LiveDoc plugin in replay mode, sent the time several times a second;
 *   - screen share: the shared screen, full view, for the stretch it was on;
 *   - webcam: SmartCam, a small card with whoever is speaking.
 */
export function LiveDocReplayStage({
  info,
  mediaRef,
  clock,
  onFailure,
  viewerName,
  speaker,
  shots = [],
  coverWithShots = false,
  fill = false,
  fillClass,
  boxClass,
  children,
}: {
  info: LiveDocReplayInfo;
  mediaRef?: React.RefObject<HTMLVideoElement | null>;
  clock?: LiveDocReplayClock;
  onFailure?: (recordingId: number) => void;
  viewerName: string;
  speaker: ReplaySpeaker | null;
  shots?: ShareShot[];
  /** 有共享截图的时间段用图片盖住活文档，不再让共享视频挡住 */
  coverWithShots?: boolean;
  /** 无字幕时占满剩余高度，把下方声音控制条留在可视区域内 */
  fill?: boolean;
  /** fill 时的布局类（桌面限高、窄屏改回 16:9） */
  fillClass?: string;
  /** 有字幕时的布局类：和普通回放视频一样高，下面留出章节 */
  boxClass?: string;
  /** 叠在舞台上的回放浮层（参会人） */
  children?: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const screenRef = React.useRef<HTMLVideoElement>(null);
  const [src, setSrc] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mediaMs, setMediaMs] = React.useState(0);
  const readyRef = React.useRef(false);
  const clockRef = React.useRef(clock);
  clockRef.current = clock;
  const lastClock = React.useRef<{ seconds: number; seekId: number; playing: boolean } | undefined>(undefined);


  React.useEffect(() => {
    if (error) onFailure?.(info.recordingId);
  }, [error, info.recordingId, onFailure]);

  React.useEffect(() => {
    if (!onFailure || ready) return;
    const timer = window.setTimeout(() => onFailure(info.recordingId), 15000);
    return () => window.clearTimeout(timer);
  }, [info.recordingId, ready, onFailure]);

  // LiveDoc plugin in replay mode, signed in as this viewer's LiveDoc guest
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await createOrUpdateInstantAccount(viewerName || 'Viewer');
        await syncLivedocLessonMember({
          userToken: token,
          livedocInstanceId: String(info.kloudMeetingId),
        }).catch(() => undefined);
        let settings: LiveDocRuntimeSettings | null = null;
        if (process.env.NODE_ENV === 'development') {
          const res = await fetch('/api/settings?scope=livedoc', { headers: authHeaders() }).catch(() => null);
          const data = res?.ok ? ((await res.json()) as Record<string, unknown>) : {};
          const raw = data.livedoc_debug_enabled;
          settings = {
            debugEnabled: raw === true || raw === 'true' || raw === '1' || raw === 1,
            debugUrl: typeof data.livedoc_debug_url === 'string' ? data.livedoc_debug_url : '',
          };
        }
        const base = buildLiveDocIframeSrc(String(info.kloudMeetingId), token, locale === 'zh' ? 0 : 1, settings);
        if (!cancelled) setSrc(`${base}&replay=${encodeURIComponent(String(info.recordingId))}`);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [info.kloudMeetingId, info.recordingId, viewerName, locale]);

  const postTime = React.useCallback(
    (seek: boolean) => {
      const media = mediaRef?.current;
      const external = clockRef.current;
      const frame = iframeRef.current;
      if ((!media && !external) || !frame?.contentWindow || !src) return;
      const seconds = external?.seconds ?? media?.currentTime ?? 0;
      const playing = external?.playing ?? (media ? !media.paused : false);
      const rate = external?.rate ?? media?.playbackRate ?? 1;
      const ms = Math.max(0, Math.round(seconds * 1000 + info.offsetMs));
      frame.contentWindow.postMessage(
        { type: 'Kloud-ReplayTime', ms, playing, rate, seek },
        new URL(src).origin,
      );
    },
    [mediaRef, info.offsetMs, src],
  );

  // The plugin reports when it has loaded the recording
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!iframeRef.current?.contentWindow || event.source !== iframeRef.current.contentWindow) return;
      const data = event.data as { type?: string; message?: string } | null;
      if (data?.type === 'Kloud-ReplayReady') {
        readyRef.current = true;
        setReady(true);
        postTime(true);
      } else if (data?.type === 'Kloud-ReplayError') {
        setError(data.message || 'LiveDoc replay failed');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [postTime]);

  // Clock: send the time while playing; a seek rebuilds the page
  React.useEffect(() => {
    const media = mediaRef?.current;
    if (!media) return;
    const onSeeked = () => {
      if (readyRef.current) postTime(true);
    };
    media.addEventListener('seeked', onSeeked);
    const timer = window.setInterval(() => {
      setMediaMs(media.currentTime * 1000);
      if (readyRef.current) postTime(false);
    }, TICK_MS);
    return () => {
      media.removeEventListener('seeked', onSeeked);
      window.clearInterval(timer);
    };
  }, [mediaRef, info.offsetMs, postTime]);

  React.useEffect(() => {
    if (!clock) return;
    const previous = lastClock.current;
    lastClock.current = clock;
    if (readyRef.current) postTime(
      previous?.seekId !== clock.seekId || (!clock.playing && previous?.seconds !== clock.seconds),
    );
  }, [clock, postTime]);

  const playbackMs = clock ? clock.seconds * 1000 : mediaMs;
  const onscreenMs = playbackMs + info.offsetMs;
  // Screen share: full view while one was on, kept on the clock (muted: the voice is the media)
  const shot = shotAt(shots, playbackMs);
  const screen =
    shot && coverWithShots
      ? null
      : (info.screens.find((sc) => onscreenMs >= sc.startMs && (sc.endMs === null || onscreenMs < sc.endMs)) ?? null);
  const shownShot = screen ? null : shot;
  React.useEffect(() => {
    const video = screenRef.current;
    const media = mediaRef?.current;
    if (!video || (!media && !clock) || !screen) return;
    const target = (onscreenMs - screen.startMs) / 1000;
    if (Math.abs(video.currentTime - target) > SCREEN_DRIFT_S) video.currentTime = Math.max(0, target);
    video.playbackRate = clock?.rate ?? media?.playbackRate ?? 1;
    const playing = clock?.playing ?? (media ? !media.paused : false);
    if (!playing && !video.paused) video.pause();
    else if (playing && video.paused) void video.play().catch(() => undefined);
  }, [screen, onscreenMs, mediaRef, clock]);

  return (
    <div className={fill ? fillClass : boxClass} style={fill ? stageFillStyle : boxClass ? stageBoxStyle : stageStyle}>
      {src && (
        <iframe
          ref={iframeRef}
          src={src}
          title="LiveDoc replay"
          style={{ ...fillStyle, border: 0, visibility: screen || shownShot ? 'hidden' : 'visible' }}
          allow="autoplay *; fullscreen *"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      )}
      {screen && (
        <video key={screen.url} ref={screenRef} src={screen.url} muted playsInline style={{ ...fillStyle, objectFit: 'contain', background: '#000' }} />
      )}
      {shownShot && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shownShot.url} alt="" style={{ ...fillStyle, objectFit: 'contain', background: '#000', zIndex: 2 }} />
      )}
      {(!ready || error) && !screen && !shownShot && (
        <div style={{ ...fillStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 14 }}>
          {error ? `${t('livedoc.errorTitle')}: ${error}` : t('livedoc.loading')}
        </div>
      )}
      {speaker && (
        <div style={smartCamStyle} aria-live="polite">
          {speaker.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={speaker.photo} alt="" style={smartCamAvatarStyle} />
          ) : (
            <span style={{ ...smartCamAvatarStyle, background: speaker.color || '#6366f1' }}>
              {speaker.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <span style={{ fontSize: 13, fontWeight: 500 }}>{speaker.name}</span>
        </div>
      )}
      {children}
    </div>
  );
}

const stageStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  aspectRatio: '16 / 9',
  background: '#0b0d12',
  overflow: 'hidden',
};
/** 有字幕时由布局类限高，避免 16:9 把下方章节挤出画面 */
const stageBoxStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  background: '#0b0d12',
  overflow: 'hidden',
};
/** 尺寸由 fillClass 决定，避免 16:9 把下方控制条顶出画面 */
const stageFillStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  minHeight: 0,
  background: '#0b0d12',
  overflow: 'hidden',
};
const fillStyle: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
const smartCamStyle: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  bottom: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px 6px 6px',
  borderRadius: 999,
  background: 'rgba(15, 18, 26, 0.82)',
  color: '#f1f5f9',
  boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
};
const smartCamAvatarStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  objectFit: 'cover',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  fontWeight: 600,
  color: '#fff',
};
