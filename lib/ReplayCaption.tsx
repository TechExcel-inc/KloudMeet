'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import { captionAt, timedLines, type CaptionLine } from '@/lib/notesReplay/captions';
import styles from '@/styles/Replay.module.css';

export interface ReplayCaptionProps {
  /** 这场回放的逐条字幕 */
  lines: readonly CaptionLine[];
  /** 播放时钟，秒 */
  time: number;
  /** 普通视频的控制条盖住画面底部，字幕往上让开 */
  lift?: boolean;
}

/**
 * ReplayCaption — 回放画面底部正中的字幕
 *
 * 显示当前这句话和说话人。整条可以在画面里拖动，也能收成一个小圆点，点一下再展开。
 */
export function ReplayCaption({ lines, time, lift = false }: ReplayCaptionProps) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(true);
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const timed = React.useMemo(() => timedLines([...lines]), [lines]);
  const moment = captionAt(timed, time);
  const line = moment.current && !moment.quiet ? moment.current : null;

  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    const root = rootRef.current;
    const stage = root?.offsetParent;
    if (!root || !(stage instanceof HTMLElement)) return;
    const box = root.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();
    dragRef.current = { dx: event.clientX - box.left, dy: event.clientY - box.top, moved: false };
    setPos({ x: box.left - stageBox.left, y: box.top - stageBox.top });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const root = rootRef.current;
    const stage = root?.offsetParent;
    if (!drag || !root || !(stage instanceof HTMLElement)) return;
    if (Math.abs(event.movementX) + Math.abs(event.movementY) > 0) drag.moved = true;
    const stageBox = stage.getBoundingClientRect();
    const maxX = Math.max(0, stage.clientWidth - root.offsetWidth);
    const maxY = Math.max(0, stage.clientHeight - root.offsetHeight);
    setPos({
      x: Math.min(maxX, Math.max(0, event.clientX - stageBox.left - drag.dx)),
      y: Math.min(maxY, Math.max(0, event.clientY - stageBox.top - drag.dy)),
    });
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved && !open) setOpen(true);
  };

  if (timed.length === 0) return null;
  if (!open) {
    return (
      <div
        ref={rootRef}
        className={pos ? `${styles.cue} ${styles.cuePlaced}` : `${styles.cue}${lift ? ` ${styles.cueLift}` : ''}`}
        style={pos ? { left: pos.x, top: pos.y } : undefined}
      >
        <div
          className={styles.cueDot}
          role="button"
          tabIndex={0}
          aria-label={t('replay.captionExpand')}
          title={t('replay.captionExpand')}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            setOpen(true);
          }}
        >
          <CaptionIcon />
        </div>
      </div>
    );
  }
  if (!line) return null;
  const name = line.speakerName.trim();

  return (
    <div
      ref={rootRef}
      className={pos ? `${styles.cue} ${styles.cuePlaced}` : `${styles.cue}${lift ? ` ${styles.cueLift}` : ''}`}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
    >
      <div
        className={styles.cueBar}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      >
        <p className={styles.cueLine}>
          {name && <span className={styles.cueWho}>{name}</span>}
          <span className={styles.cueText}>{line.content}</span>
        </p>
        <button
          type="button"
          className={styles.cueFold}
          aria-label={t('replay.captionCollapse')}
          title={t('replay.captionCollapse')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setOpen(false)}
        >
          <MinusIcon />
        </button>
      </div>
    </div>
  );
}

function CaptionIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="5.5" width="19" height="13" rx="3" />
      <path d="M6.5 10.5h5.5M6.5 14h9" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 7l4 4M7 11h4V7M17 17l-4-4M17 13h-4v4" />
    </svg>
  );
}
