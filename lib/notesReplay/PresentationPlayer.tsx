'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import s from '@/styles/NotesReplayStage.module.css';
import { useI18n } from '@/lib/i18n';
import {
  presentationPlan,
  slideAt,
  speakSeconds,
  type MeetingPresentation,
  type PlannedSlide,
  type PresentationLength,
  type SlideBullet,
} from '@/lib/meetingPresentation';
import {
  formatClock,
  minuteRange,
  narrationAt,
  narrationChunks,
  narrationFractionAtChar,
  pickVoice,
  revealCount,
  roughDuration,
  spotlightIndex,
  voiceLang,
  type NarrationChunk,
} from './captions';
import {
  Avatar,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  JumpIcon,
  KeyIcon,
  MoreIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QuoteIcon,
  ReplayIcon,
  Segmented,
  SparkIcon,
  Spinner,
  TimelineIcon,
  VoiceOffIcon,
  VoiceOnIcon,
} from './parts';

/** Where the viewer was, kept by the stage so coming back from the timeline resumes there. */
export interface PlayerMemory {
  elapsed: number;
  length: PresentationLength;
  pace: number;
}

export interface PresentationPlayerProps {
  presentation: MeetingPresentation;
  meetingTitle: string;
  meetingMeta: string;
  /** Length of the real meeting in seconds (0 when unknown) */
  meetingSeconds: number;
  memory: React.MutableRefObject<PlayerMemory | null>;
  modeSwitch: React.ReactNode;
  canManage: boolean;
  regenerating: boolean;
  onRegenerate: () => void;
  /** Playback started: the page's own clock should stop */
  onTakeOver: () => void;
  /** Leave for the real meeting at this second */
  onJump: (seconds: number) => void;
  onTimeline: () => void;
  speakerColor: (name: string) => string;
}

const PACES = [1, 1.25, 1.5, 2];
const VOICE_KEY = 'kloud-replay-voice';
const TICK_MS = 50;

const hasSpeech = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

/**
 * Reading width (narrationChunks' unit) of the subtitle a stage of this size can show. Follows
 * the sizes in NotesReplayStage.module.css: --u, the subtitle's font size and the side padding.
 */
function subtitleWidth(width: number, height: number): number {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const u = clamp(Math.min(width / 100, height * 0.0185), 5.5, 13);
  const font = clamp(u * 1.6, 12.5, 19);
  const room = Math.min(width - 2 * clamp(u * 5, 14, 64), font * 52);
  const perLine = room / (font * 0.54);
  return Math.max(30, Math.round(perLine * (height <= 340 ? 1 : 2) * 0.88));
}

/** Seconds the narration of a slide takes on screen: the time to say it, within the slide. */
function narrationSeconds(slide: PlannedSlide, pace: number): number {
  return Math.max(0.5, Math.min(speakSeconds(slide.narration) / pace, slide.seconds * 0.92));
}

/** A narration with the words said so far lit. `spoken` counts tokens over all given chunks. */
function Karaoke({ chunks, spoken }: { chunks: NarrationChunk[]; spoken: number }) {
  let seen = 0;
  return (
    <>
      {chunks.map((chunk) =>
        chunk.tokens.map((token, i) => {
          const said = seen++ < spoken;
          return <span key={`${chunk.start}-${i}`} className={said ? s.said : s.unsaid}>{token}</span>;
        }))}
    </>
  );
}

