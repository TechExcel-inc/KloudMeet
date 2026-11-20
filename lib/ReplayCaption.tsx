'use client';

import React from 'react';
import { captionAt, timedLines, type CaptionLine } from '@/lib/notesReplay/captions';
import styles from '@/styles/Replay.module.css';

export interface ReplayCaptionProps {
  /** 这场回放的逐条字幕 */
  lines: readonly CaptionLine[];
  /** 播放时钟，秒 */
  time: number;
  /** 普通视频的控制条盖住画面底部，字幕往上让开 */
  lift?: boolean;
  open: boolean;
}

/**
 * ReplayCaption — 回放画面底部正中的字幕
 *
 * 显示当前这句话和说话人。整条可以在画面里拖动。
 */
export function ReplayCaption({ lines, time, lift = false, open }: ReplayCaptionProps) {
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ dx: number; dy: number } | null>(null);
  const timed = React.useMemo(() => timedLines([...lines]), [lines]);
  const moment = captionAt(timed, time);
  const line = moment.current && !moment.quiet ? moment.current : null;

  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const root = rootRef.current;
    const stage = root?.offsetParent;
    if (!root || !(stage instanceof HTMLElement)) return;
    const box = root.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();
    dragRef.current = {
      dx: event.clientX - box.left,
      dy: event.clientY - box.top,
    };
    place(box.left - stageBox.left, box.top - stageBox.top, root, stage);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const root = rootRef.current;
    const stage = root?.offsetParent;
    if (!drag || !root || !(stage instanceof HTMLElement)) return;
    const stageBox = stage.getBoundingClientRect();
    place(event.clientX - stageBox.left - drag.dx, event.clientY - stageBox.top - drag.dy, root, stage);
  };

  function place(x: number, y: number, root: HTMLElement, stage: HTMLElement) {
    const fraction = (value: number, space: number) => space > 0 ? Math.min(1, Math.max(0, value / space)) : 0;
    setPos({
      x: 100 * fraction(x, stage.clientWidth - root.offsetWidth),
      y: 100 * fraction(y, stage.clientHeight - root.offsetHeight),
    });
  }

  const positionStyle = pos
    ? { left: `${pos.x}%`, top: `${pos.y}%`, transform: `translate(-${pos.x}%, -${pos.y}%)` }
    : undefined;

  const endDrag = () => {
    dragRef.current = null;
  };

  if (!open || !line) return null;
  const name = line.speakerName.trim();

  return (
    <div
      ref={rootRef}
      className={pos ? `${styles.cue} ${styles.cuePlaced}` : `${styles.cue}${lift ? ` ${styles.cueLift}` : ''}`}
      style={positionStyle}
    >
      <div
        className={styles.cueBar}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => { dragRef.current = null; }}
      >
        <p className={styles.cueLine}>
          {name && <span className={styles.cueWho}>{name}</span>}
          <span className={styles.cueText}>{line.content}</span>
        </p>
      </div>
    </div>
  );
}

export function CaptionIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="5.5" width="19" height="13" rx="3" />
      {enabled ? <path d="M10.5 10a2.5 2.5 0 1 0 0 4M17.5 10a2.5 2.5 0 1 0 0 4" /> :
        <path d="M3 3l18 18M9 10a2 2 0 0 0 1 4m5-4a2 2 0 0 1 2 2" />}
    </svg>
  );
}
