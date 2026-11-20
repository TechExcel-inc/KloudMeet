'use client';

/**
 * The stage of an "AI Notes Only" replay: there is no picture and no sound, so the stage shows
 * either the AI presentation of the meeting (slides that play by themselves, much shorter than
 * the meeting) or the full timeline as large captions that follow the page's clock.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import s from '@/styles/NotesReplayStage.module.css';
import { useI18n } from '@/lib/i18n';
import type { PresentationState } from '@/lib/meetingPresentation';
import { captionAt, formatClock, sectionAt, timedLines } from '@/lib/notesReplay/captions';
import { PresentationPlayer, type PlayerMemory } from '@/lib/notesReplay/PresentationPlayer';
import { AlertIcon, Avatar, PlayIcon, Segmented, SparkIcon, Spinner, TimelineIcon } from '@/lib/notesReplay/parts';

export interface NotesTranscriptLine { id: number; speakerName: string; content: string; offsetSeconds: number | null }
export interface NotesSection { title: string; startSec: number; endSec: number }
export type NotesStageMode = 'presentation' | 'timeline';

export interface NotesReplayStageProps {
  meetingTitle: string;
  /** e.g. "Nov 19, 2026 · 47 min" — already formatted by the page; may be empty */
  meetingMeta: string;
  presentation: PresentationState;
  /** Whole meeting, ordered by time */
  transcripts: NotesTranscriptLine[];
  /** AI chapters of the real meeting (may be empty) */
  sections: NotesSection[];
  /** Length of the real meeting in seconds */
  durationSeconds: number;
  /** The page's playback clock (seconds into the meeting) and whether it is running */
  currentTime: number;
  playing: boolean;
  mode: NotesStageMode;
  onModeChange: (mode: NotesStageMode) => void;
  /** Timeline: move the page's clock to this second and play */
  onSeek: (seconds: number) => void;
  /** Ask the page to pause its clock (call when the presentation takes over) */
  onPauseClock: () => void;
  /** The viewer may (re)generate the presentation */
  canManage: boolean;
  /** A (re)generation the viewer asked for is running */
  regenerating: boolean;
  onRegenerate: () => void;
  /** Stable colour for a speaker's avatar, same as the rest of the page */
  speakerColor: (name: string) => string;
}

