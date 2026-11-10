'use client';

import React from 'react';
import { peopleAt, type PresenceEvent } from '@/lib/livedoc/presence';
import { useI18n } from '@/lib/i18n';
import styles from '@/styles/Replay.module.css';

export interface ReplayPeopleProps {
  /** Presence events of a LiveDoc Full recording, in any order */
  events: readonly PresenceEvent[];
  /** LiveDoc clock, milliseconds from the recording start */
  atMs: number;
  /** Who the transcript says is speaking now */
  speaking: string;
}

/**
 * ReplayPeople — 回放舞台上可拖拽的参会人浮窗。
 * 显示这一刻还在会里的人，以及麦克风、摄像头和是否正在说话。
 */
export function ReplayPeople({ events, atMs, speaking }: ReplayPeopleProps) {
  const { t } = useI18n();
  const people = peopleAt(events, atMs);
  const [open, setOpen] = React.useState(true);
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ dx: number; dy: number } | null>(null);
  const speakingName = speaking.trim();

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const root = rootRef.current;
    const stage = root?.offsetParent;
    if (!root || !(stage instanceof HTMLElement)) return;
    const box = root.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();
    dragRef.current = { dx: event.clientX - box.left, dy: event.clientY - box.top };
    setPos({ x: box.left - stageBox.left, y: box.top - stageBox.top });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const root = rootRef.current;
    const stage = root?.offsetParent;
    if (!drag || !root || !(stage instanceof HTMLElement)) return;
    const stageBox = stage.getBoundingClientRect();
    const maxX = Math.max(0, stage.clientWidth - root.offsetWidth);
    const maxY = Math.max(0, stage.clientHeight - root.offsetHeight);
    setPos({
      x: Math.min(maxX, Math.max(0, event.clientX - stageBox.left - drag.dx)),
      y: Math.min(maxY, Math.max(0, event.clientY - stageBox.top - drag.dy)),
    });
  };

  const place = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined;

  return (
    <div
      ref={rootRef}
      className={open ? styles.people : `${styles.people} ${styles.peopleShut}`}
      style={place}
    >
      <div
        className={styles.peopleBar}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          dragRef.current = null;
        }}
      >
        <span className={styles.peopleTitle}>{t('replay.peopleCount', { n: people.length })}</span>
        <button
          type="button"
          className={styles.peopleToggle}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? t('replay.peopleCollapse') : t('replay.peopleExpand')}
        </button>
      </div>
      {open && (
        people.length === 0 ? (
          <p className={styles.peopleEmpty}>{t('replay.peopleEmpty')}</p>
        ) : (
          <ul className={styles.peopleList}>
            {people.map((person) => {
              const active = speakingName !== '' && person.name.trim() === speakingName;
              return (
                <li key={person.identity} className={active ? `${styles.person} ${styles.personSpeaking}` : styles.person}>
                  <span className={styles.personAvatar} aria-hidden="true">{person.name.slice(0, 1).toUpperCase()}</span>
                  <span className={styles.personName}>
                    {person.name}
                    {active && <span className={styles.personLive}>{t('replay.speakingNow')}</span>}
                  </span>
                  <span className={person.mic ? styles.deviceOn : styles.deviceOff} title={person.mic ? t('replay.micOn') : t('replay.micOff')}>
                    <MicIcon off={!person.mic} />
                  </span>
                  <span className={person.cam ? styles.deviceOn : styles.deviceOff} title={person.cam ? t('replay.camOn') : t('replay.camOff')}>
                    <CamIcon off={!person.cam} />
                  </span>
                </li>
              );
            })}
          </ul>
        )
      )}
    </div>
  );
}

function MicIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

function CamIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="2" y="7" width="13" height="10" rx="2" />
      <path d="M15 10l6-3v10l-6-3z" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}
