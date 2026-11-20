'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '@/lib/kloudSession';
import { useI18n } from '@/lib/i18n';
import { LiveDocReplayStage, type LiveDocReplayInfo } from '@/lib/LiveDocReplayStage';
import { formatClock, narrationTokens } from '@/lib/notesReplay/captions';
import { speakSeconds, type MeetingPresentation } from '@/lib/meetingPresentation';
import { writingShot, writingSourceSeconds, type WritingLength } from '@/lib/replayWriting';
import type { ShareShot } from '@/lib/shareShot';
import s from '@/styles/Replay.module.css';

type Narration = { url: string; seconds: number };
type Selection = { index: number; fraction: number; revision: number };

export function SmartPlay({
  recordingKey, minutes, presentation, shots, liveDoc, viewerName, onClose, onJump,
}: {
  recordingKey: string;
  minutes: WritingLength;
  presentation: MeetingPresentation;
  shots: ShareShot[];
  liveDoc: LiveDocReplayInfo | null;
  viewerName: string;
  onClose: () => void;
  onJump: (seconds: number) => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const activeText = useRef<HTMLElement>(null);
  const activeToken = useRef<HTMLElement>(null);
  const clips = useRef(new Map<number, Promise<Narration>>());
  const didPreload = useRef(new Set<number>());
  const wantsPlayback = useRef(true);
  const [selection, setSelection] = useState<Selection>({ index: 0, fraction: 0, revision: 0 });
  const [clip, setClip] = useState<Narration | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [ended, setEnded] = useState(false);
  const [seekId, setSeekId] = useState(0);
  const [liveDocFailed, setLiveDocFailed] = useState(false);
  const onLiveDocFailure = useCallback(() => setLiveDocFailed(true), []);
  const [error, setError] = useState<'signIn' | 'unavailable' | null>(null);
  const slides = presentation.slides;
  const slide = slides[selection.index];
  const tokens = useMemo(() => narrationTokens(slide.narration), [slide.narration]);
  const timing = useMemo(() => {
    let total = 0;
    const boundaries = tokens.map((token) => (total += Math.max(0.1, speakSeconds(token))));
    return { boundaries, total };
  }, [tokens]);

  const requestClip = useCallback((index: number) => {
    const existing = clips.current.get(index);
    if (existing) return existing;
    const endpoint = `/api/recordings/${encodeURIComponent(recordingKey)}/writing/narration`;
    const request = authFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes, section: index }),
    }).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 401 ? 'signIn' : 'unavailable');
      const value = await response.json();
      if (typeof value.url !== 'string' || !Number.isFinite(value.seconds) || value.seconds <= 0) throw new Error('unavailable');
      return value as Narration;
    });
    clips.current.set(index, request);
    void request.catch(() => { if (clips.current.get(index) === request) clips.current.delete(index); });
    return request;
  }, [recordingKey, minutes]);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  useEffect(() => {
    let current = true;
    setBuffering(true);
    setPlaying(false);
    setClip(null);
    setError(null);
    setSeconds(0);
    void requestClip(selection.index).then((loaded) => {
      if (!current) return;
      setDurations((values) => ({ ...values, [selection.index]: loaded.seconds }));
      setClip(loaded);
    }).catch((failure: unknown) => {
      if (!current) return;
      setBuffering(false);
      setError(failure instanceof Error && failure.message === 'signIn' ? 'signIn' : 'unavailable');
    });
    return () => { current = false; };
  }, [requestClip, selection]);

  useEffect(() => {
    if (!playing || selection.index + 1 >= slides.length || didPreload.current.has(selection.index)) return;
    didPreload.current.add(selection.index);
    const next = selection.index + 1;
    let current = true;
    void requestClip(next).then((loaded) => {
      if (current) setDurations((values) => ({ ...values, [next]: loaded.seconds }));
    }).catch(() => undefined);
    return () => { current = false; };
  }, [playing, requestClip, selection.index, slides.length]);

  useEffect(() => {
    activeText.current?.scrollIntoView({ block: 'start' });
  }, [selection.index]);

  const progress = clip ? Math.min(1, seconds / clip.seconds) : selection.fraction;
  const tokenIndex = timing.boundaries.findIndex((boundary) => boundary > progress * timing.total);
  const sourceSeconds = writingSourceSeconds(slide, progress);
  const availableLiveDoc = liveDocFailed ? null : liveDoc;
  const shot = writingShot(shots, slide, progress);
  const timestamps = useMemo(() => slides.reduce<number[]>((starts, part, index) => {
    starts.push(starts[index] + (durations[index] ?? part.seconds));
    return starts;
  }, [0]), [slides, durations]);
  const totalSeconds = timestamps[slides.length];
  const sectionSeconds = timestamps[selection.index + 1] - timestamps[selection.index];
  const elapsed = timestamps[selection.index] + progress * sectionSeconds;
  const sourceSpan = Math.max(0, (slide.endSec ?? 0) - (slide.startSec ?? 0));

  useEffect(() => {
    activeToken.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tokenIndex, selection.index]);

  function select(index: number, fraction = 0) {
    audio.current?.pause();
    setClip(null);
    setSeconds(0);
    setPlaying(false);
    setEnded(false);
    setSeekId((id) => id + 1);
    setSelection((prior) => ({ index, fraction, revision: prior.revision + 1 }));
  }

  function seek(time: number) {
    const index = timestamps.findIndex((_, next) => next < slides.length && time < timestamps[next + 1]);
    const target = index < 0 ? slides.length - 1 : index;
    const span = timestamps[target + 1] - timestamps[target];
    const fraction = Math.min(1, Math.max(0, (time - timestamps[target]) / span));
    if (target === selection.index && clip && audio.current) {
      audio.current.currentTime = fraction * clip.seconds;
      setSeconds(audio.current.currentTime);
      setSeekId((id) => id + 1);
      setEnded(false);
    } else {
      select(target, fraction);
    }
  }

  function playMedia(media: HTMLAudioElement) {
    void media.play().catch(() => {
      wantsPlayback.current = false;
      setBuffering(false);
      setPlaying(false);
    });
  }

  function toggle() {
    if (playing) {
      wantsPlayback.current = false;
      audio.current?.pause();
      return;
    }
    wantsPlayback.current = true;
    if (ended) select(0);
    else if (audio.current) playMedia(audio.current);
  }

  return (
    <dialog ref={dialog} className={s.smartPlayDialog} aria-label={t('replay.write.smartPlay')}
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className={s.smartPlayback}>
        <header className={s.smartPlaybackHeader}>
          <div><h2>{presentation.title}</h2><p>{t('replay.write.aiVoice')}</p></div>
          <button type="button" className={s.iconBtn} onClick={onClose}>{t('settings.close')}</button>
        </header>
        <div className={s.smartPlaybackBody}>
          <div className={s.smartVisual}>
            {availableLiveDoc && (
              <div className={s.smartLiveDoc} hidden={sourceSeconds === null || !!shot}>
                <LiveDocReplayStage info={availableLiveDoc} viewerName={viewerName} speaker={null} fill fillClass={s.smartLiveDocFrame}
                  onFailure={onLiveDocFailure}
                  clock={{
                    seconds: sourceSeconds ?? 0, playing: playing && !buffering && !shot && sourceSpan > 0,
                    rate: Math.max(0.1, Math.min(4, sourceSpan / sectionSeconds)),
                    seekId,
                  }} />
              </div>
            )}
            {shot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shot.url} alt={t('replay.write.screenshot')} />
            ) : (!availableLiveDoc || sourceSeconds === null) && (
              <div className={s.smartTextVisual}>
                <h3>{slide.title}</h3>
                {tokenIndex >= 0 && <p>{tokens.slice(Math.max(0, tokenIndex - 5), tokenIndex + 12).join('')}</p>}
              </div>
            )}
            {slide.startSec !== null && (
              <button type="button" className={s.smartJump} onClick={() => onJump(slide.startSec!)}>
                {t('replay.present.jump', { time: formatClock(slide.startSec) })}
              </button>
            )}
          </div>
          <div className={s.smartScript} aria-label={t('replay.write.script')}>
            {slides.map((part, index) => (
              <section key={index} ref={index === selection.index ? activeText : undefined} aria-current={index === selection.index || undefined}>
                <h3><button type="button" onClick={() => select(index)}>{part.title}</button></h3>
                <p>{index === selection.index ? tokens.map((token, position) => (
                  position === tokenIndex ? <mark key={position} ref={activeToken}>{token}</mark> : token
                )) : part.narration}</p>
              </section>
            ))}
          </div>
        </div>
        {clip && (
          <audio key={selection.revision} ref={audio} src={clip.url} preload="auto"
            onLoadedMetadata={(event) => {
              const media = event.currentTarget;
              media.currentTime = selection.fraction * clip.seconds;
              setSeconds(media.currentTime);
              setBuffering(false);
              if (wantsPlayback.current) playMedia(media);
            }}
            onTimeUpdate={(event) => setSeconds(event.currentTarget.currentTime)}
            onSeeking={() => setBuffering(true)}
            onSeeked={(event) => { setBuffering(false); setSeconds(event.currentTarget.currentTime); }}
            onWaiting={() => setBuffering(true)} onCanPlay={() => setBuffering(false)}
            onPlaying={() => { setBuffering(false); setPlaying(true); }} onPause={() => setPlaying(false)}
            onError={() => { setPlaying(false); setBuffering(false); setError('unavailable'); }}
            onEnded={() => {
              setPlaying(false);
              if (selection.index + 1 < slides.length) select(selection.index + 1);
              else setEnded(true);
            }} />
        )}
        <footer className={s.smartControls}>
          <button type="button" className={s.iconBtn} disabled={!clip || !!error} onClick={toggle}>
            {t(playing ? 'replay.pause' : 'replay.play')}
          </button>
          <span>{formatClock(elapsed)} / {formatClock(totalSeconds)}</span>
          <input type="range" min={0} max={totalSeconds} step={0.1} value={elapsed}
            aria-label={t('replay.playbackPosition')} onChange={(event) => seek(Number(event.target.value))} />
          {buffering && !error && <span role="status">{t('replay.write.preparingVoice')}</span>}
          {error && (
            <div role="alert">
              {t(error === 'signIn' ? 'replay.write.voiceSignIn' : 'replay.write.voiceUnavailable')}
              {error !== 'signIn' && <button type="button" className={s.iconBtn} onClick={() => {
                clips.current.delete(selection.index);
                wantsPlayback.current = true;
                select(selection.index, progress);
              }}>{t('replay.write.retry')}</button>}
            </div>
          )}
        </footer>
      </div>
    </dialog>
  );
}