export function NotesReplayStage(props: NotesReplayStageProps): JSX.Element {
  const { mode, onModeChange, onSeek, onPauseClock, presentation } = props;
  const { t } = useI18n();
  /** Where the viewer was in the presentation, so coming back from the timeline resumes there */
  const memory = useRef<PlayerMemory | null>(null);

  // The page's clock has nothing to show while the presentation is up.
  const clockRunning = props.playing;
  useEffect(() => {
    if (mode === 'presentation' && clockRunning) onPauseClock();
  }, [mode, clockRunning, onPauseClock]);

  const modeSwitch = (
    <Segmented<NotesStageMode>
      className={s.modeSwitch}
      label={t('replay.present.modeLabel')}
      value={mode}
      onChange={onModeChange}
      options={[
        { value: 'presentation', label: t('replay.present.modePresentation'), icon: <SparkIcon size={13} /> },
        { value: 'timeline', label: t('replay.present.modeTimeline'), icon: <TimelineIcon size={13} /> },
      ]}
    />
  );
  const toTimeline = () => onModeChange('timeline');
  const ready = presentation.status === 'READY' && presentation.content !== null && presentation.content.slides.length > 0;

  // A presentation that went away (regenerating) starts from the top when the new one arrives.
  useEffect(() => {
    if (!ready) memory.current = null;
  }, [ready]);

  let view: React.ReactNode;
  if (mode === 'timeline') {
    view = <CaptionStage {...props} modeSwitch={modeSwitch} presentationReady={ready} />;
  } else if (ready && presentation.content) {
    view = (
      <PresentationPlayer
        presentation={presentation.content}
        meetingTitle={props.meetingTitle}
        meetingMeta={props.meetingMeta}
        meetingSeconds={props.durationSeconds || presentation.content.meetingSeconds}
        memory={memory}
        modeSwitch={modeSwitch}
        canManage={props.canManage}
        regenerating={props.regenerating}
        onRegenerate={props.onRegenerate}
        onTakeOver={onPauseClock}
        onJump={(seconds) => {
          onModeChange('timeline');
          onSeek(seconds);
        }}
        onTimeline={toTimeline}
        speakerColor={props.speakerColor}
      />
    );
  } else {
    const generating = presentation.status === 'GENERATING';
    const failed = presentation.status === 'FAILED';
    view = (
      <div className={s.view}>
        <div className={s.head}>
          <div className={s.headLeft}>
            <span className={s.brand}><SparkIcon />{t('replay.present.badge')}</span>
          </div>
          {modeSwitch}
        </div>
        <div className={s.state} role="status" aria-live="polite">
          {generating ? (
            <div className={s.deck} aria-hidden="true">
              <span className={s.deckCard} />
              <span className={s.deckCard} />
              <span className={s.deckCard}>
                <i /><i /><i />
              </span>
            </div>
          ) : (
            <span className={failed ? `${s.stateIcon} ${s.stateIconWarn}` : s.stateIcon} aria-hidden="true">
              {failed ? <AlertIcon /> : <SparkIcon size={22} />}
            </span>
          )}
          <h2 className={s.stateTitle}>
            {generating ? t('replay.present.generatingTitle') : failed ? t('replay.present.failedTitle') : t('replay.present.noneTitle')}
          </h2>
          <p className={s.stateHint}>
            {generating
              ? t('replay.present.generatingHint')
              : failed
                ? t(props.canManage ? 'replay.present.failedHintManage' : 'replay.present.failedHint')
                : t(props.canManage ? 'replay.present.noneHintManage' : 'replay.present.noneHint')}
          </p>
          <div className={s.stateActions}>
            {!generating && props.canManage && (
              <button type="button" className={s.primaryBtn} onClick={props.onRegenerate} disabled={props.regenerating} aria-busy={props.regenerating}>
                {props.regenerating ? <Spinner /> : <SparkIcon size={15} />}
                {props.regenerating ? t('replay.present.generatingShort') : t('replay.present.generate')}
              </button>
            )}
            <button type="button" className={s.ghostBtn} onClick={toTimeline}>
              <TimelineIcon size={16} />{t('replay.present.watchTimeline')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.stage} data-mode={mode}>
      <div className={s.glow} aria-hidden="true" />
      {view}
    </div>
  );
}

// ── Full timeline: the meeting as captions ───────────────────────────────────

function CaptionStage(props: NotesReplayStageProps & { modeSwitch: React.ReactNode; presentationReady: boolean }) {
  const { currentTime, sections, onSeek, speakerColor } = props;
  const { t } = useI18n();
  const lines = useMemo(() => timedLines(props.transcripts), [props.transcripts]);
  const moment = captionAt(lines, currentTime);
  const section = sectionAt(sections, currentTime);
  const duration = Math.max(props.durationSeconds, lines.length ? lines[lines.length - 1].offsetSeconds : 0, 1);
  const { current, previous, next } = moment;

  const size = !current ? 'm' : current.content.length > 220 ? 'xs' : current.content.length > 120 ? 's' : current.content.length > 48 ? 'm' : 'l';

  return (
    <div className={s.view} role="region" aria-label={t('replay.notesStage.label')}>
      {/* Where we are in the meeting: its sections, or one bar when it has none */}
      <div className={s.story}>
        {sections.length > 0 ? (
          sections.map((item, i) => {
            const end = i + 1 < sections.length ? Math.max(item.endSec, sections[i + 1].startSec) : Math.max(item.endSec, duration);
            const fill = i < section.index ? 1 : i === section.index ? section.progress : 0;
            return (
              <button
                key={`${item.startSec}-${i}`}
                type="button"
                className={s.storySeg}
                style={{ flexGrow: Math.max(1, end - item.startSec) }}
                title={item.title}
                aria-label={t('replay.notesStage.goToSection', { n: i + 1, title: item.title })}
                aria-current={i === section.index ? 'step' : undefined}
                onClick={() => onSeek(item.startSec)}
              >
                <span className={s.storyTrack}>
                  <span className={i === section.index ? `${s.storyFill} ${s.storyFillNow}` : s.storyFill} style={{ width: `${fill * 100}%` }} />
                </span>
              </button>
            );
          })
        ) : (
          <span className={s.storySeg} style={{ flexGrow: 1 }}>
            <span className={s.storyTrack}>
              <span className={`${s.storyFill} ${s.storyFillNow}`} style={{ width: `${Math.min(1, Math.max(0, currentTime / duration)) * 100}%` }} />
            </span>
          </span>
        )}
      </div>

      <div className={s.head}>
        <div className={s.headLeft}>
          {section.index >= 0 ? (
            <>
              <span className={s.sectionTitle} title={sections[section.index].title}>{sections[section.index].title}</span>
              <span className={s.counter}>{section.index + 1} / {sections.length}</span>
            </>
          ) : (
            <span className={s.brand}><TimelineIcon />{t('replay.present.modeTimeline')}</span>
          )}
        </div>
        {props.modeSwitch}
      </div>

      {lines.length === 0 ? (
        <div className={s.state}>
          <span className={s.stateIcon} aria-hidden="true"><TimelineIcon size={22} /></span>
          <h2 className={s.stateTitle}>{t('replay.notesStage.empty')}</h2>
          <p className={s.stateHint}>{t('replay.notesStage.emptyHint')}</p>
        </div>
      ) : !current ? (
        <div className={s.state}>
          <span className={s.quietDots} aria-hidden="true"><i /><i /><i /></span>
          <h2 className={s.stateTitle}>{t('replay.notesStage.beforeFirst')}</h2>
          <p className={s.stateHint}>
            {t('replay.notesStage.firstAt', { name: lines[0].speakerName || t('replay.notesStage.someone'), time: formatClock(lines[0].offsetSeconds) })}
          </p>
          <div className={s.stateActions}>
            <button type="button" className={s.ghostBtn} onClick={() => onSeek(lines[0].offsetSeconds)}>
              <PlayIcon size={14} />{t('replay.notesStage.skipToFirst')}
            </button>
          </div>
        </div>
      ) : (
        <div className={s.captions} aria-live="off">
          <p className={moment.quiet ? `${s.capPrev} ${s.capQuietPrev}` : s.capPrev} key={`p${previous?.id ?? 'none'}`}>
            {previous && (
              <>
                <span className={s.capPrevName}>{previous.speakerName}</span>
                {previous.content}
              </>
            )}
          </p>
          <div className={moment.quiet ? `${s.capNow} ${s.capNowQuiet}` : s.capNow} key={`c${current.id}`}>
            <div className={s.capWho}>
              <Avatar name={current.speakerName} color={speakerColor(current.speakerName)} className={s.capAvatar} />
              <span className={s.capName}>{current.speakerName || t('replay.notesStage.someone')}</span>
              <span className={s.capTime}>{formatClock(current.offsetSeconds)}</span>
            </div>
            <p className={s.capText} data-size={size}>{current.content}</p>
          </div>
          {moment.quiet ? (
            <p className={s.capQuiet} key="quiet">
              <span className={s.quietDots} aria-hidden="true"><i /><i /><i /></span>
              {next && moment.nextIn !== null
                ? t('replay.notesStage.nextIn', { name: next.speakerName || t('replay.notesStage.someone'), time: formatClock(Math.ceil(moment.nextIn)) })
                : t('replay.notesStage.ended')}
            </p>
          ) : (
            <p className={s.capNext} key={`n${next?.id ?? 'none'}`}>
              {next && (
                <>
                  <span className={s.capPrevName}>{next.speakerName}</span>
                  {next.content}
                </>
              )}
            </p>
          )}
        </div>
      )}

      {props.presentationReady && (
        <div className={s.backRow}>
          <button type="button" className={s.backBtn} onClick={() => props.onModeChange('presentation')}>
            <SparkIcon size={13} />{t('replay.notesStage.backToPresentation')}
          </button>
        </div>
      )}
    </div>
  );
}