export function PresentationPlayer(props: PresentationPlayerProps) {
  const { presentation, memory, speakerColor, onTakeOver, onJump } = props;
  const { t } = useI18n();

  const [length, setLength] = useState<PresentationLength>(() => memory.current?.length ?? 'full');
  const [pace, setPace] = useState(() => memory.current?.pace ?? 1);
  const [elapsed, setElapsed] = useState(() => memory.current?.elapsed ?? 0);
  const [started, setStarted] = useState(() => (memory.current?.elapsed ?? 0) > 0);
  const [playing, setPlaying] = useState(false);
  /** Paused and stepped to a slide by hand: it shows whole, and plays from its start */
  const [peek, setPeek] = useState(false);
  const [voice, setVoice] = useState(false);
  const [speech, setSpeech] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Character of the slide's narration the voice has reached; null while it reports nothing */
  const [voiceChar, setVoiceChar] = useState<number | null>(null);
  /** The voice is still saying the slide: playback waits at the slide's end */
  const voiceHold = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Reading width of one subtitle (see narrationChunks): what fits the stage in two lines */
  const [chunkWidth, setChunkWidth] = useState(110);

  const plan = useMemo(() => presentationPlan(presentation, length, pace), [presentation, length, pace]);
  const totals = useMemo(
    () => ({
      short: presentationPlan(presentation, 'short', pace).totalSeconds,
      full: presentationPlan(presentation, 'full', pace).totalSeconds,
    }),
    [presentation, pace],
  );
  const { position, progress } = slideAt(plan, elapsed);
  const slide = plan.slides[position];
  const ended = elapsed >= plan.totalSeconds;
  const lang = voiceLang(presentation.language);

  useEffect(() => {
    memory.current = { elapsed, length, pace };
  }, [memory, elapsed, length, pace]);

  // The voice: available on this device? did the viewer turn it on before?
  useEffect(() => {
    if (!hasSpeech()) return;
    setSpeech(true);
    try {
      setVoice(window.localStorage.getItem(VOICE_KEY) === '1');
    } catch {
      /* private mode: stays off */
    }
  }, []);

  // Subtitles are cut to what the stage can show: two lines, one on a very short stage.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setChunkWidth(subtitleWidth(el.clientWidth, el.clientHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── the clock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    // A timer, not animation frames: it keeps going (slower) when the tab is in the background.
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(2, (now - last) / 1000);
      last = now;
      setElapsed((prev) => {
        const current = plan.slides[slideAt(plan, prev).position];
        const end = current.startAt + current.seconds;
        let next = prev + dt;
        // The voice hasn't finished this slide: wait just before its end.
        if (next >= end && voiceHold.current) next = Math.max(prev, end - 0.001);
        return Math.min(plan.totalSeconds, next);
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, plan]);

  useEffect(() => {
    if (playing && ended) setPlaying(false);
  }, [playing, ended]);

  // ── the voice ──────────────────────────────────────────────────────────────
  const narration = slide?.narration ?? '';
  const chunks = useMemo(() => narrationChunks(narration, chunkWidth), [narration, chunkWidth]);
  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;
  const slideIndex = slide?.index ?? -1;
  /** Read by the voice effect when it starts, so a resume continues from the line on screen */
  const fractionRef = useRef(0);

  useEffect(() => {
    if (!speech) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    voiceHold.current = false;
    setVoiceChar(null);
    if (!playing || !voice) return;
    const lines = chunksRef.current;
    // Resuming mid-slide: start again from the subtitle line that was showing.
    const at = narrationAt(lines, fractionRef.current);
    const from = at.chunk < 0 ? 0 : at.spoken >= lines[at.chunk].tokens.length && at.chunk < lines.length - 1 ? at.chunk + 1 : at.chunk;
    const finished = at.chunk >= 0 && at.chunk === lines.length - 1 && at.spoken >= lines[at.chunk].tokens.length;
    const say = finished ? '' : lines.slice(from).map((line) => line.text).join('') || (from === 0 ? slide?.title ?? '' : '');
    if (!say.trim()) return;
    const base = narration ? lines[from]?.start ?? 0 : 0;

    let alive = true;
    const utterance = new window.SpeechSynthesisUtterance(say);
    utterance.lang = lang;
    const chosen = pickVoice(synth.getVoices(), lang);
    if (chosen) utterance.voice = chosen;
    utterance.rate = pace;
    const done = () => {
      if (alive) voiceHold.current = false;
    };
    utterance.onend = done;
    utterance.onerror = done;
    utterance.onboundary = (event) => {
      if (alive && narration) setVoiceChar(base + event.charIndex);
    };
    voiceHold.current = true;
    // Chrome drops an utterance queued in the same task as cancel().
    const speakTimer = window.setTimeout(() => synth.speak(utterance), 60);
    // A voice that never reports its end must not stall the presentation.
    const safety = window.setTimeout(done, (speakSeconds(say) / pace) * 1800 + 6000);
    return () => {
      alive = false;
      window.clearTimeout(speakTimer);
      window.clearTimeout(safety);
      utterance.onend = null;
      utterance.onerror = null;
      utterance.onboundary = null;
      voiceHold.current = false;
      synth.cancel();
    };
    // slide.title only matters together with slideIndex
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech, playing, voice, slideIndex, length, narration, pace, lang]);

  // ── actions ────────────────────────────────────────────────────────────────
  const play = useCallback(() => {
    if (ended) setElapsed(0);
    setStarted(true);
    setPeek(false);
    setPlaying(true);
    onTakeOver();
  }, [ended, onTakeOver]);
  const toggle = useCallback(() => {
    if (playing) setPlaying(false);
    else play();
  }, [playing, play]);
  const goTo = useCallback(
    (target: number) => {
      const next = plan.slides[Math.min(plan.slides.length - 1, Math.max(0, target))];
      if (!next) return;
      setStarted(true);
      setPeek(!playing);
      setElapsed(next.startAt);
    },
    [plan, playing],
  );
  const replay = () => {
    setElapsed(0);
    setPeek(false);
    setStarted(true);
    setPlaying(true);
    onTakeOver();
  };
  /** Keep the viewer on the slide they are on when the plan changes under them. */
  const replan = (nextLength: PresentationLength, nextPace: number) => {
    const next = presentationPlan(presentation, nextLength, nextPace);
    if (started && slide) {
      const same = next.slides.find((item) => item.index === slide.index);
      const target = same ?? next.slides.find((item) => item.index > slide.index) ?? next.slides[next.slides.length - 1];
      setElapsed(ended ? next.totalSeconds : target.startAt + (same ? progress * same.seconds * 0.999 : 0));
    }
    setLength(nextLength);
    setPace(nextPace);
  };
  const toggleVoice = () => {
    const next = !voice;
    setVoice(next);
    try {
      window.localStorage.setItem(VOICE_KEY, next ? '1' : '0');
    } catch {
      /* not remembered */
    }
  };
  const jump = (sec: number) => {
    setPlaying(false);
    onJump(sec);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape' && menuOpen) {
      setMenuOpen(false);
      return;
    }
    const onControl = (event.target as HTMLElement).closest('button, a, input, select, textarea');
    if (event.key === ' ' || event.code === 'Space') {
      if (onControl) return; // the button does its own thing
      event.preventDefault();
      toggle();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      goTo(position + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(position - 1);
    }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  if (!slide) return <></>;

  // ── what the slide shows right now ─────────────────────────────────────────
  // Before the first play the opening slide is a poster: everything on it shows.
  const live = started && !peek;
  const shown = live ? progress : 1;
  const timeFraction = (progress * slide.seconds) / narrationSeconds(slide, pace);
  const fraction = !started || ended || peek
    ? 1
    : voice && voiceChar !== null
      ? Math.max(narrationFractionAtChar(chunks, voiceChar), 0)
      : Math.min(1, timeFraction);
  fractionRef.current = started && !ended && !peek ? Math.min(1, fraction) : 0;
  // Stepped to by hand: the subtitle is the narration's opening line.
  const moment = peek && chunks.length > 0 ? { chunk: 0, spoken: chunks[0].tokens.length } : narrationAt(chunks, fraction);
  const spokenTotal = moment.chunk < 0
    ? 0
    : !live || ended
      ? chunks.reduce((sum, chunk) => sum + chunk.tokens.length, 0)
      : chunks.slice(0, moment.chunk).reduce((sum, chunk) => sum + chunk.tokens.length, 0) + moment.spoken;

  const duration = (seconds: number) => {
    const rough = roughDuration(seconds);
    return t(rough.unit === 'min' ? 'replay.present.durMin' : 'replay.present.durSec', { n: rough.n });
  };
  const jumpLabel = (sec: number) => t('replay.present.jump', { time: formatClock(sec) });
  const topics = plan.slides.filter((item) => item.kind === 'topic');
  const topicNumber = topics.findIndex((item) => item.index === slide.index) + 1;
  const fixedLabel: Record<PlannedSlide['kind'], string> = {
    title: props.meetingTitle || presentation.title,
    agenda: t('replay.present.agenda'),
    topic: '',
    decisions: t('replay.present.decisions'),
    actions: t('replay.present.actions'),
    closing: t('replay.present.closing'),
  };
  const labelOf = (item: PlannedSlide) => (item.kind === 'topic' ? item.title : fixedLabel[item.kind]);

  const stamp = (bullet: SlideBullet) =>
    bullet.sec === null ? null : (
      <span className={s.stamp}>
        {formatClock(bullet.sec)}
        <JumpIcon />
      </span>
    );

  /** A list row that jumps to its moment when it has one. */
  const row = (bullet: SlideBullet, key: number, className: string, visible: boolean, children: React.ReactNode) => {
    const cls = `${className} ${visible ? s.revealed : s.concealed}`;
    if (bullet.sec === null) {
      return <li key={key} className={cls} aria-hidden={!visible}>{children}</li>;
    }
    const sec = bullet.sec;
    return (
      <li key={key} className={cls} aria-hidden={!visible}>
        <button type="button" className={s.rowBtn} tabIndex={visible ? 0 : -1} title={jumpLabel(sec)} onClick={() => jump(sec)}>
          {children}
          {stamp(bullet)}
        </button>
      </li>
    );
  };

  let body: React.ReactNode = null;
  if (slide.kind === 'title') {
    const people = presentation.speakers.slice(0, 5);
    const more = presentation.speakers.length - people.length;
    body = (
      <div className={`${s.slide} ${s.slideTitle}`}>
        {props.meetingTitle && props.meetingTitle !== slide.title && <div className={s.eyebrow}>{props.meetingTitle}</div>}
        <h2 className={s.titleHero}>{slide.title || props.meetingTitle}</h2>
        {chunks.length > 0 && <p className={s.hook}><Karaoke chunks={chunks} spoken={spokenTotal} /></p>}
        {!started && (
          <button type="button" className={s.bigPlay} onClick={play} aria-label={t('replay.present.start')}>
            <span className={s.bigPlayDisc}><PlayIcon size={26} /></span>
            <span className={s.bigPlayText}>
              <strong>{t('replay.present.start')}</strong>
              <span>{formatClock(plan.totalSeconds)}</span>
            </span>
          </button>
        )}
        {people.length > 0 && (
          <ul className={s.people} aria-label={t('replay.speakers')}>
            {people.map((name) => (
              <li key={name} className={s.person}>
                <Avatar name={name} color={speakerColor(name)} />
                <span>{name}</span>
              </li>
            ))}
            {more > 0 && <li className={s.person}><span className={s.personMore}>+{more}</span></li>}
          </ul>
        )}
        <p className={s.titleMeta}>
          {props.meetingSeconds > 0
            ? t('replay.present.summaryLine', { p: duration(plan.totalSeconds), m: duration(props.meetingSeconds) })
            : duration(plan.totalSeconds)}
          {props.meetingMeta && <span className={s.titleMetaExtra}>{props.meetingMeta}</span>}
        </p>
      </div>
    );
  } else if (slide.kind === 'agenda') {
    const spot = spotlightIndex(shown, slide.bullets.length);
    body = (
      <div className={`${s.slide} ${s.slideList}`}>
        <h2 className={s.listTitle}>{t('replay.present.agenda')}<span className={s.listCount}>{slide.bullets.length}</span></h2>
        <ol className={slide.bullets.length > 4 ? `${s.agenda} ${s.agendaTwo}` : s.agenda}>
          {slide.bullets.map((bullet, i) =>
            row(bullet, i, `${s.agendaItem} ${live && i === spot ? s.agendaNow : live && i > spot ? s.agendaLater : ''}`, true, (
              <>
                <span className={s.agendaNo}>{String(i + 1).padStart(2, '0')}</span>
                <span className={s.rowText}>{bullet.text}</span>
              </>
            )))}
        </ol>
      </div>
    );
  } else if (slide.kind === 'topic') {
    const count = revealCount(shown, slide.bullets.length, 0.08, slide.quote ? 0.6 : 0.8);
    const quoteShown = shown >= 0.66;
    const range = minuteRange(slide.startSec, slide.endSec);
    body = (
      <div className={slide.quote ? `${s.slide} ${s.slideTopic} ${s.withQuote}` : `${s.slide} ${s.slideTopic}`}>
        <div className={s.topicMain}>
          <div className={s.tags}>
            <span className={s.eyebrow}>{t('replay.present.topicOf', { n: topicNumber, total: topics.length })}</span>
            {slide.importance >= 4 && <span className={s.keyTag}><KeyIcon />{t('replay.present.keyPoint')}</span>}
            {range && slide.startSec !== null && (
              <button type="button" className={s.timeTag} title={jumpLabel(slide.startSec)} onClick={() => jump(slide.startSec ?? 0)}>
                <ClockIcon />
                {range.from === range.to
                  ? t('replay.present.minuteAt', { n: range.from })
                  : t('replay.present.minuteRange', { from: range.from, to: range.to })}
              </button>
            )}
          </div>
          <h2 className={slide.importance >= 5 ? `${s.headline} ${s.headlineKey}` : s.headline}>{slide.title}</h2>
          {slide.speaker && (
            <div className={s.byline}>
              <Avatar name={slide.speaker} color={speakerColor(slide.speaker)} />
              <span>{slide.speaker}</span>
            </div>
          )}
          <ul className={s.bullets}>
            {slide.bullets.map((bullet, i) =>
              row(bullet, i, s.bullet, i < count, (
                <>
                  <span className={s.dot} aria-hidden="true" />
                  <span className={s.rowText}>{bullet.text}</span>
                </>
              )))}
          </ul>
        </div>
        {slide.quote && (
          <figure className={`${s.quote} ${quoteShown ? s.revealed : s.concealed}`} aria-hidden={!quoteShown}>
            <span className={s.quoteMark}><QuoteIcon /></span>
            <blockquote className={s.quoteText}>{slide.quote.text}</blockquote>
            <figcaption>
              <button
                type="button"
                className={s.quoteBy}
                tabIndex={quoteShown ? 0 : -1}
                title={jumpLabel(slide.quote.sec)}
                onClick={() => jump(slide.quote?.sec ?? 0)}
              >
                <Avatar name={slide.quote.speaker} color={speakerColor(slide.quote.speaker)} />
                <span className={s.quoteName}>{slide.quote.speaker}</span>
                <span className={s.stamp}>{formatClock(slide.quote.sec)}<JumpIcon /></span>
              </button>
            </figcaption>
          </figure>
        )}
      </div>
    );
  } else if (slide.kind === 'decisions') {
    const count = revealCount(shown, slide.bullets.length, 0.06, 0.75);
    body = (
      <div className={`${s.slide} ${s.slideList}`}>
        <h2 className={s.listTitle}>{t('replay.present.decisions')}<span className={s.listCount}>{slide.bullets.length}</span></h2>
        <ul className={s.decisions}>
          {slide.bullets.map((bullet, i) =>
            row(bullet, i, s.decision, i < count, (
              <>
                <span className={s.check}><CheckIcon /></span>
                <span className={s.rowText}>{bullet.text}</span>
              </>
            )))}
        </ul>
      </div>
    );
  } else if (slide.kind === 'actions') {
    const count = revealCount(shown, slide.bullets.length, 0.06, 0.75);
    body = (
      <div className={`${s.slide} ${s.slideList}`}>
        <h2 className={s.listTitle}>{t('replay.present.actions')}<span className={s.listCount}>{slide.bullets.length}</span></h2>
        <ul className={s.actions}>
          {slide.bullets.map((bullet, i) =>
            row(bullet, i, s.action, i < count, (
              <>
                <span className={bullet.owner ? s.owner : `${s.owner} ${s.ownerNone}`} title={bullet.owner || undefined}>
                  {bullet.owner && <Avatar name={bullet.owner} color={speakerColor(bullet.owner)} />}
                  <span className={s.ownerName}>{bullet.owner || t('replay.present.unassigned')}</span>
                </span>
                <span className={s.rowText}>{bullet.text}</span>
                {bullet.due && <span className={s.due}><CalendarIcon />{bullet.due}</span>}
              </>
            )))}
        </ul>
      </div>
    );
  } else {
    body = (
      <div className={`${s.slide} ${s.slideClosing}`}>
        <div className={s.eyebrow}>{t('replay.present.closing')}</div>
        <p className={s.closingText}><Karaoke chunks={chunks} spoken={spokenTotal} /></p>
        <div className={s.closingActions}>
          <button type="button" className={s.primaryBtn} onClick={replay}>
            <ReplayIcon size={16} />{t('replay.present.replay')}
          </button>
          <button type="button" className={s.ghostBtn} onClick={props.onTimeline}>
            <TimelineIcon size={16} />{t('replay.present.watchTimeline')}
          </button>
        </div>
      </div>
    );
  }

  const subtitled = slide.kind !== 'title' && slide.kind !== 'closing' && moment.chunk >= 0;
  const nextPace = PACES[(PACES.indexOf(pace) + 1) % PACES.length] ?? 1;
  const paceText = `${pace}×`;

  return (
    <div
      ref={rootRef}
      className={s.view}
      tabIndex={0}
      role="region"
      aria-roledescription={t('replay.present.badge')}
      aria-label={t('replay.present.stageLabel')}
      onKeyDown={onKeyDown}
    >
      {/* Story bar: one segment per slide, as wide as its share of the time */}
      <div className={s.story}>
        {plan.slides.map((item, i) => (
          <button
            key={item.index}
            type="button"
            className={s.storySeg}
            style={{ flexGrow: item.seconds }}
            aria-label={t('replay.present.goToSlide', { n: i + 1, title: labelOf(item) })}
            aria-current={i === position ? 'step' : undefined}
            title={labelOf(item) || undefined}
            onClick={() => goTo(i)}
          >
            <span className={s.storyTrack}>
              <span
                className={i === position ? `${s.storyFill} ${s.storyFillNow}` : s.storyFill}
                style={{ width: `${(i < position || ended ? 1 : i === position && started ? progress : 0) * 100}%` }}
              />
            </span>
          </button>
        ))}
      </div>

      <div className={s.head}>
        <div className={s.headLeft}>
          <span className={s.brand}><SparkIcon />{t('replay.present.badge')}</span>
          <span className={s.counter} aria-label={t('replay.present.slideOf', { n: position + 1, total: plan.slides.length })}>
            {position + 1} / {plan.slides.length}
          </span>
        </div>
        {props.modeSwitch}
      </div>

      <div className={s.slideArea} key={`${length}-${slide.index}`}>
        {body}
        {started && !playing && !ended && (
          <button
            type="button"
            className={s.centerPlay}
            onClick={play}
            aria-label={t('replay.present.play')}
            title={t('replay.present.play')}
          >
            <PlayIcon size={28} />
          </button>
        )}
      </div>

      <div className={subtitled ? s.subtitle : `${s.subtitle} ${s.subtitleEmpty}`} aria-live="off">
        {subtitled && (
          <p key={moment.chunk} className={s.subtitleLine}>
            <Karaoke chunks={[chunks[moment.chunk]]} spoken={moment.spoken} />
          </p>
        )}
      </div>

      <div className={s.controls}>
        <button type="button" className={s.iconBtn} onClick={() => goTo(position - 1)} disabled={position === 0 && elapsed === 0} aria-label={t('replay.present.prev')} title={t('replay.present.prev')}>
          <PrevIcon />
        </button>
        <button type="button" className={`${s.iconBtn} ${s.playBtn}`} onClick={toggle} aria-label={playing ? t('replay.present.pause') : t('replay.present.play')} title={playing ? t('replay.present.pause') : t('replay.present.play')}>
          {playing ? <PauseIcon /> : ended ? <ReplayIcon /> : <PlayIcon />}
        </button>
        <button type="button" className={s.iconBtn} onClick={() => goTo(position + 1)} disabled={position >= plan.slides.length - 1} aria-label={t('replay.present.next')} title={t('replay.present.next')}>
          <NextIcon />
        </button>
        <span className={s.time} aria-label={t('replay.present.timeOf', { now: formatClock(elapsed), total: formatClock(plan.totalSeconds) })}>
          <span>{formatClock(elapsed)}</span>
          <span className={s.timeTotal}> / {formatClock(plan.totalSeconds)}</span>
        </span>
        <span className={s.spacer} />
        <Segmented<PresentationLength>
          className={s.lengthSwitch}
          label={t('replay.present.lengthLabel')}
          value={length}
          onChange={(value) => replan(value, pace)}
          options={[
            { value: 'short', label: t('replay.present.lengthShort'), detail: formatClock(totals.short) },
            { value: 'full', label: t('replay.present.lengthFull'), detail: formatClock(totals.full) },
          ]}
        />
        <button type="button" className={s.paceBtn} onClick={() => replan(length, nextPace)} aria-label={t('replay.present.speed', { speed: paceText })} title={t('replay.present.speed', { speed: paceText })}>
          {paceText}
        </button>
        {speech && (
          <button type="button" className={voice ? `${s.iconBtn} ${s.iconBtnOn}` : s.iconBtn} onClick={toggleVoice} aria-pressed={voice} aria-label={t('replay.present.voice')} title={voice ? t('replay.present.voiceOff') : t('replay.present.voiceOn')}>
            {voice ? <VoiceOnIcon /> : <VoiceOffIcon />}
          </button>
        )}
        {props.canManage && (
          <div className={s.menuWrap} ref={menuRef}>
            <button type="button" className={s.iconBtn} onClick={() => setMenuOpen((open) => !open)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label={t('replay.present.more')} title={t('replay.present.more')}>
              {props.regenerating ? <Spinner /> : <MoreIcon />}
            </button>
            {menuOpen && (
              <div className={s.menu} role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className={s.menuItem}
                  disabled={props.regenerating}
                  onClick={() => {
                    setMenuOpen(false);
                    setPlaying(false);
                    props.onRegenerate();
                  }}
                >
                  {props.regenerating ? <Spinner /> : <ReplayIcon size={15} />}
                  {props.regenerating ? t('replay.present.regenerating') : t('replay.present.regenerate')}
                </button>
                <p className={s.menuNote}>{t('replay.aiNote')}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
