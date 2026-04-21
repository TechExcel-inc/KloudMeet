'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n';

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
  sortOrder: number;
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
    streamUrl: string | null;
    status: string;
    createdAt: string;
    recordedBy: { fullName: string | null; username: string } | null;
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

const COLORS = [
  '#6366f1', '#ec4899', '#14b8a6', '#f59e0b',
  '#8b5cf6', '#10b981', '#ef4444', '#3b82f6',
];
function speakerColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}

/* ─── Sub-components ─────────────────────────────────────── */

/** 章节摘要面板 */
function SummaryPanel({
  items,
  currentTime,
  duration,
  onSeek,
  meetingId,
  kloudMeetingId,
}: {
  items: SummaryItem[];
  currentTime: number;
  duration: number;
  onSeek: (secs: number) => void;
  meetingId: number;
  kloudMeetingId: number | null;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [localItems, setLocalItems] = useState<SummaryItem[]>(items);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => setLocalItems(items), [items]);

  // 高亮当前所在章节
  const activeIdx = localItems.reduce((acc, item, idx) => {
    const s = offsetToSecs(item.timeOffset);
    return s <= currentTime ? idx : acc;
  }, -1);

  if (!localItems.length) {
    if (!meetingId) {
      return (
        <div style={styles.emptyPanel}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <p style={{ color: '#94a3b8' }}>{t('replay.noSummaryData')}</p>
        </div>
      );
    }
    return (
      <div style={styles.emptyPanel}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
        <p style={{ color: '#94a3b8', marginBottom: 8 }}>{t('replay.noSummary')}</p>
        <p style={{ color: '#475569', fontSize: 12, marginBottom: 16 }}>
          {kloudMeetingId ? t('replay.summaryHint') : t('replay.summaryNoSource')}
        </p>
        {kloudMeetingId ? (
          <button
            style={styles.genBtn}
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
            {loading ? t('replay.fetchingSummary') : t('replay.fetchSummary')}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div style={styles.panelScroll}>
      {localItems.map((item, idx) => {
        const isActive = idx === activeIdx;
        const isOpen = expanded === item.id;
        return (
          <div
            key={item.id}
            style={{
              ...styles.summaryCard,
              background: isActive ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.03)',
              borderLeft: isActive ? '3px solid #6366f1' : '3px solid transparent',
            }}
          >
            <div
              style={styles.summaryCardHeader}
              onClick={() => {
                onSeek(offsetToSecs(item.timeOffset));
                setExpanded(isOpen ? null : item.id);
              }}
            >
              <span style={styles.chapterTime}>{item.timeOffset}</span>
              <span style={{ ...styles.chapterTitle, color: isActive ? '#818cf8' : '#e2e8f0' }}>
                {item.title}
              </span>
              <span style={{ color: '#475569', fontSize: 12 }}>{isOpen ? '▲' : '▼'}</span>
            </div>
            {isOpen && (
              <div style={styles.chapterContent}>{item.content}</div>
            )}
          </div>
        );
      })}
    </div>
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
  const activeRef = useRef<HTMLDivElement>(null);

  const filtered = search
    ? transcripts.filter((t) => t.content.toLowerCase().includes(search.toLowerCase()))
    : transcripts;

  // 当前正在播放的字幕
  const activeId = transcripts.reduce((acc, t) => {
    if (t.offsetSeconds !== null && t.offsetSeconds <= currentTime) return t.id;
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
  for (const t of filtered) {
    if (!groups.length || groups[groups.length - 1].speaker !== t.speakerName) {
      groups.push({ speaker: t.speakerName, items: [t] });
    } else {
      groups[groups.length - 1].items.push(t);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 搜索框 */}
      <div style={styles.searchBox}>
        <span style={{ color: '#64748b', marginRight: 8 }}>🔍</span>
        <input
          style={styles.searchInput}
          placeholder={t('replay.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button style={styles.clearBtn} onClick={() => setSearch('')}>✕</button>
        )}
      </div>

      {/* 字幕列表 */}
      <div style={styles.panelScroll}>
        {!filtered.length && (
          <div style={styles.emptyPanel}>
            <p style={{ color: '#94a3b8' }}>
              {search ? t('replay.noMatch') : t('replay.noTranscript')}
            </p>
          </div>
        )}
        {groups.map((group, gi) => (
          <div key={gi} style={{ marginBottom: 16 }}>
            {/* 说话人头像 + 名字 */}
            <div style={styles.speakerRow}>
              <div
                style={{
                  ...styles.speakerAvatar,
                  background: speakerColor(group.speaker),
                }}
              >
                {getInitials(group.speaker)}
              </div>
              <span style={styles.speakerName}>{group.speaker}</span>
              {group.items[0].offsetSeconds !== null && (
                <span style={styles.speakerTime}>{fmtTime(group.items[0].offsetSeconds)}</span>
              )}
            </div>
            {/* 逐条字幕气泡 */}
            {group.items.map((t) => {
              const isActive = t.id === activeId;
              return (
                <div
                  key={t.id}
                  ref={isActive ? activeRef : null}
                  style={{
                    ...styles.captionBubble,
                    background: isActive ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.06)',
                    borderColor: isActive ? '#6366f1' : 'transparent',
                    cursor: t.offsetSeconds !== null ? 'pointer' : 'default',
                  }}
                  onClick={() => t.offsetSeconds !== null && onSeek(t.offsetSeconds)}
                >
                  {t.content}
                </div>
              );
            })}
          </div>
        ))}
      </div>
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
    <div style={styles.panelScroll}>
      <div style={styles.infoSection}>
        <h4 style={styles.infoLabel}>{t('replay.meetingTitle')}</h4>
        <p style={styles.infoValue}>{meeting.title || meeting.roomName}</p>
      </div>
      {meeting.actualStartedAt && (
        <div style={styles.infoSection}>
          <h4 style={styles.infoLabel}>{t('replay.startTime')}</h4>
          <p style={styles.infoValue}>{new Date(meeting.actualStartedAt).toLocaleString()}</p>
        </div>
      )}
      {meeting.actualDurationMinutes && (
        <div style={styles.infoSection}>
          <h4 style={styles.infoLabel}>{t('replay.meetingDuration')}</h4>
          <p style={styles.infoValue}>{t('replay.minutes', { n: meeting.actualDurationMinutes })}</p>
        </div>
      )}
      {recording.durationSeconds && (
        <div style={styles.infoSection}>
          <h4 style={styles.infoLabel}>{t('replay.recordingDuration')}</h4>
          <p style={styles.infoValue}>{fmtTime(recording.durationSeconds)}</p>
        </div>
      )}
      {meeting.createdBy && (
        <div style={styles.infoSection}>
          <h4 style={styles.infoLabel}>{t('replay.host')}</h4>
          <p style={styles.infoValue}>{meeting.createdBy.fullName || meeting.createdBy.username}</p>
        </div>
      )}
      <div style={styles.infoSection}>
        <h4 style={styles.infoLabel}>{t('replay.participants')}({meeting.participants.length})</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {meeting.participants.map((p) => (
            <div key={p.id} style={styles.participantRow}>
              <div
                style={{
                  ...styles.speakerAvatar,
                  background: speakerColor(p.displayName),
                  width: 32,
                  height: 32,
                  fontSize: 12,
                }}
              >
                {getInitials(p.displayName)}
              </div>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: 13 }}>{p.displayName}</div>
                {p.durationSeconds && (
                  <div style={{ color: '#64748b', fontSize: 11 }}>{t('replay.online', { time: fmtTime(p.durationSeconds) })}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 参与者发言进度条 */
function ParticipantTimeline({
  transcripts,
  participants,
  duration,
  currentTime,
  onSeek,
}: {
  transcripts: Transcript[];
  participants: Participant[];
  duration: number;
  currentTime: number;
  onSeek: (secs: number) => void;
}) {
  if (!duration || !transcripts.length) return null;

  // 聚合：每个发言人的发言时段
  const speakerMap: Record<string, number[]> = {};
  for (const t of transcripts) {
    if (t.offsetSeconds === null) continue;
    if (!speakerMap[t.speakerName]) speakerMap[t.speakerName] = [];
    speakerMap[t.speakerName].push(t.offsetSeconds);
  }

  const speakers = Object.keys(speakerMap).slice(0, 6); // 最多显示6人

  return (
    <div style={styles.timelineContainer}>
      {speakers.map((name) => {
        const offsets = speakerMap[name];
        return (
          <div key={name} style={styles.timelineRow}>
            <div style={styles.timelineLabel} title={name}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: speakerColor(name),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  color: '#fff',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {getInitials(name)}
              </div>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                {name}
              </span>
            </div>
            <div style={styles.timelineBar}>
              {offsets.map((sec, i) => {
                const left = `${(sec / duration) * 100}%`;
                return (
                  <div
                    key={i}
                    title={fmtTime(sec)}
                    style={{
                      position: 'absolute',
                      left,
                      top: 2,
                      width: 4,
                      height: 'calc(100% - 4px)',
                      borderRadius: 2,
                      background: speakerColor(name),
                      opacity: 0.85,
                      cursor: 'pointer',
                    }}
                    onClick={() => onSeek(sec)}
                  />
                );
              })}
              {/* 当前播放位置 */}
              <div
                style={{
                  position: 'absolute',
                  left: `${(currentTime / duration) * 100}%`,
                  top: 0,
                  width: 2,
                  height: '100%',
                  background: '#818cf8',
                  opacity: 0.7,
                  pointerEvents: 'none',
                }}
              />
            </div>
          </div>
        );
      })}
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
  const [playing, setPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'transcript' | 'info'>('summary');

  const videoRef = useRef<HTMLVideoElement>(null);

  // 加载聚合数据
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        // 从 localStorage 读取 token（和 Dashboard 一致）
        const stored = typeof window !== 'undefined' ? localStorage.getItem('kloudUser') : null;
        const token = stored ? (JSON.parse(stored).token || '') : '';

        const res = await fetch(`/api/recordings/${id}/summary`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.status === 401) {
          setError('请登录后再查看回放');
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
        setLoading(false);
      }
    })();
  }, [id]);

  const seekTo = useCallback((secs: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = secs;
      videoRef.current.play();
      setPlaying(true);
    }
  }, []);

  /* ── Loading ── */
  if (loading) {
    return (
      <div style={styles.fullCenter}>
        <div style={styles.spinner} />
        <p style={{ color: '#94a3b8', marginTop: 16 }}>{t('replay.loading')}</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  /* ── Error ── */
  if (error || !data?.recording.streamUrl) {
    return (
      <div style={styles.fullCenter}>
        <div style={{ textAlign: 'center', padding: 40, background: '#1e293b', borderRadius: 16, border: '1px solid #334155', maxWidth: 420 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ color: '#f1f5f9', marginBottom: 8 }}>{t('replay.notReady')}</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 24 }}>{error || t('replay.processing')}</p>
          <Link href="/" style={styles.primaryBtn}>{t('replay.back')}</Link>
        </div>
      </div>
    );
  }

  const { recording, meeting } = data;
  const summaryItems = meeting?.summaryItems || [];
  const transcripts = meeting?.transcripts || [];
  const participants = meeting?.participants || [];
  const meetingTitle = meeting?.title || meeting?.roomName || t('replay.loading');

  const tabs = [
    { key: 'summary', label: t('replay.tabSummary'), count: summaryItems.length },
    { key: 'transcript', label: t('replay.tabTranscript'), count: transcripts.length },
    { key: 'info', label: t('replay.tabInfo'), count: null },
  ] as const;

  return (
    <div style={styles.page}>
      {/* ── Header ── */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <Link href="/" style={styles.backBtn}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            {t('replay.back')}
          </Link>
          <div style={styles.headerTitle}>
            <span style={{ color: '#6366f1', marginRight: 6 }}>🎬</span>
            <span>{meetingTitle}</span>
            {meeting?.actualStartedAt && (
              <span style={styles.headerDate}>
                {new Date(meeting.actualStartedAt).toLocaleDateString('zh-CN', {
                  year: 'numeric', month: '2-digit', day: '2-digit',
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            )}
          </div>
        </div>
        <div style={styles.headerRight}>
          <a
            href={recording.streamUrl!}
            download={recording.fileName}
            style={styles.downloadBtn}
          >
            {t('replay.download')}
          </a>
        </div>
      </header>

      {/* ── Main Layout ── */}
      <div style={styles.mainLayout}>
        {/* Left: Video + Timeline */}
        <div style={styles.leftPanel}>
          {/* Video Player */}
          <div style={styles.videoWrap}>
            <video
              ref={videoRef}
              src={recording.streamUrl!}
              controls
              style={styles.video}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onDurationChange={(e) => setDuration(e.currentTarget.duration)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          </div>

          {/* 章节进度条（若有摘要） */}
          {summaryItems.length > 0 && duration > 0 && (
            <div style={styles.chapterBar}>
              {summaryItems.map((item, idx) => {
                const s = offsetToSecs(item.timeOffset);
                const nextS = idx < summaryItems.length - 1 ? offsetToSecs(summaryItems[idx + 1].timeOffset) : duration;
                const left = `${(s / duration) * 100}%`;
                const width = `${((nextS - s) / duration) * 100}%`;
                const isActive = currentTime >= s && currentTime < nextS;
                return (
                  <div
                    key={item.id}
                    title={`${item.timeOffset} ${item.title}`}
                    style={{
                      position: 'absolute',
                      left,
                      width,
                      top: 0,
                      height: '100%',
                      background: isActive ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)',
                      borderRight: '1px solid rgba(255,255,255,0.15)',
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                      transition: 'background 0.2s',
                    }}
                    onClick={() => seekTo(s)}
                  />
                );
              })}
              {/* 播放位置游标 */}
              {duration > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${(currentTime / duration) * 100}%`,
                    top: 0,
                    width: 2,
                    height: '100%',
                    background: '#818cf8',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          )}

          {/* 参与者发言时间轴 */}
          <ParticipantTimeline
            transcripts={transcripts}
            participants={participants}
            duration={duration}
            currentTime={currentTime}
            onSeek={seekTo}
          />

          {/* 当前播放时间 */}
          <div style={styles.timeInfo}>
            <span style={{ color: '#818cf8' }}>{fmtTime(currentTime)}</span>
            <span style={{ color: '#475569' }}> / {fmtTime(duration)}</span>
            {participants.length > 0 && (
              <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 12 }}>
                👥 {participants.length} 位参与者
              </span>
            )}
          </div>
        </div>

        {/* Right: Tab Panel */}
        <div style={styles.rightPanel}>
          {/* Tabs */}
          <div style={styles.tabBar}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                style={{
                  ...styles.tabBtn,
                  ...(activeTab === tab.key ? styles.tabBtnActive : {}),
                }}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
                {tab.count !== null && tab.count > 0 && (
                  <span style={styles.tabBadge}>{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div style={styles.tabContent}>
            {activeTab === 'summary' && (
              <SummaryPanel
                items={summaryItems}
                currentTime={currentTime}
                duration={duration}
                onSeek={seekTo}
                meetingId={meeting?.id ?? 0}
                kloudMeetingId={meeting?.kloudMeetingId ?? null}
              />
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
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; background: #0f172a; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 768px) {
          .replay-main { flex-direction: column !important; }
          .replay-right { width: 100% !important; height: 360px !important; }
        }
      `}</style>
    </div>
  );
}

/* ─── Styles ─────────────────────────────────────────────── */
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0f172a',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'Inter', sans-serif",
    color: '#e2e8f0',
  },
  fullCenter: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f172a',
    fontFamily: "'Inter', sans-serif",
  },
  spinner: {
    width: 44,
    height: 44,
    border: '3px solid #1e293b',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  header: {
    background: '#1e293b',
    borderBottom: '1px solid #1e293b',
    padding: '0 20px',
    height: 56,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    boxShadow: '0 1px 0 rgba(255,255,255,0.05)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    flex: 1,
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: '#94a3b8',
    textDecoration: 'none',
    fontSize: 13,
    padding: '5px 10px',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    flexShrink: 0,
    transition: 'all 0.15s',
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 15,
    fontWeight: 600,
    color: '#f1f5f9',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headerDate: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: 400,
    flexShrink: 0,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  downloadBtn: {
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
    border: '1px solid rgba(99,102,241,0.3)',
    padding: '6px 14px',
    borderRadius: 8,
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 500,
  },
  primaryBtn: {
    background: '#6366f1',
    color: '#fff',
    padding: '10px 24px',
    borderRadius: 8,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 500,
  },

  /* Layout */
  mainLayout: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  leftPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    background: '#0b1120',
    borderRight: '1px solid #1e293b',
  },
  videoWrap: {
    width: '100%',
    background: '#000',
    flexShrink: 0,
  },
  video: {
    width: '100%',
    display: 'block',
    maxHeight: '55vh',
    outline: 'none',
  },
  chapterBar: {
    position: 'relative',
    height: 28,
    background: '#0f172a',
    borderTop: '1px solid #1e293b',
    flexShrink: 0,
    cursor: 'pointer',
  },
  timeInfo: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 16px',
    fontSize: 13,
    borderTop: '1px solid #1e293b',
    background: '#0f172a',
    flexShrink: 0,
  },

  /* Timeline */
  timelineContainer: {
    padding: '10px 16px',
    background: '#0f172a',
    borderTop: '1px solid #1e293b',
    flexShrink: 0,
  },
  timelineRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    height: 22,
  },
  timelineLabel: {
    width: 100,
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
    color: '#94a3b8',
    fontSize: 11,
  },
  timelineBar: {
    flex: 1,
    height: 18,
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 4,
    position: 'relative',
    overflow: 'hidden',
    cursor: 'pointer',
  },

  /* Right Panel */
  rightPanel: {
    width: 360,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: '#111827',
    overflow: 'hidden',
  },
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid #1e293b',
    background: '#0f172a',
    flexShrink: 0,
  },
  tabBtn: {
    flex: 1,
    padding: '12px 8px',
    background: 'none',
    border: 'none',
    color: '#64748b',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderBottom: '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
    fontFamily: 'inherit',
  },
  tabBtnActive: {
    color: '#818cf8',
    borderBottom: '2px solid #6366f1',
  },
  tabBadge: {
    background: '#1e293b',
    color: '#94a3b8',
    fontSize: 10,
    padding: '1px 5px',
    borderRadius: 99,
  },
  tabContent: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  panelScroll: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 14px',
  },

  /* Summary */
  emptyPanel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: 200,
    padding: 24,
    textAlign: 'center',
  },
  genBtn: {
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  summaryCard: {
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden',
    transition: 'background 0.2s',
  },
  summaryCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  chapterTime: {
    color: '#6366f1',
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'monospace',
    flexShrink: 0,
    background: 'rgba(99,102,241,0.12)',
    padding: '2px 6px',
    borderRadius: 4,
  },
  chapterTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.4,
  },
  chapterContent: {
    padding: '0 12px 12px',
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 1.6,
  },

  /* Transcript */
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 14px',
    borderBottom: '1px solid #1e293b',
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid #1e293b',
    borderRadius: 8,
    padding: '6px 10px',
    color: '#e2e8f0',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
  },
  clearBtn: {
    background: 'none',
    border: 'none',
    color: '#64748b',
    cursor: 'pointer',
    marginLeft: 6,
    fontSize: 14,
  },
  speakerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  speakerAvatar: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
  },
  speakerName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#cbd5e1',
  },
  speakerTime: {
    fontSize: 11,
    color: '#475569',
    marginLeft: 'auto',
  },
  captionBubble: {
    marginLeft: 36,
    marginBottom: 4,
    padding: '7px 10px',
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 1.5,
    color: '#cbd5e1',
    border: '1px solid',
    transition: 'all 0.15s',
  },

  /* Info */
  infoSection: {
    marginBottom: 18,
    paddingBottom: 18,
    borderBottom: '1px solid #1e293b',
  },
  infoLabel: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontWeight: 600,
  },
  infoValue: {
    fontSize: 14,
    color: '#e2e8f0',
  },
  participantRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 0',
  },
};
