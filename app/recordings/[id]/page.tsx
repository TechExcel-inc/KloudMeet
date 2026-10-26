'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useI18n, LOCALE_OPTIONS } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';
import { HelpModal } from '@/lib/HelpModal';
import { authHeaders, getKloudSessionBearer } from '@/lib/kloudSession';
import { recordingReplayPath } from '@/lib/recordingReplayPath';
import { RecordingTranscribePrompt } from '@/lib/RecordingTranscribePrompt';
import { IDLE_TRANSCRIBE, isSttActive, type TranscribeState } from '@/lib/recordingTranscribeState';
import { skipPaused } from '@/lib/recordingControls';
import { LiveDocReplayStage, type LiveDocReplayInfo } from '@/lib/LiveDocReplayStage';
import s from '@/styles/Replay.module.css';

/* ─── Types ──────────────────────────────────────────────── */
interface Participant {
  id: number;
  displayName: string;
  joinedAt: string;
  leftAt: string | null;
  durationSeconds: number | null;
  member: {
    id: number;
    fullName: string | null;
    username: string;
    avatarUrl: string | null;
  } | null;
}

interface SummaryItem {
  id: number;
  title: string;
  content: string;
  timeOffset: string; // HH:mm:ss
  /** AI 生成时写入；旧数据可能为空 */
  speaker?: string | null;
  /** 本节要点及原话时间；旧版摘要没有 */
  points?: { text: string; sec: number }[] | null;
  sortOrder: number;
}

/** Structured summary head: topic, overview, who spoke, to-dos (null for older summaries) */
interface SummaryHead {
  topic: string | null;
  overview: string | null;
  speakers: string[] | null;
  todos: { task: string; owner: string | null; due: string | null; sec: number }[] | null;
  /** Internal staff only: which model wrote it, and why DeepSeek was skipped (null when it wasn't) */
  generation?: { model: string | null; fallbackReason: string | null; at: string } | null;
}

/** Internal note above the summary: who wrote it, and why DeepSeek was skipped if it was. */
function InternalNote({ generation }: { generation: NonNullable<SummaryHead['generation']> }) {
  const { t, locale } = useI18n();
  const model = /^gpt-/i.test(generation.model || '') ? `OpenAI ${generation.model}` : generation.model || '?';
  const time = new Date(generation.at).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const reason = generation.fallbackReason;
  const why =
    reason === 'timeout'
      ? t('replay.fallbackTimeout')
      : reason === 'no-key'
        ? t('replay.fallbackNoKey')
        : reason
          ? t('replay.fallbackError', { detail: reason })
          : '';
  return (
    <p className={reason ? s.internalNoteWarn : s.internalNote} role="note">
      <span className={s.internalTag}>{t('replay.internalTag')}</span>
      <span>
        {why && `${why}${t('replay.fallbackJoin')}`}
        {t(reason ? 'replay.fallbackModel' : 'replay.generatedBy', { model, time })}
      </span>
    </p>
  );
}

interface Transcript {
  id: number;
  speakerName: string;
  content: string;
  captionTime: string;
  offsetSeconds: number | null;
}

interface ReplayData {
  recording: {
    id: number;
    fileName: string;
    durationSeconds: number | null;
    /** Paused stretches [start, end] in seconds; the player jumps over them */
    pausedRanges?: Array<[number, number]>;
    streamUrl: string | null;
    status: string;
    createdAt: string;
    recordedBy: { fullName: string | null; username: string } | null;
    canManage: boolean;
    /** 已登录且能观看时为 true，用于弹出解析字幕 */
    canTranscribe?: boolean;
    /** 旧版服务端不返回该字段 */
    transcribe?: TranscribeState;
    /** LiveDoc Full Recording: replay LiveDoc, screen shares and SmartCam on the voice's clock */
    livedoc?: LiveDocReplayInfo | null;
  };
  meeting: {
    id: number;
    kloudMeetingId: number | null;
    title: string | null;
    roomName: string;
    status: string;
    actualStartedAt: string | null;
    endedAt: string | null;
    actualDurationMinutes: number | null;
    createdBy: { fullName: string | null; username: string } | null;
    participants: Participant[];
    summaryItems: SummaryItem[];
    summary?: SummaryHead | null;
    transcripts: Transcript[];
  } | null;
}

