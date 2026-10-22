'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { authFetch, authHeaders, getKloudSessionBearer } from '@/lib/kloudSession';
import { recordingReplayPath } from '@/lib/recordingReplayPath';
import { RecordingTranscribePrompt } from '@/lib/RecordingTranscribePrompt';
import { IDLE_TRANSCRIBE, isSttActive, type TranscribeState } from '@/lib/recordingTranscribeState';
import css from '@/styles/Replay.module.css';

/* ─── Types ──────────────────────────────────────────────── */
interface Participant {
  id: number;
  displayName: string;
  joinedAt: string;
  leftAt: string | null;
  durationSeconds: number | null;
  member: { id: number; fullName: string | null; username: string; avatarUrl: string | null } | null;
}

interface SummaryItem {
  id: number;
  title: string;
  content: string;
  timeOffset: string; // HH:mm:ss
  /** AI 生成时写入；旧数据可能为空 */
  speaker?: string | null;
  sortOrder: number;
}

interface Transcript {
  id: number;
  speakerName: string;
  content: string;
  captionTime: string;
  offsetSeconds: number | null;
}

type RecordingVisibility = 'PRIVATE' | 'PUBLIC';

interface ReplayData {
  recording: {
    id: number;
    /** 回放链接 key（服务端 ensureShareKey 后返回） */
    shareKey?: string | null;
    /** PRIVATE | PUBLIC；旧版服务端可能不返回 */
    visibility?: string | null;
    fileName: string;
    durationSeconds: number | null;
    streamUrl: string | null;
    status: string;
    createdAt: string;
    recordedBy: { fullName: string | null; username: string } | null;
    canManage: boolean;
    /** 已登录且能观看时为 true，用于弹出解析字幕 */
    canTranscribe?: boolean;
    /** 旧版服务端不返回该字段 */
    transcribe?: TranscribeState;
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
    transcripts: Transcript[];
  } | null;
}

type TFn = (key: string, params?: Record<string, string | number>) => string;

/* ─── Helpers ────────────────────────────────────────────── */
function fmtTime(secs: number | null | undefined): string {
  if (secs === null || secs === undefined || secs < 0) return '--:--';
  if (secs === 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
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
function dominantSpeaker(
  transcripts: Transcript[],
  startSec: number,
  endSec: number,
): string {
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

/** Pastel speaker colours; avatar initials use dark text (contrast ≥ 5:1 on every colour). */
const COLORS = [
  '#8B87FF', '#FFB877', '#5FC2F0', '#5FD3A6',
  '#F28FB8', '#C3A6FF', '#F2C94C', '#7FB7FF',
];
function speakerColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}

/** Locale strings still carry a leading emoji (e.g. "📋 Summary"); the redesign shows plain labels. */
const LEADING_SYMBOLS = /^(?:\p{Extended_Pictographic}|️|‍|\s)+/u;
function plainLabel(text: string): string {
  const stripped = text.replace(LEADING_SYMBOLS, '');
  return stripped || text;
}

/** t() returns the key itself when a string is missing; fall back to English for keys added in the redesign. */
function tr(t: TFn, key: string, fallback: string, params?: Record<string, string | number>): string {
  const value = t(key, params);
  if (value !== key) return value;
  let text = fallback;
  if (params) {
    for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}

function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      className={css.avatar}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: speakerColor(name),
      }}
    >
      {getInitials(name)}
    </span>
  );
}

