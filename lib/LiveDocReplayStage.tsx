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
  viewerName,
  speaker,
}: {
  info: LiveDocReplayInfo;
  mediaRef: React.RefObject<HTMLVideoElement | null>;
  viewerName: string;
  speaker: ReplaySpeaker | null;
}) {
  const { t, locale } = useI18n();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const screenRef = React.useRef<HTMLVideoElement>(null);
  const [src, setSrc] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [kloudMs, setKloudMs] = React.useState(0);
  const readyRef = React.useRef(false);

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
      const media = mediaRef.current;
      const frame = iframeRef.current;
      if (!media || !frame?.contentWindow || !src) return;
      const ms = Math.max(0, Math.round(media.currentTime * 1000 + info.offsetMs));
      frame.contentWindow.postMessage(
        { type: 'Kloud-ReplayTime', ms, playing: !media.paused, rate: media.playbackRate, seek },
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
    const media = mediaRef.current;
    if (!media) return;
    const onSeeked = () => {
      if (readyRef.current) postTime(true);
    };
    media.addEventListener('seeked', onSeeked);
    const timer = window.setInterval(() => {
      setKloudMs(Math.max(0, media.currentTime * 1000 + info.offsetMs));
      if (readyRef.current) postTime(false);
    }, TICK_MS);
    return () => {
      media.removeEventListener('seeked', onSeeked);
      window.clearInterval(timer);
    };
  }, [mediaRef, info.offsetMs, postTime]);

  // Screen share: full view while one was on, kept on the clock (muted: the voice is the media)
  const screen = info.screens.find((sc) => kloudMs >= sc.startMs && (sc.endMs === null || kloudMs < sc.endMs)) ?? null;
  React.useEffect(() => {
    const video = screenRef.current;
    const media = mediaRef.current;
    if (!video || !media || !screen) return;
    const target = (kloudMs - screen.startMs) / 1000;
    if (Math.abs(video.currentTime - target) > SCREEN_DRIFT_S) video.currentTime = Math.max(0, target);
    video.playbackRate = media.playbackRate;
    if (media.paused && !video.paused) video.pause();
    else if (!media.paused && video.paused) void video.play().catch(() => undefined);
  }, [screen, kloudMs, mediaRef]);

  return (
    <div style={stageStyle}>
      {src && (
        <iframe
          ref={iframeRef}
          src={src}
          title="LiveDoc replay"
          style={{ ...fillStyle, border: 0, visibility: screen ? 'hidden' : 'visible' }}
          allow="autoplay *; fullscreen *"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      )}
      {screen && (
        <video key={screen.url} ref={screenRef} src={screen.url} muted playsInline style={{ ...fillStyle, objectFit: 'contain', background: '#000' }} />
      )}
      {(!ready || error) && !screen && (
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
