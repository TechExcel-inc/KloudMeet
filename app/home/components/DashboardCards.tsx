'use client';

import React from 'react';
import { Copy, Link2, Play, Video } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { tileHue } from '@/lib/tileLayout';
import { replayMinutes, type DashMeeting, type ReplayItem, type UpNextItem } from '../dashboardData';
import styles from '../../../styles/Home.module.css';

const DAY_MS = 24 * 60 * 60 * 1000;

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "14:30" today, "Fri" within the week, "Nov 3" after that. */
function whenLabel(at: number, now: number, locale: string): string {
  const d = new Date(at);
  if (sameDay(d, new Date(now))) {
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (at - now < 6 * DAY_MS) return d.toLocaleDateString(locale, { weekday: 'short' });
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

function hostName(m: DashMeeting) {
  return m.createdByMember?.fullName || m.createdByMember?.username || '';
}

export function UpNextCard({
  items,
  now,
  userId,
  onJoin,
  onStart,
  renderInvite,
  onSeeAll,
}: {
  items: UpNextItem[];
  now: number;
  userId: string;
  onJoin: (m: DashMeeting) => void;
  onStart: (m: DashMeeting) => void;
  /** The invite button and its menu, as in the meeting list. */
  renderInvite: (m: DashMeeting) => React.ReactNode;
  onSeeAll: () => void;
}) {
  const { t, locale } = useI18n();
  return (
    <section className={styles.dashCard} aria-labelledby="dash-up-next">
      <header className={styles.dashCardHeader}>
        <h2 id="dash-up-next" className={styles.dashCardTitle}>{t('dash.upNext')}</h2>
        <button type="button" className={styles.dashTextLink} onClick={onSeeAll}>
          {t('dash.seeAllMeetings')}
        </button>
      </header>

        <ul className={styles.upNextList}>
          {items.map(({ meeting: m, kind, at }) => {
            const isHost = String(m.createdByMemberId) === String(userId);
            const diff = at - now;
            let sub: React.ReactNode;
            let subTone = '';
            if (kind === 'live') {
              const mins = Math.max(0, Math.floor((now - at) / 60000));
              sub = t('dash.liveFor', { n: mins });
              subTone = styles.upNextSubLive;
            } else if (diff > 0 && diff <= 60 * 60 * 1000) {
              sub = t('dash.startsIn', { time: t('dash.mins', { n: Math.max(1, Math.ceil(diff / 60000)) }) });
              subTone = styles.upNextSubSoon;
            } else if (diff <= 0) {
              sub = t('dash.overdueBy', { time: t('dash.mins', { n: Math.max(1, Math.floor(-diff / 60000)) }) });
              subTone = styles.upNextSubLate;
            } else {
              const time = new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
              const extra = isHost
                ? m.durationMinutes ? t('dash.mins', { n: m.durationMinutes }) : ''
                : hostName(m) ? t('dash.by', { name: hostName(m) }) : '';
              sub = extra ? `${time} · ${extra}` : time;
            }
            return (
              <li key={m.id ?? m.roomName} className={styles.upNextRow}>
                <div className={styles.upNextWhen}>
                  {kind === 'live' ? (
                    <span className={styles.upNextNow}>
                      <span className={styles.liveDot} aria-hidden="true" />
                      {t('dash.now')}
                    </span>
                  ) : (
                    whenLabel(at, now, locale)
                  )}
                </div>
                <div className={styles.upNextInfo}>
                  <p className={styles.upNextTitle}>{m.title || m.roomName || t('dash.untitledMeeting')}</p>
                  <p className={`${styles.upNextSub} ${subTone}`}>{sub}</p>
                </div>
                <div className={styles.upNextActions}>
                  {renderInvite(m)}
                  {kind === 'live' ? (
                    <button type="button" className={`${styles.btn} ${styles.btnXs} ${styles.btnFill} ${styles.btnFlat}`} onClick={() => onJoin(m)}>
                      <Video size={15} aria-hidden="true" />
                      {t('common.join')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnXs} ${styles.btnTonal}`}
                      onClick={() => (isHost ? onStart(m) : onJoin(m))}
                    >
                      {isHost ? t('common.start') : t('common.join')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
    </section>
  );
}

export function RecentReplaysCard({ items, onOpen }: { items: ReplayItem[]; onOpen: (item: ReplayItem) => void }) {
  const { t, locale } = useI18n();
  return (
    <section className={styles.dashCard} aria-labelledby="dash-replays">
      <header className={styles.dashCardHeader}>
        <h2 id="dash-replays" className={styles.dashCardTitle}>{t('dash.recentReplays')}</h2>
      </header>
      <ul className={styles.replayGrid}>
        {items.map((item) => {
          const m = item.meeting;
          const title = m.title || m.roomName || t('dash.untitledMeeting');
          const mins = replayMinutes(item);
          const date = new Date(m.scheduledFor || m.createdAt || 0).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
          return (
            <li key={String(item.recording.id)}>
              <button
                type="button"
                className={styles.replayTile}
                onClick={() => onOpen(item)}
                style={{ ['--km-tile-hue' as string]: String(tileHue(title)) } as React.CSSProperties}
              >
                <span className={styles.replayThumb} aria-hidden="true">
                  <span className={styles.replayPlay}>
                    <Play size={18} fill="currentColor" />
                  </span>
                  {mins !== null && <span className={styles.replayLength}>{t('dash.mins', { n: mins })}</span>}
                </span>
                <span className={styles.replayTitle}>{title}</span>
                <span className={styles.replayMeta}>{date}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function PersonalRoomCard({
  link,
  onStart,
  onCopy,
  starting,
  compact,
}: {
  link: string;
  onStart: () => void;
  onCopy: () => void;
  starting?: boolean;
  /** One row (title · link · start) when it is the only card on the page */
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <section className={`${styles.dashCard}${compact ? ` ${styles.roomCardCompact}` : ''}`} aria-labelledby="dash-room">
      <h2 id="dash-room" className={styles.dashCardTitle}>{t('dash.personalRoom')}</h2>
      {!compact && <p className={styles.dashCardHint}>{t('dash.personalRoomHint')}</p>}
      <div className={styles.roomLinkRow}>
        <Link2 size={16} aria-hidden="true" />
        <span className={styles.roomLinkText}>{link.replace(/^https?:\/\//, '')}</span>
        <button type="button" className={styles.iconBtn} onClick={onCopy} aria-label={t('dash.copyLink')} title={t('dash.copyLink')}>
          <Copy size={16} aria-hidden="true" />
        </button>
      </div>
      <button type="button" className={`${styles.btn} ${styles.btnXs} ${styles.btnTonal}`} onClick={onStart} disabled={starting}>
        <Video size={15} aria-hidden="true" />
        {t('dash.startRoom')}
      </button>
    </section>
  );
}