/* ─── Helpers ────────────────────────────────────────────── */
function fmtTime(secs: number | null | undefined): string {
  if (secs === null || secs === undefined || secs < 0) return '--:--';
  if (secs === 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const sec = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function offsetToSecs(offset: string): number {
  if (!offset) return 0;
  const parts = offset.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** 章节时间窗内发言条数最多的 speakerName；无字幕则空串 */
function dominantSpeaker(transcripts: Transcript[], startSec: number, endSec: number): string {
  const counts = new Map<string, number>();
  for (const row of transcripts) {
    if (row.offsetSeconds === null || row.offsetSeconds === undefined) continue;
    if (row.offsetSeconds < startSec || row.offsetSeconds >= endSec) continue;
    const name = (row.speakerName || '').trim();
    if (!name || name === 'Speaker 1' || name === 'Unknown') continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/** Six calm tones (light tint + deep ink); the lane colour is the same hue, half strength. */
const TONE_COUNT = 6;
const LANE_COLORS = ['#8D8BEF', '#4FB8A3', '#E2A64B', '#E07A95', '#5AA9DE', '#A685E0'];
function toneIndex(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % TONE_COUNT;
}
function speakerColor(name: string, tones: Record<string, number>): string {
  return LANE_COLORS[tones[name] ?? toneIndex(name)];
}

/** Follow the theme chosen on the home page (pre-meeting pages share html[data-theme]). */
function useStoredTheme() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.hasAttribute('data-theme')) return;
    try {
      const stored = window.localStorage.getItem('kloud-theme');
      if (stored === 'dark' || stored === 'light') root.setAttribute('data-theme', stored);
    } catch {
      /* ignore */
    }
  }, []);
}

/**
 * Per page: profile photos by display name, and a tone per person given out in order of
 * appearance so no two people on the same page share a colour.
 */
const AvatarContext = React.createContext<{ photos: Record<string, string>; tones: Record<string, number> }>({
  photos: {},
  tones: {},
});

function Avatar({ name, className }: { name: string; className: string }) {
  const { photos, tones } = React.useContext(AvatarContext);
  const photo = photos[name];
  if (photo) {
    return (
      <span className={`${className} ${s.avatarPhoto}`} aria-hidden="true">
        <img src={photo} alt="" />
      </span>
    );
  }
  return (
    <span className={`${className} ${s[`tone${tones[name] ?? toneIndex(name)}`]}`} aria-hidden="true">
      {getInitials(name)}
    </span>
  );
}

/* ─── Chapter Cards + Speaker Timeline types ─────────────── */

interface ChapterCard {
  id: number;
  startSec: number;
  endSec: number;
  timeRange: string;
  speaker: string;
  topic: string;
}

interface SpeakerSegment {
  name: string;
  color: string;
  segments: [number, number][];
}

/* ─── Chapters / Speakers (one card, switched by pills) ───── */
function StageViews({
  chapters,
  speakers,
  duration,
  currentTime,
  onSelectChapter,
  onSeek,
}: {
  chapters: ChapterCard[];
  speakers: SpeakerSegment[];
  duration: number;
  currentTime: number;
  onSelectChapter: (ch: ChapterCard) => void;
  onSeek: (secs: number) => void;
}) {
  const { t } = useI18n();
  const hasChapters = chapters.length > 0;
  const hasSpeakers = speakers.length > 0 && duration > 0;
  const [view, setView] = useState<'chapters' | 'speakers'>(hasChapters ? 'chapters' : 'speakers');
  const shown = view === 'chapters' && !hasChapters ? 'speakers' : view === 'speakers' && !hasSpeakers ? 'chapters' : view;
  if (!hasChapters && !hasSpeakers) return null;

  return (
    <section className={s.card}>
      {/* A switch with one option is noise: show the pills only when both views exist */}
      {hasChapters && hasSpeakers && (
        <div className={s.pills} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={shown === 'chapters'}
            className={shown === 'chapters' ? s.pillOn : s.pill}
            onClick={() => setView('chapters')}
          >
            <ListGlyph />
            {t('replay.chapters')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={shown === 'speakers'}
            className={shown === 'speakers' ? s.pillOn : s.pill}
            onClick={() => setView('speakers')}
          >
            <PersonGlyph />
            {t('replay.speakers')}
          </button>
        </div>
      )}
      {shown === 'chapters' ? (
        <ChapterCardsCarousel chapters={chapters} currentTime={currentTime} onSelect={onSelectChapter} />
      ) : (
        <SpeakerSegmentTimeline speakers={speakers} duration={duration} onSeek={onSeek} />
      )}
    </section>
  );
}

function ChapterCardsCarousel({
  chapters,
  currentTime,
  onSelect,
}: {
  chapters: ChapterCard[];
  currentTime: number;
  onSelect: (ch: ChapterCard) => void;
}) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const check = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  };
  const scroll = (dir: 'l' | 'r') => {
    scrollRef.current?.scrollBy({ left: dir === 'l' ? -220 : 220, behavior: 'smooth' });
    setTimeout(check, 350);
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    check();
    return () => {
      el.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  // 高亮始终跟随播放时间；点击卡片会跳到该章开头，高亮随之移过去
  const autoIdx = chapters.reduce(
    (acc, c, i) => (currentTime >= c.startSec && currentTime < c.endSec ? i : acc),
    -1,
  );

  return (
    <div className={s.chapterRow}>
      {canLeft && (
        <button
          type="button"
          className={`${s.scrollBtn} ${s.scrollLeft}`}
          onClick={() => scroll('l')}
          aria-label={t('replay.scrollChaptersLeft')}
          title={t('replay.scrollChaptersLeft')}
        >
          <Chevron dir="left" />
        </button>
      )}
      <div ref={scrollRef} className={s.chapterTrack}>
        {chapters.map((ch, idx) => {
          const isActive = idx === autoIdx;
          return (
            <button
              type="button"
              key={ch.id}
              className={isActive ? s.chapterOn : s.chapter}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => onSelect(ch)}
              title={`${ch.timeRange} ${ch.topic}`}
            >
              <span className={s.chapterTime}>{fmtTime(ch.startSec)}</span>
              <span className={s.chapterTopic}>{ch.topic}</span>
              {ch.speaker && (
                <span className={s.chapterSpeaker}>
                  <Avatar name={ch.speaker} className={s.dot} />
                  <span>{ch.speaker}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      {canRight && (
        <button
          type="button"
          className={`${s.scrollBtn} ${s.scrollRight}`}
          onClick={() => scroll('r')}
          aria-label={t('replay.scrollChaptersRight')}
          title={t('replay.scrollChaptersRight')}
        >
          <Chevron dir="right" />
        </button>
      )}
    </div>
  );
}

/* ─── Speakers ────────────────────────────────────────────── */
function SpeakerSegmentTimeline({
  speakers,
  duration,
  onSeek,
}: {
  speakers: SpeakerSegment[];
  duration: number;
  onSeek: (secs: number) => void;
}) {
  const { t } = useI18n();
  if (!speakers.length || !duration) return null;
  const pct = (secs: number) => `${((secs / duration) * 100).toFixed(2)}%`;
  const spoken = speakers.map((sp) => sp.segments.reduce((sum, [a, b]) => sum + (b - a), 0));
  const total = spoken.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className={s.lanes}>
      {speakers.map((sp, i) => {
        const share = Math.round((spoken[i] / total) * 100);
        return (
          <div key={sp.name} className={s.lane}>
            <div className={s.laneName} title={t('replay.talkShare', { name: sp.name, pct: share })}>
              <Avatar name={sp.name} className={s.dot} />
              <span className={s.laneLabel}>{sp.name}</span>
              <span className={s.laneShare}>{share}%</span>
            </div>
            <div
              className={s.laneBar}
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                onSeek(((e.clientX - rect.left) / rect.width) * duration);
              }}
            >
              {sp.segments.map(([start, end], j) => (
                <div
                  key={j}
                  className={s.laneSeg}
                  title={t('replay.speakerStarts', { name: sp.name, time: fmtTime(start) })}
                  style={{ left: pct(start), width: pct(end - start), background: sp.color }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onSeek(start);
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────── */

/** "一、" in Chinese, "1." elsewhere — section numbers for the summary. */
function sectionNumber(n: number, locale: string): string {
  if (locale !== 'zh') return `${n}.`;
  const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const word =
    n <= 10 ? d[n] : n < 20 ? `十${d[n - 10]}` : n < 100 ? `${d[Math.floor(n / 10)]}十${n % 10 ? d[n % 10] : ''}` : String(n);
  return `${word}、`;
}

/** 章节摘要面板 */
function SummaryPanel({
  items,
  currentTime,
  onSeek,
  meetingId,
  kloudMeetingId,
  focus,
  canManage,
  head,
}: {
  items: SummaryItem[];
  currentTime: number;
  onSeek: (secs: number) => void;
  meetingId: number;
  kloudMeetingId: number | null;
  /** 点击章节卡片时展开并滚动到对应摘要；n 让重复点同一章也生效 */
  focus?: { id: number; n: number } | null;
  /** 只有能管理录制的人才能去拉取 / 生成纪要 */
  canManage: boolean;
  head?: SummaryHead | null;
}) {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(false);
  const [localItems, setLocalItems] = useState<SummaryItem[]>(items);
  // 默认全部展开，方便直接阅读；只记录被收起的条目
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const itemRefs = useRef<Record<number, HTMLElement | null>>({});
  const [overviewOpen, setOverviewOpen] = useState(false);

  useEffect(() => setLocalItems(items), [items]);

  // 外部点击章节卡片时展开并滚动到对应摘要
  useEffect(() => {
    if (!focus) return;
    setCollapsed((prev) => {
      if (!prev.has(focus.id)) return prev;
      const next = new Set(prev);
      next.delete(focus.id);
      return next;
    });
    itemRefs.current[focus.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focus]);

  const toggle = (itemId: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  // 高亮当前所在章节
  const activeIdx = localItems.reduce((acc, item, idx) => {
    const start = offsetToSecs(item.timeOffset);
    return start <= currentTime ? idx : acc;
  }, -1);

  if (!localItems.length) {
    return (
      <div className={s.empty}>
        <span className={s.emptyIcon} aria-hidden="true">
          <DocGlyph />
        </span>
        <p className={s.emptyTitle}>{meetingId ? t('replay.noSummary') : t('replay.noSummaryData')}</p>
        {!!meetingId && canManage && (
          <p className={s.muted}>{kloudMeetingId ? t('replay.summaryHint') : t('replay.summaryNoSource')}</p>
        )}
        {!!meetingId && kloudMeetingId && canManage ? (
          <button
            type="button"
            className={s.primaryBtn}
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try {
                const stored =
                  typeof window !== 'undefined' ? localStorage.getItem('kloudUser') : null;
                const token = stored ? JSON.parse(stored).token || '' : '';
                const res = await fetch(`/api/meeting-summary/${meetingId}`, {
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                });
                const data = await res.json();
                if (data.items?.length) {
                  setLocalItems(data.items);
                } else {
                  alert(t('replay.summaryEmpty'));
                }
              } catch {
                alert(t('replay.summaryFailed'));
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? t('replay.fetchingSummary') : t('replay.fetchSummary')}
          </button>
        ) : null}
      </div>
    );
  }

  const structured = localItems.some((item) => Array.isArray(item.points) && item.points.length > 0);
  if (!structured) return renderLegacy();

  // The point being played: the last one whose time has passed
  const allPoints = localItems.flatMap((item) => item.points ?? []);
  const nowSec = allPoints.reduce((acc, p) => (p.sec <= currentTime && p.sec > acc ? p.sec : acc), -1);
  const speakers = head?.speakers ?? [];
  const todos = head?.todos ?? [];
  const overview = head?.overview ?? '';
  const longOverview = overview.length > 140;
  const timeButton = (sec: number) => (
    <button type="button" className={s.timeLink} onClick={() => onSeek(sec)} title={t('replay.jumpHere')}>
      {fmtTime(sec)}
    </button>
  );

  return (
    <div className={s.tabBody}>
      <div className={s.scroll}>
        {head?.generation && <InternalNote generation={head.generation} />}
        {(head?.topic || speakers.length > 0 || overview) && (
          <dl className={s.summaryMeta}>
            {head?.topic && (
              <>
                <dt>{t('replay.topic')}</dt>
                <dd>{head.topic}</dd>
              </>
            )}
            {speakers.length > 0 && (
              <>
                <dt>{t('replay.speakers')}</dt>
                <dd className={s.speakerChips}>
                  {speakers.map((name) => (
                    <span key={name} className={s.speakerChip}>
                      <Avatar name={name} className={s.chipAvatar} />
                      {name}
                    </span>
                  ))}
                </dd>
              </>
            )}
            {overview && (
              <>
                <dt>{t('replay.overview')}</dt>
                <dd>
                  <span className={longOverview && !overviewOpen ? s.overviewClamp : undefined}>{overview}</span>
                  {longOverview && (
                    <button type="button" className={s.moreBtn} onClick={() => setOverviewOpen((v) => !v)}>
                      {overviewOpen ? t('replay.showLess') : t('replay.showMore')}
                    </button>
                  )}
                </dd>
              </>
            )}
          </dl>
        )}

        {localItems.map((item, idx) => {
          const start = offsetToSecs(item.timeOffset);
          const isOpen = !collapsed.has(item.id);
          const points = item.points ?? [];
          return (
            <section
              key={item.id}
              ref={(el) => {
                itemRefs.current[item.id] = el;
              }}
              className={s.section}
            >
              <div className={s.summaryHead}>
                <button type="button" className={s.summaryTitle} onClick={() => onSeek(start)}>
                  <span className={s.summaryNo}>{sectionNumber(idx + 1, locale)}</span>
                  {item.title}
                </button>
                {item.speaker && (
                  <span className={s.sectionWho}>
                    <Avatar name={item.speaker} className={s.chipAvatar} />
                    {item.speaker}
                  </span>
                )}
                {!isOpen && timeButton(start)}
                <button
                  type="button"
                  className={s.foldBtn}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? t('replay.collapseItem') : t('replay.expandItem')}
                  title={isOpen ? t('replay.collapseItem') : t('replay.expandItem')}
                  onClick={() => toggle(item.id)}
                >
                  <svg className={isOpen ? s.summaryChevronOpen : s.summaryChevron} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
              {isOpen && (
                <ul className={s.points}>
                  {points.map((point, pi) => (
                    <li key={pi} className={point.sec === nowSec ? s.pointNow : s.point}>
                      {point.text}
                      {timeButton(point.sec)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        {todos.length > 0 && (
          <section className={s.todos}>
            <h3 className={s.todosTitle}>
              {t('replay.todos')} <span className={s.todosCount}>{todos.length}</span>
            </h3>
            {todos.map((todo, ti) => (
              <div key={ti} className={s.todo}>
                {todo.owner ? (
                  <Avatar name={todo.owner} className={s.chipAvatar} />
                ) : (
                  <span className={`${s.chipAvatar} ${s.noOwnerAvatar}`} aria-hidden="true">?</span>
                )}
                <div className={s.todoBody}>
                  <div className={s.todoTask}>{todo.task}</div>
                  <div className={s.todoMeta}>
                    {todo.owner ? <span>{todo.owner}</span> : <span className={s.noOwner}>{t('replay.noOwner')}</span>}
                    {todo.due && <span className={s.due}>{todo.due}</span>}
                  </div>
                </div>
                {timeButton(todo.sec)}
              </div>
            ))}
          </section>
        )}
      </div>
      <p className={s.panelFoot}>{t('replay.aiNote')}</p>
    </div>
  );

  /** 旧版摘要（只有分章，没有要点时间）照原样显示 */
  function renderLegacy() {
    return (
      <div className={s.tabBody}>
        <div className={s.scroll}>
          {canManage && <p className={s.legacyNote}><SparkGlyph />{t('replay.legacySummary')}</p>}
          {localItems.map((item, idx) => {
            const start = offsetToSecs(item.timeOffset);
            const isOpen = !collapsed.has(item.id);
            const timeLink = (
              <button type="button" className={s.timeLink} onClick={() => onSeek(start)} title={t('replay.jumpHere')}>
                {fmtTime(start)}
              </button>
            );
            return (
              <article
                key={item.id}
                ref={(el) => {
                  itemRefs.current[item.id] = el;
                }}
                className={idx === activeIdx ? s.noteOn : s.note}
              >
                <div className={s.summaryHead}>
                  <button type="button" className={s.summaryTitle} onClick={() => onSeek(start)}>
                    <span className={s.summaryNo}>{sectionNumber(idx + 1, locale)}</span>
                    {item.title}
                  </button>
                  {item.content && (
                    <button
                      type="button"
                      className={s.foldBtn}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? t('replay.collapseItem') : t('replay.expandItem')}
                      title={isOpen ? t('replay.collapseItem') : t('replay.expandItem')}
                      onClick={() => toggle(item.id)}
                    >
                      <svg className={isOpen ? s.summaryChevronOpen : s.summaryChevron} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  )}
                </div>
                {isOpen && item.content ? (
                  <p className={s.summaryText}>
                    {item.content}
                    {timeLink}
                  </p>
                ) : (
                  <div className={s.summaryFoot}>{timeLink}</div>
                )}
              </article>
            );
          })}
        </div>
        <p className={s.panelFoot}>{t('replay.aiNote')}</p>
      </div>
    );
  }
}

/** 逐字稿面板 */
function TranscriptPanel({
  transcripts,
  currentTime,
  onSeek,
}: {
  transcripts: Transcript[];
  currentTime: number;
  onSeek: (secs: number) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const activeRef = useRef<HTMLElement | null>(null);

  const filtered = search
    ? transcripts.filter((row) => row.content.toLowerCase().includes(search.toLowerCase()))
    : transcripts;

  // 当前正在播放的字幕
  const activeId = transcripts.reduce((acc, row) => {
    if (row.offsetSeconds !== null && row.offsetSeconds <= currentTime) return row.id;
    return acc;
  }, -1);

  // 自动滚动
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeId]);

  // 按说话人分组（连续同一人合并）
  type Group = { speaker: string; items: Transcript[] };
  const groups: Group[] = [];
  for (const row of filtered) {
    if (!groups.length || groups[groups.length - 1].speaker !== row.speakerName) {
      groups.push({ speaker: row.speakerName, items: [row] });
    } else {
      groups[groups.length - 1].items.push(row);
    }
  }

  return (
    <div className={s.tabBody}>
      <label className={s.search}>
        <SearchGlyph />
        <input
          placeholder={t('replay.searchPlaceholder')}
          aria-label={t('replay.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            type="button"
            className={s.clearBtn}
            onClick={() => setSearch('')}
            aria-label={t('replay.clearSearch')}
            title={t('replay.clearSearch')}
          >
            <CloseGlyph size={12} />
          </button>
        )}
      </label>

      <div className={s.scroll}>
        {!filtered.length && (
          <div className={s.empty}>
            <p className={s.muted}>{search ? t('replay.noMatch') : t('replay.noTranscript')}</p>
          </div>
        )}
        {groups.map((group, gi) => (
          <div key={gi} className={s.group}>
            <div className={s.groupHead}>
              <Avatar name={group.speaker} className={s.dot} />
              <span className={s.groupName}>{group.speaker}</span>
              {group.items[0].offsetSeconds !== null && (
                <span className={s.groupTime}>{fmtTime(group.items[0].offsetSeconds)}</span>
              )}
            </div>
            {/* One paragraph per speaker turn; each sentence jumps to its moment */}
            <p className={s.groupText}>
              {group.items.map((row) => {
                const isActive = row.id === activeId;
                const seekable = row.offsetSeconds !== null;
                const gap = /[　-〿一-鿿＀-￯]$/.test(row.content.trim()) ? '' : ' ';
                return (
                  <React.Fragment key={row.id}>
                    <span
                      ref={isActive ? (el) => { activeRef.current = el; } : undefined}
                      className={`${isActive ? s.sentOn : s.sent}${seekable ? ` ${s.sentLink}` : ''}`}
                      role={seekable ? 'button' : undefined}
                      tabIndex={seekable ? 0 : undefined}
                      onClick={seekable ? () => onSeek(row.offsetSeconds as number) : undefined}
                      onKeyDown={
                        seekable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSeek(row.offsetSeconds as number);
                              }
                            }
                          : undefined
                      }
                    >
                      {row.content}
                    </span>
                    {gap}
                  </React.Fragment>
                );
              })}
            </p>
          </div>
        ))}
      </div>
      <p className={s.panelFoot}>{t('replay.machineNote')}</p>
    </div>
  );
}

/** 参与者信息面板 */
function InfoPanel({
  meeting,
  recording,
}: {
  meeting: ReplayData['meeting'];
  recording: ReplayData['recording'];
}) {
  const { t } = useI18n();
  if (!meeting) return null;
  return (
    <div className={s.scroll}>
      <div className={s.infoRow}>
        <h3 className={s.infoLabel}>{t('replay.meetingTitle')}</h3>
        <p className={s.infoValue}>{meeting.title || meeting.roomName}</p>
      </div>
      {meeting.actualStartedAt && (
        <div className={s.infoRow}>
          <h3 className={s.infoLabel}>{t('replay.startTime')}</h3>
          <p className={s.infoValue}>{new Date(meeting.actualStartedAt).toLocaleString()}</p>
        </div>
      )}
      {meeting.actualDurationMinutes && (
        <div className={s.infoRow}>
          <h3 className={s.infoLabel}>{t('replay.meetingDuration')}</h3>
          <p className={s.infoValue}>{t('replay.minutes', { n: meeting.actualDurationMinutes })}</p>
        </div>
      )}
      {recording.durationSeconds && (
        <div className={s.infoRow}>
          <h3 className={s.infoLabel}>{t('replay.recordingDuration')}</h3>
          <p className={s.infoValue}>{fmtTime(recording.durationSeconds)}</p>
        </div>
      )}
      {meeting.createdBy && (
        <div className={s.infoRow}>
          <h3 className={s.infoLabel}>{t('replay.host')}</h3>
          <p className={s.infoValue}>{meeting.createdBy.fullName || meeting.createdBy.username}</p>
        </div>
      )}
      <div className={s.infoRow}>
        <h3 className={s.infoLabel}>
          {t('replay.participants')} ({meeting.participants.length})
        </h3>
        <div className={s.people}>
          {meeting.participants.map((p) => (
            <div key={p.id} className={s.personRow}>
              <Avatar name={p.displayName} className={s.personAvatar} />
              <div>
                <div className={s.personName}>{p.displayName}</div>
                {p.durationSeconds && (
                  <div className={s.personMeta}>{t('replay.online', { time: fmtTime(p.durationSeconds) })}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** AI 生成进度（模拟） */
function GenerateProgress({ pct }: { pct: number }) {
  const { t } = useI18n();
  return (
    <div className={s.progress}>
      <div className={s.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className={s.progressBar} style={{ width: `${Math.round(pct)}%` }} />
      </div>
      <p className={s.muted}>{t('replay.generating', { pct: Math.round(pct) })}</p>
    </div>
  );
}

/** While the summary is being written: progress, then the outline of what will appear */
function SummarySkeleton({ pct }: { pct: number }) {
  const { t } = useI18n();
  return (
    <div className={s.tabBody}>
      <div className={s.scroll}>
        <GenerateProgress pct={pct} />
        <div className={s.skeleton} aria-hidden="true">
          {[40, 100, 85, 30, 92, 70, 30, 88].map((w, i) => (
            <span key={i} className={i === 0 || i === 3 || i === 6 ? s.skelHead : s.skelLine} style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
      <p className={s.panelFoot}>{t('replay.aiNote')}</p>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────── */
export default function ReplayPage() {
  const params = useParams();
  const id = params?.id as string;
  const { t, locale, setLocale } = useI18n();
  useStoredTheme();

  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  // null = 还没手动选过：有纪要时先看纪要，否则看转写
  const [activeTab, setActiveTab] = useState<'summary' | 'transcript' | 'info' | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  // 最近一次点击的章节，用来展开并滚动到对应摘要
  const [chapterFocus, setChapterFocus] = useState<{ id: number; n: number } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [genProgress, setGenProgress] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [sessionOn, setSessionOn] = useState(false);
  const [panelVisible, setPanelVisible] = useState(true);
  const [videoFit, setVideoFit] = useState<'width' | 'height'>('width');
  const [helpOpen, setHelpOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [userInfo, setUserInfo] = useState<{ displayName: string; avatarUrl?: string } | null>(
    null,
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const avatarMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSessionOn(Boolean(getKloudSessionBearer()));
    try {
      const stored = localStorage.getItem('kloudUser');
      if (stored) {
        const u = JSON.parse(stored);
        if (u?.displayName || u?.username) {
          setUserInfo({ displayName: u.displayName || u.username, avatarUrl: u.avatarUrl });
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setLangMenuOpen(false);
      }
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(event.target as Node)) {
        setAvatarMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 加载聚合数据
  useEffect(() => {
    if (!id) return;
    let redirected = false;
    (async () => {
      try {
        // 从 localStorage 读取 token（和 Dashboard 一致）
        const res = await fetch(`/api/recordings/${encodeURIComponent(id)}/summary`, {
          headers: authHeaders(),
          cache: 'no-store',
        });
        if (res.status === 401) {
          redirected = true;
          try {
            localStorage.removeItem('kloudUser');
            sessionStorage.removeItem('kloudUser');
          } catch {
            /* ignore */
          }
          window.location.href = `/?next=${encodeURIComponent(recordingReplayPath(id))}`;
          return;
        }
        if (res.status === 403) {
          setError(t('replay.noAccess'));
          return;
        }
        if (!res.ok) {
          const d = await res.json();
          setError(d.error || '加载失败');
          return;
        }
        const d: ReplayData = await res.json();
        setData(d);
      } catch (e: any) {
        setError(e.message || '网络错误');
      } finally {
        if (!redirected) setLoading(false);
      }
    })();
  }, [id, t, reloadKey]);

  const handleTranscribeDone = useCallback(() => {
    setReloadKey((k) => k + 1);
    setActiveTab('transcript');
  }, []);

  const seekTo = useCallback((secs: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = secs;
      videoRef.current.play();
      setPlaying(true);
    }
  }, []);

  // 点击章节卡片：跳转视频 + 切换到摘要面板 + 展开并滚动到对应项
  const handleChapterSelect = useCallback(
    (ch: ChapterCard) => {
      seekTo(ch.startSec);
      setActiveTab('summary');
      setPanelVisible(true);
      setChapterFocus((prev) => ({ id: ch.id, n: (prev?.n ?? 0) + 1 }));
    },
    [seekTo],
  );

  // AI 生成会议摘要
  const generateSummary = useCallback(async () => {
    if (!data?.meeting?.id) return;
    setGenerating(true);
    setGenProgress(0);
    setGenerateError(null);
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('kloudUser') : null;
      const token = stored ? JSON.parse(stored).token || '' : '';
      const res = await fetch(`/api/meeting-summary/${data.meeting.id}/generate`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (!res.ok) {
        setGenerateError(json.error || '生成失败');
        return;
      }
      setGenProgress(100);
      // 将新生成的摘要写回 data state，触发页面更新
      setData((prev) =>
        prev && prev.meeting
          ? { ...prev, meeting: { ...prev.meeting, summaryItems: json.items, summary: json.summary ?? null } }
          : prev,
      );
      setChapterFocus(null);
    } catch (e: any) {
      setGenerateError(e.message || '网络错误');
    } finally {
      setGenerating(false);
    }
  }, [data]);

  // 模拟进度：generating 时从 0→90 缓慢增长，完成后跳到 100
  useEffect(() => {
    if (!generating) return;
    setGenProgress(0);
    // 每 600ms 推进一次，越接近 90 推进越慢（模拟 AI 延迟感）
    const timer = setInterval(() => {
      setGenProgress((prev) => {
        if (prev >= 90) return prev;
        const remaining = 90 - prev;
        const step = Math.max(0.5, remaining * 0.08);
        return Math.min(90, prev + step);
      });
    }, 600);
    return () => clearInterval(timer);
  }, [generating]);

  /* ── Loading ── */
  if (loading) {
    return (
      <div className={s.center}>
        <div className={s.spinner} />
        <p className={s.muted}>{t('replay.loading')}</p>
      </div>
    );
  }

  /* ── Error ── */
  if (error || !data?.recording.streamUrl) {
    return (
      <div className={s.center}>
        <div className={s.notice}>
          <span className={s.emptyIcon} aria-hidden="true">
            <ClockGlyph />
          </span>
          <h1 className={s.emptyTitle}>{t('replay.notReady')}</h1>
          <p className={s.muted}>{error || t('replay.processing')}</p>
          <Link href="/" className={s.primaryBtn}>
            {t('replay.back')}
          </Link>
        </div>
      </div>
    );
  }

  const { recording, meeting } = data;
  const summaryItems = meeting?.summaryItems || [];
  const transcripts = meeting?.transcripts || [];
  const participants = meeting?.participants || [];
  const meetingTitle = meeting?.title || meeting?.roomName || t('replay.loading');

  /** 有逐条字幕数据时才展示摘要/逐字稿/信息侧栏及章节卡片等「其余」区域 */
  const hasTranscripts = transcripts.some((tr) => (tr.content || '').trim().length > 0);
  const sttStatus = recording.transcribe?.status ?? null;
  const unfinished = isSttActive(sttStatus) || sttStatus === 'FAILED';
  const canAskTranscribe = recording.canTranscribe === true || recording.canManage || sessionOn;

  function secsToHMS(secs: number): string {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const sec = Math.floor(secs % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  const realChapters: ChapterCard[] = summaryItems.map((item, idx) => {
    const startSec = offsetToSecs(item.timeOffset);
    const nextItem = summaryItems[idx + 1];
    const endSec = nextItem
      ? offsetToSecs(nextItem.timeOffset)
      : (recording.durationSeconds ?? startSec + 300);
    const speaker = (item.speaker || '').trim() || dominantSpeaker(transcripts, startSec, endSec);
    return {
      id: item.id,
      startSec,
      endSec,
      timeRange: `${item.timeOffset}-${secsToHMS(endSec)}`,
      speaker,
      topic: item.title,
    };
  });

  // Tones in order of appearance: participants first, then anyone else heard in the transcript
  const avatarTones: Record<string, number> = {};
  for (const name of [...participants.map((p) => p.displayName), ...transcripts.map((row) => row.speakerName)]) {
    if (name && avatarTones[name] === undefined) avatarTones[name] = Object.keys(avatarTones).length % TONE_COUNT;
  }

  const realSpeakerSegments: SpeakerSegment[] = (() => {
    if (!transcripts.length) return [];
    const acc: Record<string, [number, number][]> = {};
    for (const row of transcripts) {
      if (row.offsetSeconds === null || row.offsetSeconds === undefined) continue;
      const start = row.offsetSeconds;
      const dur = Math.min(30, Math.max(1.5, row.content.length * 0.25));
      if (!acc[row.speakerName]) acc[row.speakerName] = [];
      acc[row.speakerName].push([start, start + dur]);
    }
    return Object.entries(acc).map(([name, segs]) => ({
      name,
      color: speakerColor(name, avatarTones),
      segments: segs,
    }));
  })();

  const realDuration =
    recording.durationSeconds ??
    (transcripts.length ? Math.max(...transcripts.map((row) => row.offsetSeconds ?? 0)) + 60 : 300);

  const tabs = [
    { key: 'transcript', label: t('replay.tabTranscript'), count: transcripts.length },
    { key: 'summary', label: t('replay.tabSummary'), count: summaryItems.length },
    { key: 'info', label: t('replay.tabInfo'), count: null },
  ] as const;
  const tab = activeTab ?? (summaryItems.length > 0 ? 'summary' : 'transcript');
  const canManage = recording.canManage === true;

  // Header line under the title: (shared by) · when · how long · meeting code · who
  const hostName = meeting?.createdBy ? meeting.createdBy.fullName || meeting.createdBy.username : '';
  const sharerName = recording.recordedBy
    ? recording.recordedBy.fullName || recording.recordedBy.username
    : hostName;
  const avatarPhotos: Record<string, string> = Object.fromEntries(
    participants
      .filter((p) => p.member?.avatarUrl)
      .map((p) => [p.displayName, p.member!.avatarUrl as string]),
  );
  const metaParts = [
    !canManage && sharerName ? t('replay.sharedBy', { name: sharerName }) : '',
    meeting?.actualStartedAt
      ? new Date(meeting.actualStartedAt).toLocaleString(locale, {
          ...(new Date(meeting.actualStartedAt).getFullYear() !== new Date().getFullYear()
            ? { year: 'numeric' as const }
            : {}),
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '',
    meeting?.actualDurationMinutes
      ? t('replay.minutes', { n: meeting.actualDurationMinutes })
      : recording.durationSeconds
        ? fmtTime(recording.durationSeconds)
        : '',
    // The code lets people join a personal room, so only the owner sees it
    canManage && meeting?.roomName ? t('replay.metaCode', { code: meeting.roomName.replace(/_\d+$/, '') }) : '',
  ].filter(Boolean);
  const openInfo = () => {
    setPanelVisible(true);
    setActiveTab('info');
  };
  const copyPageLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const showPanel = hasTranscripts && panelVisible;
  const videoClass = !hasTranscripts ? s.videoSolo : videoFit === 'height' ? s.videoTall : '';
  const livedoc = recording.livedoc ?? null;
  // SmartCam: whoever is speaking now (from the transcript)
  const speakingNow = realSpeakerSegments.find((sp) =>
    sp.segments.some(([a, b]) => currentTime >= a && currentTime < b),
  );
  const replaySpeaker = speakingNow
    ? { name: speakingNow.name, photo: avatarPhotos[speakingNow.name], color: speakingNow.color }
    : null;

  return (
    <AvatarContext.Provider value={{ photos: avatarPhotos, tones: avatarTones }}>
    <div className={s.page}>
      {/* ── Header ── */}
      <header className={s.header}>
        <Link href="/" className={s.backBtn} aria-label={t('replay.back')} title={t('replay.back')}>
          <Chevron dir="left" />
          <span className={s.backLabel}>{t('replay.back')}</span>
        </Link>
        <div className={s.titleBlock}>
          <h1 className={s.title} title={meetingTitle}>{meetingTitle}</h1>
          {(metaParts.length > 0 || participants.length > 0) && (
            <div className={s.meta}>
              {metaParts.map((part, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className={s.metaSep} aria-hidden="true" />}
                  <span>{part}</span>
                </React.Fragment>
              ))}
              {participants.length > 0 && (
                <>
                  {metaParts.length > 0 && <span className={s.metaSep} aria-hidden="true" />}
                  <button type="button" className={s.peopleBtn} onClick={openInfo} title={t('replay.participants')}>
                    <span className={s.stack} aria-hidden="true">
                      {participants.slice(0, 3).map((p) => (
                        <Avatar key={p.id} name={p.displayName} className={s.stackAvatar} />
                      ))}
                    </span>
                    {t('replay.metaPeople', { n: participants.length })}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div className={s.headerRight}>
          {/* Panel toggle */}
          {hasTranscripts && (
            <button
              type="button"
              className={s.iconBtn}
              onClick={() => setPanelVisible(!panelVisible)}
              aria-pressed={panelVisible}
              aria-label={panelVisible ? t('replay.hidePanel') : t('replay.showPanel')}
              title={panelVisible ? t('replay.hidePanel') : t('replay.showPanel')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                {panelVisible ? <line x1="15" y1="3" x2="15" y2="21" /> : <line x1="9" y1="3" x2="9" y2="21" />}
              </svg>
            </button>
          )}

          {/* Help */}
          <button
            type="button"
            className={s.iconBtn}
            onClick={() => setHelpOpen(true)}
            aria-label={t('nav.help')}
            title={t('nav.help')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.6 9.3a2.5 2.5 0 014.8 1c0 1.7-2.4 2.2-2.4 3.7" />
              <line x1="12" y1="17.2" x2="12.01" y2="17.2" />
            </svg>
          </button>

          {/* Language */}
          <div className={s.menuAnchor} ref={langMenuRef}>
            <button
              type="button"
              className={s.iconBtn}
              onClick={() => setLangMenuOpen(!langMenuOpen)}
              aria-haspopup="menu"
              aria-expanded={langMenuOpen}
              aria-label={t('nav.langSelector')}
              title={t('nav.langSelector')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <path d="M12 3a14 14 0 014 9 14 14 0 01-4 9 14 14 0 01-4-9 14 14 0 014-9z" />
              </svg>
              <span>{LOCALE_OPTIONS.find((l) => l.code === locale)?.shortCode || 'EN'}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {langMenuOpen && (
              <div className={s.menu} role="menu">
                {LOCALE_OPTIONS.map((opt) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={locale === opt.code}
                    key={opt.code}
                    className={locale === opt.code ? s.menuItemOn : s.menuItem}
                    onClick={() => {
                      setLocale(opt.code as Locale);
                      setLangMenuOpen(false);
                    }}
                  >
                    <span>{opt.label}</span>
                    <span className={s.menuHint}>{opt.shortCode}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Avatar menu */}
          <div className={s.menuAnchor} ref={avatarMenuRef}>
            <button
              type="button"
              className={s.avatarBtn}
              onClick={() => setAvatarMenuOpen(!avatarMenuOpen)}
              aria-haspopup="menu"
              aria-expanded={avatarMenuOpen}
              aria-label={t('nav.userMenu')}
              title={t('nav.userMenu')}
            >
              {userInfo?.avatarUrl ? (
                <img src={userInfo.avatarUrl} alt="" />
              ) : (
                <span>{userInfo?.displayName?.charAt(0).toUpperCase() || '?'}</span>
              )}
            </button>
            {avatarMenuOpen && (
              <div className={s.menu} role="menu">
                {userInfo && <div className={s.menuUser}>{userInfo.displayName}</div>}
                <button
                  type="button"
                  role="menuitem"
                  className={s.menuItem}
                  onClick={() => {
                    setAvatarMenuOpen(false);
                    window.location.href = '/';
                  }}
                >
                  {t('replay.back')}
                </button>
                <a
                  role="menuitem"
                  href={recording.streamUrl!}
                  download={recording.fileName}
                  className={s.menuItem}
                  onClick={() => setAvatarMenuOpen(false)}
                >
                  {t('replay.download')}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </a>
                <button
                  type="button"
                  role="menuitem"
                  className={s.menuItemDanger}
                  onClick={() => {
                    setAvatarMenuOpen(false);
                    try {
                      localStorage.removeItem('kloudUser');
                      sessionStorage.removeItem('kloudUser');
                    } catch {
                      /* ignore */
                    }
                    window.location.href = `/?next=${encodeURIComponent(recordingReplayPath(id))}`;
                  }}
                >
                  {t('nav.signOut')}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main: watch on the left, read on the right ── */}
      <main className={showPanel ? s.layout : `${s.layout} ${s.layoutWide}`}>
        <section className={s.stage}>
          <div className={hasTranscripts ? s.videoCard : `${s.videoCard} ${s.videoCardFill}`}>
            {livedoc && (
              <LiveDocReplayStage
                info={livedoc}
                mediaRef={videoRef}
                viewerName={userInfo?.displayName || ''}
                speaker={replaySpeaker}
                fill={!hasTranscripts}
                fillClass={s.livedocFill}
              />
            )}
            <video
              ref={videoRef}
              src={recording.streamUrl!}
              controls
              // LiveDoc Full: the file is the meeting's voice, so only its controls show.
              // flex 锁定高度，避免被上方画面挤出可视区域。
              style={livedoc ? { height: 56, minHeight: 56, maxHeight: 56, flex: '0 0 56px', aspectRatio: 'auto' } : undefined}
              className={`${s.video}${videoClass && !livedoc ? ` ${videoClass}` : ''}`}
              onTimeUpdate={(e) => {
                const el = e.currentTarget;
                // Recording was paused here: the file shows a "paused" slate, so skip past it
                const target = skipPaused(el.currentTime, recording.pausedRanges ?? []);
                if (target !== el.currentTime) el.currentTime = Math.min(target, el.duration || target);
                setCurrentTime(el.currentTime);
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            {/* Fit toggle (not for LiveDoc Full: its stage has a fixed shape) */}
            {!livedoc && (
            <button
              type="button"
              className={s.fitBtn}
              onClick={() => setVideoFit(videoFit === 'width' ? 'height' : 'width')}
              title={videoFit === 'width' ? t('replay.fitHeight') : t('replay.fitWidth')}
              aria-label={videoFit === 'width' ? t('replay.fitHeight') : t('replay.fitWidth')}
            >
              {videoFit === 'width' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="3 8 3 3 8 3" />
                  <polyline points="21 16 21 21 16 21" />
                  <line x1="3" y1="3" x2="10" y2="10" />
                  <line x1="21" y1="21" x2="14" y2="14" />
                </svg>
              )}
            </button>
            )}
          </div>

          {hasTranscripts && (
            <StageViews
              chapters={realChapters}
              speakers={realSpeakerSegments}
              duration={realDuration}
              currentTime={currentTime}
              onSelectChapter={handleChapterSelect}
              onSeek={seekTo}
            />
          )}
        </section>

        {showPanel && (
          <aside className={s.panel} aria-label={t('replay.tabsLabel')}>
            <div className={s.tabs} role="tablist" aria-label={t('replay.tabsLabel')}>
              {tabs.map((tabItem) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === tabItem.key}
                  key={tabItem.key}
                  className={tab === tabItem.key ? s.tabOn : s.tab}
                  onClick={() => setActiveTab(tabItem.key)}
                >
                  {tabItem.label}
                  {tabItem.count !== null && tabItem.count > 0 && <span className={s.tabCount}>{tabItem.count}</span>}
                </button>
              ))}
              {tab === 'summary' && summaryItems.length > 0 && canManage && !generating && (
                <button
                  type="button"
                  className={`${s.textBtn} ${s.tabsAction}`}
                  onClick={generateSummary}
                  title={t('replay.regenerateSummaryHint')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  {t('replay.regenerateShort')}
                </button>
              )}
            </div>

            <div className={s.tabBody} role="tabpanel">
              {tab === 'summary' &&
                (summaryItems.length > 0 ? (
                  generating ? (
                    <SummarySkeleton pct={genProgress} />
                  ) : (
                  <>
                    {generateError && (
                      <p className={s.error} style={{ padding: '8px 14px 0' }}>{generateError}</p>
                    )}
                    <SummaryPanel
                      items={summaryItems}
                      currentTime={currentTime}
                      onSeek={seekTo}
                      meetingId={meeting?.id ?? 0}
                      kloudMeetingId={meeting?.kloudMeetingId ?? null}
                      focus={chapterFocus}
                      canManage={canManage}
                      head={meeting?.summary ?? null}
                    />
                  </>
                  )
                ) : generating ? (
                  <SummarySkeleton pct={genProgress} />
                ) : transcripts.length > 0 && canManage ? (
                  <div className={s.empty}>
                    <span className={s.emptyIcon} aria-hidden="true">
                      <SparkGlyph size={20} />
                    </span>
                    <p className={s.emptyTitle}>{t('replay.noSummaryYet')}</p>
                    <p className={s.muted}>{t('replay.noSummaryHint', { count: transcripts.length })}</p>
                    {generateError && <p className={s.error}>{generateError}</p>}
                    <button type="button" className={s.primaryBtn} onClick={generateSummary}>
                      {t('replay.generateSummary')}
                    </button>
                  </div>
                ) : transcripts.length > 0 ? (
                  /* Someone opening a shared link: they can't generate, so point them to the owner */
                  <div className={s.notifyCard}>
                    <SparkGlyph size={16} />
                    <div>
                      <p className={s.notifyTitle}>{t('replay.visitorNoSummary')}</p>
                      <p className={s.muted}>{t('replay.visitorNoSummaryHint', { name: sharerName || hostName })}</p>
                      <button type="button" className={s.linkBtn} onClick={copyPageLink}>
                        {linkCopied ? t('replay.linkCopied') : t('replay.copyLink')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={s.empty}>
                    <span className={s.emptyIcon} aria-hidden="true">
                      <DocGlyph />
                    </span>
                    <p className={s.emptyTitle}>{t('replay.noTranscriptForSummary')}</p>
                    <p className={s.muted}>{t('replay.noTranscriptForSummaryHint')}</p>
                  </div>
                ))}
              {tab === 'transcript' && (
                <TranscriptPanel transcripts={transcripts} currentTime={currentTime} onSeek={seekTo} />
              )}
              {tab === 'info' && <InfoPanel meeting={meeting} recording={recording} />}
            </div>
          </aside>
        )}
      </main>

      {canAskTranscribe && meeting && (!hasTranscripts || unfinished) && (
        <RecordingTranscribePrompt
          recordingKey={id}
          initial={recording.transcribe ?? IDLE_TRANSCRIBE}
          onDone={handleTranscribeDone}
          // LiveDoc Full replays play without a transcript: offer it, don't block the stage
          startCollapsed={!!livedoc}
        />
      )}

      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
    </AvatarContext.Provider>
  );
}

/* ─── Glyphs ─────────────────────────────────────────────── */
function ListGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

function PersonGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </svg>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  );
}

function SparkGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" />
    </svg>
  );
}

function DocGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function CloseGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