function ChevronDown({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ProgressBlock({ pct, text }: { pct: number; text: string }) {
  return (
    <div className={css.progress}>
      <div className={css.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={css.progressBar} style={{ width: `${pct}%` }} />
      </div>
      <p className={css.progressText} aria-live="polite">{text}</p>
    </div>
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

/* ─── ChapterCardsCarousel ────────────────────────────────── */
function ChapterCardsCarousel({
  chapters,
  currentTime,
  selectedId,
  onSelect,
}: {
  chapters: ChapterCard[];
  currentTime: number;
  selectedId: number | null;
  onSelect: (ch: ChapterCard) => void;
}) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLUListElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

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

  // 自动高亮：基于播放时间
  const autoIdx = chapters.reduce((acc, c, i) =>
    currentTime >= c.startSec && currentTime < c.endSec ? i : acc, -1);

  return (
    <div className={css.chapters}>
      {canLeft && (
        <button
          type="button"
          className={cx(css.scrollArrow, css.scrollArrowLeft)}
          aria-label={tr(t, 'replay.scrollChaptersLeft', 'Scroll chapters left')}
          onClick={() => scroll('l')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
      )}
      <ul ref={scrollRef} className={css.chapterTrack} aria-label={tr(t, 'replay.chapters', 'Chapters')}>
        {chapters.map((ch, idx) => {
          const isSelected = ch.id === selectedId;
          const isAuto = idx === autoIdx && selectedId === null;
          const isActive = isSelected || isAuto;
          return (
            <li key={ch.id} style={{ display: 'flex' }}>
              <button
                type="button"
                className={cx(css.chapterCard, isActive && css.chapterCardOn)}
                aria-current={isActive ? 'true' : undefined}
                title={`${ch.timeRange} · ${ch.topic}`}
                onClick={() => onSelect(ch)}
              >
                <span className={css.chapterCardHead}>
                  <Avatar name={ch.speaker} size={22} />
                  <span className={css.chapterSpeaker}>{ch.speaker}</span>
                </span>
                <span className={css.chapterTitle}>{ch.topic}</span>
                <span className={css.chapterTime}>
                  {fmtTime(ch.startSec)}–{fmtTime(ch.endSec)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {canRight && (
        <button
          type="button"
          className={cx(css.scrollArrow, css.scrollArrowRight)}
          aria-label={tr(t, 'replay.scrollChaptersRight', 'Scroll chapters right')}
          onClick={() => scroll('r')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      )}
    </div>
  );
}

/* ─── SpeakerSegmentTimeline ──────────────────────────────── */
function SpeakerSegmentTimeline({
  speakers,
  duration,
  currentTime,
  onSeek,
}: {
  speakers: SpeakerSegment[];
  duration: number;
  currentTime: number;
  onSeek: (s: number) => void;
}) {
  const { t } = useI18n();
  if (!speakers.length || !duration) return null;
  const pct = (s: number) => `${((s / duration) * 100).toFixed(2)}%`;

  // 发言占比：按各发言人片段时长之和计算（仅展示）
  const talk = speakers.map((sp) => sp.segments.reduce((sum, [s, e]) => sum + Math.max(0, e - s), 0));
  const talkAll = talk.reduce((a, b) => a + b, 0);
  const playhead = Math.max(0, Math.min(100, (currentTime / duration) * 100));

  return (
    <section className={cx(css.card, css.speakers)} aria-labelledby="replay-speakers-head">
      <h2 id="replay-speakers-head" className={css.sectionHead}>
        {tr(t, 'replay.speakers', 'Speakers')}
      </h2>
      {speakers.map((sp, si) => {
        const share = talkAll > 0 ? Math.round((talk[si] / talkAll) * 100) : 0;
        return (
          <div key={sp.name} className={css.lane}>
            <Avatar name={sp.name} size={24} />
            <span className={css.laneName} title={sp.name}>{sp.name}</span>
            <span
              className={css.laneShare}
              title={tr(t, 'replay.talkShare', '{name}: {pct}% of talk time', { name: sp.name, pct: share })}
            >
              {share}%
            </span>
            <div
              className={css.laneBar}
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                onSeek(((e.clientX - rect.left) / rect.width) * duration);
              }}
            >
              {sp.segments.map(([s, e], i) => (
                <div
                  key={i}
                  className={css.laneSeg}
                  title={`${sp.name} ${fmtTime(s)} – ${fmtTime(e)}`}
                  style={{ left: pct(s), width: pct(e - s), background: sp.color }}
                  onClick={(ev) => { ev.stopPropagation(); onSeek(s); }}
                />
              ))}
              <span className={css.playhead} style={{ left: `${playhead}%` }} aria-hidden="true" />
            </div>
          </div>
        );
      })}
    </section>
  );
}

/* ─── Sub-components ─────────────────────────────────────── */

/** 章节摘要面板 */
function SummaryPanel({
  items,
  currentTime,
  duration: _duration,
  onSeek,
  meetingId,
  kloudMeetingId,
  forceExpandId,
}: {
  items: SummaryItem[];
  currentTime: number;
  duration: number;
  onSeek: (secs: number) => void;
  meetingId: number;
  kloudMeetingId: number | null;
  forceExpandId?: number | null;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [localItems, setLocalItems] = useState<SummaryItem[]>(items);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => setLocalItems(items), [items]);

  // 外部点击章节卡片时强制展开对应摘要
  useEffect(() => {
    if (forceExpandId !== undefined && forceExpandId !== null) {
      setExpanded(forceExpandId);
    }
  }, [forceExpandId]);

  // 高亮当前所在章节
  const activeIdx = localItems.reduce((acc, item, idx) => {
    const s = offsetToSecs(item.timeOffset);
    return s <= currentTime ? idx : acc;
  }, -1);

  if (!localItems.length) {
    if (!meetingId) {
      return (
        <div className={css.empty}>
          <EmptyIcon kind="summary" />
          <p className={css.emptyText}>{t('replay.noSummaryData')}</p>
        </div>
      );
    }
    return (
      <div className={css.empty}>
        <EmptyIcon kind="summary" />
        <p className={css.emptyTitle}>{t('replay.noSummary')}</p>
        <p className={css.emptyText}>
          {kloudMeetingId ? t('replay.summaryHint') : t('replay.summaryNoSource')}
        </p>
        {kloudMeetingId ? (
          <div className={css.emptyActions}>
            <button
              type="button"
              className={cx(css.btn, css.btnFill)}
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  const stored = typeof window !== 'undefined' ? localStorage.getItem('kloudUser') : null;
                  const token = stored ? (JSON.parse(stored).token || '') : '';
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
              {loading ? t('replay.fetchingSummary') : plainLabel(t('replay.fetchSummary'))}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={css.summaryList}>
      {localItems.map((item, idx) => {
        const isActive = idx === activeIdx;
        const isOpen = expanded === item.id;
        const bodyId = `replay-summary-body-${item.id}`;
        return (
          <div key={item.id} className={cx(css.summaryItem, isActive && css.summaryItemOn)}>
            <button
              type="button"
              className={css.summaryHead}
              aria-expanded={isOpen}
              aria-controls={bodyId}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => {
                onSeek(offsetToSecs(item.timeOffset));
                setExpanded(isOpen ? null : item.id);
              }}
            >
              <span className={css.timeChip}>{item.timeOffset}</span>
              <span className={css.summaryTitle}>{item.title}</span>
              <ChevronDown className={cx(css.chevron, isOpen && css.chevronOpen)} />
            </button>
            {isOpen && (
              <p id={bodyId} className={css.summaryBody}>{item.content}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EmptyIcon({ kind }: { kind: 'summary' | 'ai' | 'captions' }) {
  return (
    <span className={css.emptyIcon} aria-hidden="true">
      {kind === 'ai' ? (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
      ) : kind === 'captions' ? (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 15h4M13 15h4M7 11h10" /></svg>
      ) : (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>
      )}
    </span>
  );
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
  const [speakerFilter, setSpeakerFilter] = useState<string | null>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 发言人筛选（仅展示层，基于已有字幕）
  const speakerNames: string[] = [];
  for (const row of transcripts) {
    if (!speakerNames.includes(row.speakerName)) speakerNames.push(row.speakerName);
  }
  const activeSpeaker = speakerFilter !== null && speakerNames.includes(speakerFilter) ? speakerFilter : null;

  const filtered = transcripts.filter((row) =>
    (activeSpeaker === null || row.speakerName === activeSpeaker) &&
    (!search || row.content.toLowerCase().includes(search.toLowerCase())),
  );

  // 当前正在播放的字幕
  const activeId = transcripts.reduce((acc, t) => {
    if (t.offsetSeconds !== null && t.offsetSeconds <= currentTime) return t.id;
    return acc;
  }, -1);

  // 自动滚动（只滚动字幕列表本身，等同 block: 'nearest'，不带动整页滚动）
  useEffect(() => {
    const box = listRef.current;
    const el = activeRef.current;
    if (!box || !el) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < b.top) box.scrollBy({ top: r.top - b.top - 8, behavior: 'smooth' });
    else if (r.bottom > b.bottom) box.scrollBy({ top: r.bottom - b.bottom + 8, behavior: 'smooth' });
  }, [activeId]);

  // 按说话人分组（连续同一人合并）
  type Group = { speaker: string; items: Transcript[] };
  const groups: Group[] = [];
  for (const t of filtered) {
    if (!groups.length || groups[groups.length - 1].speaker !== t.speakerName) {
      groups.push({ speaker: t.speakerName, items: [t] });
    } else {
      groups[groups.length - 1].items.push(t);
    }
  }

  const filtering = Boolean(search) || activeSpeaker !== null;

  return (
    <>
      <div className={css.transcriptTools}>
        <label className={css.search}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <span className={css.srOnly}>{t('replay.searchPlaceholder')}</span>
          <input
            className={css.searchInput}
            type="search"
            placeholder={t('replay.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className={css.clearBtn}
              aria-label={tr(t, 'replay.clearSearch', 'Clear search')}
              onClick={() => setSearch('')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          )}
        </label>
        {speakerNames.length > 1 && (
          <div className={css.chips} role="group" aria-label={tr(t, 'replay.filterBySpeaker', 'Filter by speaker')}>
            <button
              type="button"
              className={cx(css.chip, activeSpeaker === null && css.chipOn)}
              aria-pressed={activeSpeaker === null}
              onClick={() => setSpeakerFilter(null)}
            >
              {tr(t, 'replay.allSpeakers', 'All speakers')}
            </button>
            {speakerNames.map((name) => (
              <button
                key={name}
                type="button"
                className={cx(css.chip, activeSpeaker === name && css.chipOn)}
                aria-pressed={activeSpeaker === name}
                title={name}
                onClick={() => setSpeakerFilter(activeSpeaker === name ? null : name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 字幕列表 */}
      <div className={css.transcriptScroll} ref={listRef}>
        {!filtered.length && (
          <div className={css.empty}>
            <p className={css.emptyText}>
              {filtering ? t('replay.noMatch') : t('replay.noTranscript')}
            </p>
          </div>
        )}
        {groups.map((group, gi) => (
          <div key={gi} className={css.group}>
            <Avatar name={group.speaker} size={28} />
            <div className={css.groupBody}>
              <div className={css.groupHead}>
                <strong>{group.speaker}</strong>
                {group.items[0].offsetSeconds !== null && (
                  <> · {fmtTime(group.items[0].offsetSeconds)}</>
                )}
              </div>
              {group.items.map((t) => {
                const isActive = t.id === activeId;
                const seekable = t.offsetSeconds !== null;
                return (
                  <button
                    key={t.id}
                    type="button"
                    ref={isActive ? activeRef : null}
                    className={cx(css.line, seekable && css.lineSeekable, isActive && css.lineOn)}
                    aria-current={isActive ? 'true' : undefined}
                    title={seekable ? fmtTime(t.offsetSeconds) : undefined}
                    disabled={!seekable}
                    onClick={() => t.offsetSeconds !== null && onSeek(t.offsetSeconds)}
                  >
                    {t.content}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
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
    <div className={css.scroll}>
      <dl className={css.infoList}>
        <dt>{t('replay.meetingTitle')}</dt>
        <dd>{meeting.title || meeting.roomName}</dd>
        {meeting.actualStartedAt && (
          <>
            <dt>{t('replay.startTime')}</dt>
            <dd>{new Date(meeting.actualStartedAt).toLocaleString()}</dd>
          </>
        )}
        {Boolean(meeting.actualDurationMinutes) && (
          <>
            <dt>{t('replay.meetingDuration')}</dt>
            <dd>{t('replay.minutes', { n: meeting.actualDurationMinutes ?? 0 })}</dd>
          </>
        )}
        {Boolean(recording.durationSeconds) && (
          <>
            <dt>{t('replay.recordingDuration')}</dt>
            <dd>{fmtTime(recording.durationSeconds)}</dd>
          </>
        )}
        {meeting.createdBy && (
          <>
            <dt>{t('replay.host')}</dt>
            <dd>{meeting.createdBy.fullName || meeting.createdBy.username}</dd>
          </>
        )}
      </dl>
      <h3 className={css.infoHead}>
        {t('replay.participants')} ({meeting.participants.length})
      </h3>
      <ul className={css.people}>
        {meeting.participants.map((p) => (
          <li key={p.id} className={css.person}>
            <Avatar name={p.displayName} size={30} />
            <span className={css.personName}>{p.displayName}</span>
            {Boolean(p.durationSeconds) && (
              <span className={css.personOnline}>{t('replay.online', { time: fmtTime(p.durationSeconds) })}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 录制访问权限（私密 / 公开 + 复制链接）—— 仅对可管理该录制的用户展示 */
function RecordingAccessMenu({
  shareKey,
  visibility,
  onChanged,
  notify,
}: {
  shareKey: string;
  visibility: RecordingVisibility;
  onChanged: (next: RecordingVisibility) => void;
  notify: (text: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = async (next: RecordingVisibility) => {
    if (next === visibility) {
      setOpen(false);
      return;
    }
    if (next === 'PUBLIC' && !window.confirm(t('dash.recordingMakePublicConfirm'))) return;
    setOpen(false);
    setSaving(true);
    try {
      const res = await authFetch(`/api/recordings/${encodeURIComponent(shareKey)}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ visibility: next }),
      });
      if (!res.ok) {
        notify(t('dash.recordingVisibilityFailed'));
        return;
      }
      const json = await res.json().catch(() => null);
      const saved: RecordingVisibility = json?.visibility === 'PUBLIC' || json?.visibility === 'PRIVATE' ? json.visibility : next;
      onChanged(saved);
      notify(saved === 'PUBLIC' ? t('dash.recordingNowPublic') : t('dash.recordingNowPrivate'));
    } catch {
      notify(t('dash.recordingVisibilityFailed'));
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    setOpen(false);
    const url = `${window.location.origin}${recordingReplayPath(shareKey)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const area = document.createElement('textarea');
      area.value = url;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(area);
    }
    notify(t('dash.recordingLinkCopied'));
  };

  const options: Array<{ id: RecordingVisibility; label: string; hint: string }> = [
    { id: 'PRIVATE', label: t('dash.recordingPrivate'), hint: t('dash.recordingPrivateHint') },
    { id: 'PUBLIC', label: t('dash.recordingPublic'), hint: t('dash.recordingPublicHint') },
  ];
  const isPublic = visibility === 'PUBLIC';

  return (
    <div className={css.accessWrap} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={cx(css.btn, css.btnOutline)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('dash.recordingShare')}: ${isPublic ? t('dash.recordingPublic') : t('dash.recordingPrivate')}`}
        disabled={saving}
        onClick={() => setOpen((v) => !v)}
      >
        {isPublic ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
        )}
        {isPublic ? t('dash.recordingPublic') : t('dash.recordingPrivate')}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className={css.menu} role="menu" aria-label={t('dash.recordingShare')}>
          <div className={css.menuLabel} aria-hidden="true">{t('dash.recordingShare')}</div>
          {options.map((opt) => {
            const on = visibility === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                className={cx(css.menuItem, on && css.menuItemOn)}
                onClick={() => void pick(opt.id)}
              >
                <span className={css.menuCheck} aria-hidden="true">
                  {on && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
                  )}
                </span>
                <span className={css.menuText}>
                  <span className={css.menuTitle}>{opt.label}</span>
                  <span className={css.menuHint}>{opt.hint}</span>
                </span>
              </button>
            );
          })}
          <div className={css.menuDivider} role="separator" />
          <button type="button" role="menuitem" className={css.menuItem} onClick={() => void copyLink()}>
            <span className={css.menuCheck} aria-hidden="true" style={{ color: 'var(--km-text-muted)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></svg>
            </span>
            <span className={css.menuText}>
              <span className={css.menuTitle} style={{ fontWeight: 500 }}>{t('dash.recordingCopyLink')}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────── */
export default function ReplayPage() {
  const params = useParams();
  const id = params?.id as string;
  const { t } = useI18n();

  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [, setPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'transcript' | 'info'>('summary');
  // 为 null 表示未手动选中，高亮跟随播放时间自动
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [genProgress, setGenProgress] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [sessionOn, setSessionOn] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const snackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setSessionOn(Boolean(getKloudSessionBearer()));
  }, []);

  // 独立打开的回放页：沿用首页保存的主题（未被其它页面设置时）
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

  useEffect(() => () => {
    if (snackTimer.current) clearTimeout(snackTimer.current);
  }, []);

  const notify = useCallback((text: string) => {
    setSnack(text);
    if (snackTimer.current) clearTimeout(snackTimer.current);
    snackTimer.current = setTimeout(() => setSnack(null), 2800);
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

  // 点击章节卡片：跳转视频 + 切换右侧摘要面板 + 展开对应项
  const handleChapterSelect = useCallback((ch: ChapterCard) => {
    seekTo(ch.startSec);
    setActiveTab('summary');
    setSelectedChapterId(ch.id);
  }, [seekTo]);

  const handleVisibilityChanged = useCallback((next: RecordingVisibility) => {
    setData((prev) => (prev ? { ...prev, recording: { ...prev.recording, visibility: next } } : prev));
  }, []);

  // AI 生成会议摘要
  const generateSummary = useCallback(async () => {
    if (!data?.meeting?.id) return;
    setGenerating(true);
    setGenProgress(0);
    setGenerateError(null);
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('kloudUser') : null;
      const token = stored ? (JSON.parse(stored).token || '') : '';
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
          ? { ...prev, meeting: { ...prev.meeting, summaryItems: json.items } }
          : prev
      );
      setSelectedChapterId(null);
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
    const id = setInterval(() => {
      setGenProgress((prev) => {
        if (prev >= 90) return prev;
        const remaining = 90 - prev;
        const step = Math.max(0.5, remaining * 0.08);
        return Math.min(90, prev + step);
      });
    }, 600);
    return () => clearInterval(id);
  }, [generating]);

  /* ── Loading ── */
  if (loading) {
    return (
      <div className={css.centerPage} role="status">
        <div className={css.spinner} aria-hidden="true" />
        <p className={css.loadingText}>{t('replay.loading')}</p>
      </div>
    );
  }

  /* ── Error ── */
  if (error || !data?.recording.streamUrl) {
    return (
      <div className={css.centerPage}>
        <div className={css.stateCard}>
          <span className={css.stateIcon} aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5h.01" /></svg>
          </span>
          <h1 className={css.stateTitle}>{t('replay.notReady')}</h1>
          <p className={css.stateText}>{error || t('replay.processing')}</p>
          <Link href="/" className={cx(css.btn, css.btnFill)}>{t('replay.back')}</Link>
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
  const shareKey = recording.shareKey || null;
  const visibility: RecordingVisibility = recording.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE';

  function secsToHMS(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  const realChapters: ChapterCard[] = summaryItems.map((item, idx) => {
    const startSec = offsetToSecs(item.timeOffset);
    const nextItem = summaryItems[idx + 1];
    const endSec = nextItem ? offsetToSecs(nextItem.timeOffset) : (recording.durationSeconds ?? startSec + 300);
    const speaker =
      (item.speaker || '').trim() || dominantSpeaker(transcripts, startSec, endSec);
    return {
      id: item.id, startSec, endSec,
      timeRange: `${item.timeOffset}-${secsToHMS(endSec)}`,
      speaker,
      topic: item.title,
    };
  });

  const realSpeakerSegments: SpeakerSegment[] = (() => {
    if (!transcripts.length) return [];
    const acc: Record<string, [number, number][]> = {};
    for (const t of transcripts) {
      if (t.offsetSeconds === null || t.offsetSeconds === undefined) continue;
      const start = t.offsetSeconds;
      const dur = Math.min(30, Math.max(1.5, t.content.length * 0.25));
      if (!acc[t.speakerName]) acc[t.speakerName] = [];
      acc[t.speakerName].push([start, start + dur]);
    }
    return Object.entries(acc).map(([name, segs]) => ({
      name, color: speakerColor(name), segments: segs,
    }));
  })();

  const realDuration = recording.durationSeconds ??
    (transcripts.length ? Math.max(...transcripts.map(t => (t.offsetSeconds ?? 0))) + 60 : 300);

  const displaySummaryItems = summaryItems;

  const tabs = [
    { key: 'summary', label: plainLabel(t('replay.tabSummary')), count: displaySummaryItems.length },
    { key: 'transcript', label: plainLabel(t('replay.tabTranscript')), count: transcripts.length },
    { key: 'info', label: plainLabel(t('replay.tabInfo')), count: null },
  ] as const;

  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setActiveTab(tabs[next].key);
    document.getElementById(`replay-tab-${tabs[next].key}`)?.focus();
  };

  const hostName = meeting?.createdBy ? (meeting.createdBy.fullName || meeting.createdBy.username) : null;
  const genPct = Math.round(genProgress);

  return (
    <div className={css.page}>
      {/* ── Header ── */}
      <header className={css.header}>
        <Link href="/" className={css.iconBtn} aria-label={t('replay.back')} title={t('replay.back')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div className={css.headerMain}>
          <h1 className={css.title} title={meetingTitle}>{meetingTitle}</h1>
          <div className={css.meta}>
            {meeting?.actualStartedAt && (
              <span>
                {new Date(meeting.actualStartedAt).toLocaleDateString('zh-CN', {
                  year: 'numeric', month: '2-digit', day: '2-digit',
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            )}
            {Boolean(recording.durationSeconds) && <span>{fmtTime(recording.durationSeconds)}</span>}
            {hostName && <span>{t('replay.host')} {hostName}</span>}
            {participants.length > 0 && <span>{t('replay.participants')} {participants.length}</span>}
          </div>
        </div>
        <div className={css.headerActions}>
          {recording.canManage && shareKey && (
            <RecordingAccessMenu
              shareKey={shareKey}
              visibility={visibility}
              onChanged={handleVisibilityChanged}
              notify={notify}
            />
          )}
          <a
            href={recording.streamUrl!}
            download={recording.fileName}
            className={cx(css.btn, css.btnFill)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
            {plainLabel(t('replay.download'))}
          </a>
        </div>
      </header>

      {/* ── Main Layout ── */}
      <main className={css.main}>
        {/* Left: Video →（有字幕时）Speaker Timeline → Chapter Cards */}
        <section className={cx(css.left, !hasTranscripts && css.leftSolo)}>
          {/* ① 视频播放器（最顶部） */}
          <div className={css.videoWrap}>
            <video
              ref={videoRef}
              src={recording.streamUrl!}
              controls
              playsInline
              className={cx(css.video, !hasTranscripts && css.videoSolo)}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onDurationChange={(e) => setDuration(e.currentTarget.duration)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          </div>

          {hasTranscripts && realSpeakerSegments.length > 0 && (
            <SpeakerSegmentTimeline
              speakers={realSpeakerSegments}
              duration={realDuration}
              currentTime={currentTime}
              onSeek={seekTo}
            />
          )}

          {hasTranscripts && realChapters.length > 0 && (
            <ChapterCardsCarousel
              chapters={realChapters}
              currentTime={currentTime}
              selectedId={selectedChapterId}
              onSelect={handleChapterSelect}
            />
          )}
        </section>

        {/* Right: Tab Panel（仅在有字幕时展示） */}
        {hasTranscripts && (
          <aside className={css.aside}>
            {/* Tabs */}
            <div className={css.tabList} role="tablist" aria-label={tr(t, 'replay.tabsLabel', 'Replay content')}>
              {tabs.map((tab, idx) => {
                const selected = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    id={`replay-tab-${tab.key}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`replay-panel-${tab.key}`}
                    tabIndex={selected ? 0 : -1}
                    className={cx(css.tab, selected && css.tabOn)}
                    onClick={() => setActiveTab(tab.key)}
                    onKeyDown={(e) => onTabKeyDown(e, idx)}
                  >
                    {tab.label}
                    {tab.count !== null && tab.count > 0 && (
                      <span className={css.tabCount}>{tab.count}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Tab Content */}
            <div
              className={css.tabPanel}
              role="tabpanel"
              id={`replay-panel-${activeTab}`}
              aria-labelledby={`replay-tab-${activeTab}`}
            >
              {activeTab === 'summary' && (
                summaryItems.length > 0 ? (
                  <>
                    {/* ── Summary content ── */}
                    <div className={css.scroll}>
                      <SummaryPanel
                        items={displaySummaryItems}
                        currentTime={currentTime}
                        duration={duration}
                        onSeek={seekTo}
                        meetingId={meeting?.id ?? 0}
                        kloudMeetingId={meeting?.kloudMeetingId ?? null}
                        forceExpandId={selectedChapterId}
                      />
                    </div>
                    {/* ── Re-generate footer ── */}
                    <div className={css.panelFooter}>
                      {generating ? (
                        <ProgressBlock pct={genPct} text={t('replay.generating', { pct: genPct })} />
                      ) : (
                        <>
                          <span className={css.panelFooterText}>
                            {generateError ? (
                              <span className={css.errorText} role="alert">{generateError}</span>
                            ) : (
                              t('replay.regenerateSummaryHint')
                            )}
                          </span>
                          <button
                            type="button"
                            className={cx(css.btn, css.btnTonal, css.btnSmall)}
                            onClick={generateSummary}
                            title={t('replay.regenerateSummary')}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                            </svg>
                            {t('replay.regenerateSummary')}
                          </button>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <div className={css.empty}>
                    {generating ? (
                      <div style={{ width: '100%', maxWidth: 320 }}>
                        <ProgressBlock pct={genPct} text={t('replay.generating', { pct: genPct })} />
                      </div>
                    ) : transcripts.length > 0 ? (
                      <>
                        <EmptyIcon kind="ai" />
                        <p className={css.emptyTitle}>{t('replay.noSummaryYet')}</p>
                        <p className={css.emptyText}>
                          {t('replay.noSummaryHint', { count: transcripts.length })}
                        </p>
                        {generateError && (
                          <p className={css.errorText} role="alert">{generateError}</p>
                        )}
                        <div className={css.emptyActions}>
                          <button type="button" className={cx(css.btn, css.btnFill)} onClick={generateSummary}>
                            {plainLabel(t('replay.generateSummary'))}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <EmptyIcon kind="captions" />
                        <p className={css.emptyTitle}>{t('replay.noTranscriptForSummary')}</p>
                        <p className={css.emptyText}>{t('replay.noTranscriptForSummaryHint')}</p>
                      </>
                    )}
                  </div>
                )
              )}
              {activeTab === 'transcript' && (
                <TranscriptPanel
                  transcripts={transcripts}
                  currentTime={currentTime}
                  onSeek={seekTo}
                />
              )}
              {activeTab === 'info' && (
                <InfoPanel meeting={meeting} recording={recording} />
              )}
            </div>
          </aside>
        )}
      </main>

      {(canAskTranscribe && meeting && (!hasTranscripts || unfinished)) && (
        <RecordingTranscribePrompt
          recordingKey={id}
          initial={recording.transcribe ?? IDLE_TRANSCRIBE}
          onDone={handleTranscribeDone}
        />
      )}

      {snack && (
        <div className={css.snackbar} role="status" aria-live="polite">{snack}</div>
      )}
    </div>
  );
}
