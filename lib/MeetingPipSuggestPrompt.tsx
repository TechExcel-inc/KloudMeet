'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import styles from '@/styles/MeetingPipSuggestPrompt.module.css';

const MARGIN = 16;
const TOOLBAR_GAP = 88;
const DRAG_THRESHOLD = 4;

export interface MeetingPipSuggestPromptProps {
  visible: boolean;
  attendeeCount: number;
  onEnable: () => void;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function DockGlyph() {
  return (
    <svg viewBox="0 0 24 24" className={styles.glyph} fill="none" aria-hidden="true">
      <circle cx="8.2" cy="7.2" r="2.1" fill="currentColor" />
      <circle cx="15.8" cy="7.2" r="2.1" fill="currentColor" />
      <path
        d="M5.4 18.2V12.6c0-1.5 1.2-2.7 2.7-2.7h1.2c.6 0 1.2.2 1.6.6L12 11.8l1.1-1.3c.4-.4 1-.6 1.6-.6h1.2c1.5 0 2.7 1.2 2.7 2.7v5.6"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MeetingPipSuggestPrompt({
  visible,
  attendeeCount,
  onEnable,
}: MeetingPipSuggestPromptProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState<{ cx: number; y: number } | null>(null);
  const dragRef = useRef<{
    pointer: number;
    startX: number;
    startY: number;
    origCx: number;
    origY: number;
    moved: boolean;
    action: 'enable' | 'collapse' | null;
  } | null>(null);
  const stopDragRef = useRef<(() => void) | null>(null);

  const showFull = !collapsed;
  const badge = Math.max(1, attendeeCount);

  const pinToDefault = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      cx: rect.left + rect.width / 2,
      y: clamp(window.innerHeight - rect.height - TOOLBAR_GAP, MARGIN, window.innerHeight - rect.height - MARGIN),
    });
  }, []);

  useEffect(() => {
    if (!visible || pos) return;
    pinToDefault();
  }, [visible, pos, pinToDefault, showFull]);

  useEffect(() => {
    if (!pos) return;
    const fit = () => {
      const el = rootRef.current;
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setPos((prev) => {
        if (!prev) return prev;
        const half = w / 2;
        return {
          cx: clamp(prev.cx, MARGIN + half, Math.max(MARGIN + half, window.innerWidth - MARGIN - half)),
          y: clamp(prev.y, MARGIN, Math.max(MARGIN, window.innerHeight - h - MARGIN)),
        };
      });
    };
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [pos, showFull]);

  useEffect(() => () => stopDragRef.current?.(), []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (!(e.target instanceof Element)) return;
    e.preventDefault();
    const button = e.target.closest('button');
    const raw = button?.dataset.action;
    const action = raw === 'enable' || raw === 'collapse' ? raw : null;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    stopDragRef.current?.();
    dragRef.current = {
      pointer: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origCx: pos?.cx ?? rect.left + rect.width / 2,
      origY: pos?.y ?? rect.top,
      moved: false,
      action,
    };

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || ev.pointerId !== drag.pointer) return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!drag.moved) setDragging(true);
      drag.moved = true;
      const node = rootRef.current;
      const w = node?.offsetWidth ?? 0;
      const h = node?.offsetHeight ?? 0;
      const half = w / 2;
      setPos({
        cx: clamp(drag.origCx + dx, MARGIN + half, Math.max(MARGIN + half, window.innerWidth - MARGIN - half)),
        y: clamp(drag.origY + dy, MARGIN, Math.max(MARGIN, window.innerHeight - h - MARGIN)),
      });
    };

    const onUp = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || ev.pointerId !== drag.pointer) return;
      stop();
      if (drag.moved) return;
      if (drag.action === 'enable') {
        onEnable();
        return;
      }
      if (drag.action === 'collapse') {
        setCollapsed(true);
        return;
      }
      if (collapsed) setCollapsed(false);
    };

    const stop = () => {
      dragRef.current = null;
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (stopDragRef.current === stop) stopDragRef.current = null;
    };

    stopDragRef.current = stop;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  if (!visible) return null;

  return (
    <div
      ref={rootRef}
      className={`${styles.root}${showFull ? ` ${styles.rootFull}` : ` ${styles.rootMini}`}${dragging ? ` ${styles.rootDrag}` : ''}`}
      role="dialog"
      aria-label={t('meeting.pipSuggestEnable')}
      style={
        pos
          ? ({
              left: pos.cx,
              right: 'auto',
              top: pos.y,
              bottom: 'auto',
              transform: 'translateX(-50%)',
            } as React.CSSProperties)
          : undefined
      }
      onPointerDown={onPointerDown}
    >
      {showFull ? (
        <div className={styles.bar}>
          <div className={styles.iconMark}>
            <DockGlyph />
            <span className={styles.badge}>{badge}</span>
          </div>
          <button type="button" className={styles.enableBtn} data-action="enable">
            {t('meeting.pipSuggestEnable')}
          </button>
          <button
            type="button"
            className={styles.chevron}
            data-action="collapse"
            aria-label={t('meeting.pipSuggestCollapse')}
            title={t('meeting.pipSuggestCollapse')}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4">
              <polyline points="15 6 9 12 15 18" />
            </svg>
          </button>
        </div>
      ) : (
        <div className={styles.mini}>
          <div className={styles.miniIcon}>
            <DockGlyph />
            <span className={styles.badge}>{badge}</span>
          </div>
        </div>
      )}
    </div>
  );
}
