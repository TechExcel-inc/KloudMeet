'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ReplayTransport } from '@/lib/ReplayTransport';
import { ReplayPlayButton } from '@/lib/ReplayPlayButton';
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
  recordingKey, minutes, presentation, shots, liveDoc, viewerName, scriptHost, captionsOpen, children, onJump, visualVideoUrl,
}: {
  recordingKey: string;
  minutes: WritingLength;
  presentation: MeetingPresentation;
  shots: ShareShot[];
  liveDoc: LiveDocReplayInfo | null;
  viewerName: string;
  scriptHost: HTMLElement | null;
  captionsOpen: boolean;
  children: ReactNode;
  onJump: (seconds: number) => void;
  visualVideoUrl?: string;
}) {
  const { t } = useI18n();
  const clipRequests = useRef(new Set<AbortController>());
  const audio = useRef<HTMLAudioElement>(null);
  const replayVisual = useRef<HTMLVideoElement>(null);
  const activeText = useRef<HTMLElement>(null);
  const activeToken = useRef<HTMLElement>(null);
  const clips = useRef(new Map<number, Promise<Narration>>());
  const didPreload = useRef(new Set<number>());
  const wantsPlayback = useRef(true);
  const [selection, setSelection] = useState<Selection>({ index: 0, fraction: 0, revision: 0 });
  const [clip, setClip] = useState<Narration | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [rate, setRate] = useState(1);
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [ended, setEnded] = useState(false);
  const [seekId, setSeekId] = useState(0);
  const [liveDocFailed, setLiveDocFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
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
    const controller = new AbortController();
    clipRequests.current.add(controller);
    const request = (async (): Promise<Narration> => {
      for (let attempt = 0; attempt < 60 && !controller.signal.aborted; attempt++) {
        const response = await authFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minutes, section: index, poll: attempt > 0 }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
        });
        if (response.status === 202) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 1500));
          continue;
        }
        if (!response.ok) throw new Error(response.status === 401 ? 'signIn' : 'unavailable');
        const value = await response.json();
        if (typeof value.url !== 'string' || !Number.isFinite(value.seconds) || value.seconds <= 0) throw new Error('unavailable');
        return value as Narration;
      }
      throw new Error('unavailable');
    })().finally(() => clipRequests.current.delete(controller));
    clips.current.set(index, request);
    void request.catch(() => { if (clips.current.get(index) === request) clips.current.delete(index); });
    return request;
  }, [recordingKey, minutes]);

  useEffect(() => {
    const requests = clipRequests.current;
    const cache = clips.current;
    return () => {
      requests.forEach((controller) => controller.abort());
      cache.clear();
    };
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
  }, [selection.index, scriptHost]);

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
  }, [tokenIndex, selection.index, scriptHost]);

  const showReplayVisual = Boolean(visualVideoUrl && !videoFailed && !shot && !availableLiveDoc && sourceSeconds !== null);
  const visualRate = Math.max(0.1, Math.min(4, sourceSpan * rate / sectionSeconds));
  const syncReplayVisual = useCallback(() => {
    const video = replayVisual.current;
    if (!video || video.readyState < 1) return;
    if (!showReplayVisual || sourceSeconds === null) {
      video.pause();
      return;
    }
    const target = Number.isFinite(video.duration) ? Math.min(sourceSeconds, video.duration) : sourceSeconds;
    if (Math.abs(video.currentTime - target) > 0.3) video.currentTime = target;
    video.playbackRate = visualRate;
    if (!playing || buffering || sourceSpan === 0) video.pause();
    else if (video.paused) void video.play().catch(() => undefined);
  }, [showReplayVisual, sourceSeconds, visualRate, playing, buffering, sourceSpan]);

  useEffect(syncReplayVisual, [syncReplayVisual]);

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
    <>
      <div className={s.smartVisual}>
        {availableLiveDoc && (
          <div className={s.smartLiveDoc} hidden={sourceSeconds === null || !!shot}>
            <LiveDocReplayStage info={availableLiveDoc} viewerName={viewerName} speaker={null} fill fillClass={s.smartLiveDocFrame}
              onFailure={onLiveDocFailure}
              clock={{
                seconds: sourceSeconds ?? 0, playing: playing && !buffering && !shot && sourceSpan > 0,
                rate: visualRate,
                seekId,
              }} />
          </div>
        )}
        {visualVideoUrl && !videoFailed && !availableLiveDoc && (
          <video ref={replayVisual} src={visualVideoUrl} muted playsInline hidden={!showReplayVisual}
            onLoadedMetadata={syncReplayVisual} onError={() => setVideoFailed(true)} />
        )}
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.url} alt={t('replay.write.screenshot')} />
        ) : (!availableLiveDoc || sourceSeconds === null) && !showReplayVisual && (
          <div className={s.smartTextVisual}><h3>{slide.title}</h3></div>
        )}
        {captionsOpen && playing && tokenIndex >= 0 && (
          <div className={s.smartCue}>{tokens.slice(Math.max(0, tokenIndex - 5), tokenIndex + 12).join('')}</div>
        )}
        <div className={s.smartStageHeader}>
          <span>{t('replay.write.aiVoice')}</span>
          {slide.startSec !== null && (
            <button type="button" className={s.smartJump} onClick={() => onJump(slide.startSec!)}>
              {t('replay.present.jump', { time: formatClock(slide.startSec) })}
            </button>
          )}
        </div>
        {!playing && clip && !buffering && !error && <ReplayPlayButton onPlay={toggle} />}
        {(buffering || error) && (
          <div className={s.smartNotice} role={error ? 'alert' : 'status'}>
            {t(error ? (error === 'signIn' ? 'replay.write.voiceSignIn' : 'replay.write.voiceUnavailable') : 'replay.write.preparingVoice')}
            {error === 'unavailable' && <button type="button" className={s.iconBtn} onClick={() => {
              clips.current.delete(selection.index);
              wantsPlayback.current = true;
              select(selection.index, progress);
            }}>{t('replay.write.retry')}</button>}
          </div>
        )}
      </div>
      {scriptHost && createPortal(slides.map((part, index) => (
        <section key={index} ref={index === selection.index ? activeText : undefined} aria-current={index === selection.index || undefined}>
          <h3><button type="button" onClick={() => select(index)}>{part.title}</button></h3>
          <p>{index === selection.index ? tokens.map((token, position) => (
            position === tokenIndex ? <mark key={position} ref={activeToken}>{token}</mark> : token
          )) : part.narration}</p>
        </section>
      )), scriptHost)}
      <audio ref={audio} src={clip?.url} preload="auto"
        onLoadedMetadata={(event) => {
          if (!clip) return;
          const media = event.currentTarget;
          media.currentTime = selection.fraction * clip.seconds;
          setSeconds(media.currentTime);
          setBuffering(false);
          if (wantsPlayback.current) playMedia(media);
        }}
        onRateChange={(event) => setRate(event.currentTarget.playbackRate)}
        onTimeUpdate={(event) => setSeconds(event.currentTarget.currentTime)}
        onSeeking={() => setBuffering(true)}
        onSeeked={(event) => { setBuffering(false); setSeconds(event.currentTarget.currentTime); }}
        onWaiting={() => setBuffering(true)} onCanPlay={() => setBuffering(false)}
        onPlaying={() => { setBuffering(false); setPlaying(true); }} onPause={() => setPlaying(false)}
        onError={() => { if (clip) { setPlaying(false); setBuffering(false); setError('unavailable'); } }}
        onEnded={() => {
          setPlaying(false);
          if (selection.index + 1 < slides.length) select(selection.index + 1);
          else setEnded(true);
        }} />
      <ReplayTransport mediaRef={audio} time={elapsed} expectedDuration={totalSeconds}
        playing={playing} silent={false} presenting={false}
        playback={{ duration: totalSeconds, onToggle: toggle, onSeek: seek, playDisabled: !clip || !!error }}>
        {children}
      </ReplayTransport>
    </>
  );
}
