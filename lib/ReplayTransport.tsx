'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useI18n } from '@/lib/i18n';
import s from '@/styles/Replay.module.css';

function timestamp(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const tail = String(whole % 60).padStart(2, '0');
  return minutes < 60 ? `${minutes}:${tail}` :
    `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${tail}`;
}

export function ReplayTransport({
  mediaRef, time, expectedDuration, playing, silent, presenting, download, children, playback,
}: {
  mediaRef: RefObject<HTMLMediaElement | null>;
  time: number;
  expectedDuration: number;
  playing: boolean;
  silent: boolean;
  presenting: boolean;
  download?: { url: string; fileName: string };
  children: ReactNode;
  playback?: { duration: number; onToggle: () => void; onSeek: (seconds: number) => void; playDisabled: boolean };
}) {
  const { t } = useI18n();
  const menu = useRef<HTMLDetailsElement>(null);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const sync = () => {
      setDuration(Number.isFinite(media.duration) ? media.duration : 0);
      setMuted(media.muted || media.volume === 0);
      setVolume(media.volume);
      setRate(media.playbackRate);
    };
    const events = ['durationchange', 'loadedmetadata', 'emptied', 'volumechange', 'ratechange'];
    events.forEach((event) => media.addEventListener(event, sync));
    sync();
    return () => events.forEach((event) => media.removeEventListener(event, sync));
  }, [mediaRef, download?.url]);

  const playbackDuration = playback?.duration ?? duration;

  const togglePlay = () => {
    if (playback) return playback.onToggle();
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => undefined);
    else media.pause();
  };

  const toggleMute = () => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.volume === 0) media.volume = 1;
    media.muted = !muted;
  };

  return (
    <div className={s.replayTransport} data-presenting={presenting || undefined}>
      <div className={s.transportRow}>
        {!presenting && (
          <>
            <button type="button" className={s.replayControl}
              aria-label={t(playing ? 'replay.pause' : 'replay.play')}
              title={t(playing ? 'replay.pause' : 'replay.play')} disabled={playback?.playDisabled} onClick={togglePlay}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d={playing ? 'M7 5h4v14H7zm6 0h4v14h-4z' : 'M8 5v14l12-7z'} />
              </svg>
            </button>
            <span className={s.transportTime}>{timestamp(time)} / {timestamp(playbackDuration || expectedDuration)}</span>
          </>
        )}
        <div className={s.transportRight}>
          {!presenting && !silent && (
            <button type="button" className={s.replayControl}
              aria-label={t(muted ? 'replay.unmute' : 'replay.mute')}
              title={t(muted ? 'replay.unmute' : 'replay.mute')} onClick={toggleMute}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 9h4l5-4v14l-5-4H3z" />
                <path d={muted ? 'm16 9 6 6m0-6-6 6' : 'M16 9a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12'} />
              </svg>
            </button>
          )}
          {children}
          {!presenting && (
            <details ref={menu} className={s.transportMenu} onBlur={(event) => {
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
            }} onKeyDown={(event) => {
              if (event.key === 'Escape' && event.currentTarget.open) {
                event.stopPropagation();
                event.currentTarget.open = false;
                event.currentTarget.querySelector('summary')?.focus();
              }
            }}>
              <summary className={s.replayControl} title={t('replay.playbackOptions')} aria-label={t('replay.playbackOptions')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
                </svg>
              </summary>
              <div className={s.transportMenuOptions}>
                <label>
                  {t('replay.playbackSpeed')}
                  <select value={rate} onChange={(event) => {
                    if (mediaRef.current) mediaRef.current.playbackRate = Number(event.target.value);
                  }}>
                    {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
                      <option key={speed} value={speed}>{speed}×</option>
                    ))}
                  </select>
                </label>
                {!silent && (
                  <label>
                    {t('replay.playbackVolume')}
                    <input type="range" min={0} max={1} step={0.05} value={volume}
                      onChange={(event) => {
                        if (!mediaRef.current) return;
                        mediaRef.current.volume = Number(event.target.value);
                        mediaRef.current.muted = false;
                      }}
                    />
                  </label>
                )}
                {download && <a download={download.fileName} href={download.url} onClick={() => {
                  if (menu.current) menu.current.open = false;
                }}>{t('replay.download')}</a>}
              </div>
            </details>
          )}
        </div>
      </div>
      {!presenting && (
        <input type="range" className={s.transportSeek} min={0} max={playbackDuration || 1} step={0.1}
          value={Math.min(time, playbackDuration)} disabled={!playbackDuration}
          aria-label={t('replay.playbackPosition')} aria-valuetext={timestamp(time)}
          onChange={(event) => {
            const seconds = Number(event.target.value);
            if (playback) playback.onSeek(seconds);
            else if (mediaRef.current) mediaRef.current.currentTime = seconds;
          }}
        />
      )}
    </div>
  );
}
