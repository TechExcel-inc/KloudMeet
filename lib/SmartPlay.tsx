'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Pause, Play } from 'lucide-react';
import { ReplayTransport } from '@/lib/ReplayTransport';
import { ReplayPlayButton } from '@/lib/ReplayPlayButton';
import { authFetch } from '@/lib/kloudSession';
import { useI18n } from '@/lib/i18n';
import { LiveDocReplayStage, type LiveDocReplayInfo } from '@/lib/LiveDocReplayStage';
import { formatClock, narrationTokens } from '@/lib/notesReplay/captions';
import { speakSeconds, type MeetingPresentation } from '@/lib/meetingPresentation';
import { writingShot, writingSourceSeconds, writingSpeakers, writingNarrationSpeakerLanes, type WritingTranscriptLine } from '@/lib/replayWriting';
import type { ShareShot } from '@/lib/shareShot';
import s from '@/styles/Replay.module.css';

type Narration = { url: string; seconds: number };
type Selection = { index: number; fraction: number; revision: number; refresh?: boolean };
type NarrationError = 'signIn' | 'generation' | 'playback';

export function SmartPlay({
  recordingKey, writingId, presentation, shots, transcript, liveDoc, viewerName, scriptHost, captionsOpen, children, onJump, visualVideoUrl, autoPlay, chartHost, playbackHost, renderSpeakerChart,
}: {
  recordingKey: string;
  writingId: string;
  presentation: MeetingPresentation;
  shots: ShareShot[];
  transcript: readonly WritingTranscriptLine[];
  liveDoc: LiveDocReplayInfo | null;
  viewerName: string;
  scriptHost: HTMLElement | null;
  captionsOpen: boolean;
  children: ReactNode;
  onJump: (seconds: number) => void;
  visualVideoUrl?: string;
  autoPlay: boolean;
  chartHost: HTMLElement | null;
  playbackHost: HTMLElement | null;
  renderSpeakerChart: (lanes: ReturnType<typeof writingNarrationSpeakerLanes>, duration: number, onSeek: (time: number) => void) => ReactNode;
}) {
  const { t } = useI18n();
  const clipRequests = useRef(new Set<AbortController>());
  const audio = useRef<HTMLAudioElement>(null);
  const replayVisual = useRef<HTMLVideoElement>(null);
  const activeText = useRef<HTMLElement>(null);
  const activeToken = useRef<HTMLElement>(null);
  const clips = useRef(new Map<number, Promise<Narration>>());
  const didPreload = useRef(new Set<number>());
  const wantsPlayback = useRef(autoPlay);
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
  const [error, setError] = useState<NarrationError | null>(null);
  const slides = presentation.slides;
  const slide = slides[selection.index];
  const tokens = useMemo(() => narrationTokens(slide.narration), [slide.narration]);
  const timing = useMemo(() => {
    let total = 0;
    const boundaries = tokens.map((token) => (total += Math.max(0.1, speakSeconds(token))));
    return { boundaries, total };
  }, [tokens]);

  const requestClip = useCallback((index: number, refresh = false) => {
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
          body: JSON.stringify({ writingId, section: index, poll: refresh || attempt > 0 }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
        });
        if (response.status === 202) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 1500));
          continue;
        }
        if (!response.ok) {
          if (response.status === 401) throw new Error('signIn');
          const failure = await response.json().catch(() => null);
          throw new Error(!refresh && failure?.code === 'NARRATION_NOT_READY' ? 'generation' : 'playback');
        }
        const value = await response.json();
        if (typeof value.url !== 'string' || !Number.isFinite(value.seconds) || value.seconds <= 0) throw new Error('playback');
        return value as Narration;
      }
      throw new Error('playback');
    })().finally(() => clipRequests.current.delete(controller));
    clips.current.set(index, request);
    void request.catch(() => { if (clips.current.get(index) === request) clips.current.delete(index); });
    return request;
  }, [recordingKey, writingId]);

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
    void requestClip(selection.index, selection.refresh).then((loaded) => {
      if (!current) return;
      setDurations((values) => ({ ...values, [selection.index]: loaded.seconds }));
      setClip(loaded);
    }).catch((failure: unknown) => {
      if (!current) return;
      setBuffering(false);
      const reason = failure instanceof Error ? failure.message : '';
      setError(reason === 'signIn' || reason === 'generation' ? reason : 'playback');
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
  const cueIndex = tokenIndex === -1 ? tokens.length - 1 : tokenIndex;
  const sourceSeconds = writingSourceSeconds(slide, progress);
  const availableLiveDoc = liveDocFailed ? null : liveDoc;
  const shot = writingShot(shots, slide, progress);
  const originalSpeakers = useMemo(() => writingSpeakers(slide, transcript), [slide, transcript]);
  const timestamps = useMemo(() => slides.reduce<number[]>((starts, part, index) => {
    starts.push(starts[index] + (durations[index] ?? part.seconds));
    return starts;
  }, [0]), [slides, durations]);
  const totalSeconds = timestamps[slides.length];
  const speakerLanes = useMemo(() => writingNarrationSpeakerLanes(slides, transcript, timestamps),
    [slides, transcript, timestamps]);
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

  function select(index: number, fraction = 0, refresh = false) {
    audio.current?.pause();
    setClip(null);
    setSeconds(0);
    setPlaying(false);
    setEnded(false);
    setSeekId((id) => id + 1);
    setSelection((prior) => ({ index, fraction, revision: prior.revision + 1, refresh }));
  }

  function retryNarration(refresh: boolean) {
    clips.current.delete(selection.index);
    select(selection.index, progress, refresh);
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
        {captionsOpen && cueIndex >= 0 && (
          <div className={s.smartCue}>{tokens.slice(Math.max(0, cueIndex - 5), cueIndex + 12).join('')}</div>
        )}
        <div className={s.smartStageHeader}>
          <div className={s.smartSpeakerContext}>
            <span>{t('replay.write.aiVoice')}</span>
            {slide.author === 'ead-pilot' && <span>{t('replay.write.eadAuthor')}</span>}
            {originalSpeakers.length > 0 && <span className={s.smartOriginalSpeakers}>
              {t('replay.write.originalSpeakers')}{' '}{originalSpeakers.join(', ')}
            </span>}
          </div>
          {slide.startSec !== null && (
            <button type="button" className={s.smartJump} onClick={() => onJump(slide.startSec!)}>
              {t('replay.present.jump', { time: formatClock(slide.startSec) })}
            </button>
          )}
        </div>
        {!playing && clip && !buffering && !error && <ReplayPlayButton onPlay={toggle} />}
        {(buffering || error) && (
          <div className={s.smartNotice} role={error ? 'alert' : 'status'}>
            {t(error === 'signIn' ? 'replay.write.voiceSignIn' :
              error === 'generation' ? 'replay.write.voiceGenerationFailed' :
              error === 'playback' ? 'replay.write.voicePlaybackFailed' : 'replay.write.preparingVoice')}
            {error && error !== 'signIn' && <button type="button" className={s.iconBtn} onClick={() => {
              wantsPlayback.current = true;
              retryNarration(error === 'playback' && (selection.refresh === true || !!clip));
            }}>{t('replay.write.retry')}</button>}
          </div>
        )}
      </div>
      {playbackHost && createPortal(
        <button type="button" className={s.primaryBtn + ' ' + s.writingIconLabel}
          onClick={toggle} disabled={!clip || Boolean(error)}>
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          <span>{t(playing ? 'replay.write.aiPause' : 'replay.write.aiPlay')}</span>
        </button>,
        playbackHost,
      )}
      {chartHost && createPortal(renderSpeakerChart(speakerLanes, totalSeconds, seek), chartHost)}
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
        onError={(event) => {
          if (!clip) return;
          const media = event.currentTarget;
          if (media.getAttribute('src') !== clip.url ||
              (media.currentSrc && media.currentSrc !== new URL(clip.url, document.baseURI).href)) return;
          if (!selection.refresh) {
            retryNarration(true);
            return;
          }
          setPlaying(false);
          setBuffering(false);
          setError('playback');
        }}
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
