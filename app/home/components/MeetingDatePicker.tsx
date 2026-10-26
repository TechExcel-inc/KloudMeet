'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from '../../../styles/Home.module.css';
import { useTx } from './ui';

/** A day in the viewer's local time, as YYYY-MM-DD. */
export type Ymd = string;

const pad = (n: number) => String(n).padStart(2, '0');
export const toYmd = (d: Date): Ymd => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromYmd = (s: Ymd) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s: Ymd, n: number) => {
  const d = fromYmd(s);
  d.setDate(d.getDate() + n);
  return toYmd(d);
};
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** Chinese calendars start on Monday; English, Japanese and Korean ones on Sunday. */
const weekStartsOn = (locale: string) => (locale.startsWith('zh') ? 1 : 0);

const GAP = 6;
const EDGE = 8;

/**
 * The meeting list's "Go to date" calendar: one month, ‹ › to change it, a dot under days
 * that have meetings, today ringed, the picked day filled. Future days are off — what is
 * coming up already sits at the top of the list. "Today" goes back to the whole list.
 * Fixed-positioned under (or over) the label that opened it, so the list's scroll area
 * never clips it.
 */
export function MeetingDatePicker({
  anchor,
  locale,
  value,
  initialDay,
  loadMonth,
  onSelect,
  onToday,
  onClose,
}: {
  anchor: HTMLElement;
  locale: string;
  /** The day the list is jumped to, if any */
  value: Ymd | null;
  /** Where the calendar opens: the day of the label that was clicked */
  initialDay: Ymd;
  /** The days in a month (key YYYY-MM) that have meetings */
  loadMonth: (first: Date, next: Date) => Promise<Set<Ymd>>;
  onSelect: (day: Ymd) => void;
  onToday: () => void;
  onClose: () => void;
}) {
  const tx = useTx();
  const today = toYmd(new Date());
  const [focusDay, setFocusDay] = useState<Ymd>(() => (initialDay > today ? today : initialDay));
  const view = fromYmd(focusDay);
  const viewKey = monthKey(view);
  const [daysWithMeetings, setDaysWithMeetings] = useState<Record<string, Set<Ymd>>>({});
  const popRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const movedByKeyRef = useRef(false);
  // The parent passes a new onClose each render; keep the listeners and placement stable
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Dots for the month in view
  useEffect(() => {
    if (daysWithMeetings[viewKey]) return;
    let cancelled = false;
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const next = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    loadMonth(first, next)
      .then((days) => {
        if (!cancelled) setDaysWithMeetings((prev) => ({ ...prev, [viewKey]: days }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, loadMonth]);

  // Sit under the label; flip above it when the window has no room below
  const place = useCallback(() => {
    const pop = popRef.current;
    if (!pop) return;
    // The label it opened from went away (the list reloaded): nothing left to sit under
    if (!anchor.isConnected) {
      onCloseRef.current();
      return;
    }
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let top = r.bottom + GAP;
    if (top + h > window.innerHeight - EDGE && r.top - GAP - h >= EDGE) top = r.top - GAP - h;
    const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - w - EDGE));
    setPos((cur) => (cur && cur.top === top && cur.left === left ? cur : { top, left }));
  }, [anchor]);

  useLayoutEffect(() => {
    place();
  }, [place]);

  useEffect(() => {
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [place]);

  // Click outside closes; so does Escape (handled on the dialog)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || anchor.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [anchor]);

  // Focus follows the roving day: once placed (it's hidden until then), and after arrow keys
  const placed = pos !== null;
  useEffect(() => {
    if (!placed) return;
    if (!movedByKeyRef.current && document.activeElement && popRef.current?.contains(document.activeElement)) return;
    movedByKeyRef.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay, placed]);

  const start = weekStartsOn(locale);
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
    // 2026-10-04 is a Sunday
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2026, 9, 4 + ((i + start) % 7))));
  }, [locale, start]);
  const monthTitle = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(view);
  const fullDate = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), [locale]);

  // Six rows from the week holding the 1st, so the height never jumps between months
  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const lead = (first.getDay() - start + 7) % 7;
    const gridStart = toYmd(new Date(first.getFullYear(), first.getMonth(), 1 - lead));
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [view.getFullYear(), view.getMonth(), start]); // eslint-disable-line react-hooks/exhaustive-deps

  const canGoNext = viewKey < monthKey(new Date());
  const shiftMonth = (n: number) => {
    const d = fromYmd(focusDay);
    const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(d.getDate(), lastDay));
    const next = toYmd(target);
    setFocusDay(next > today ? today : next);
  };

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves) {
      e.preventDefault();
      const next = addDays(focusDay, moves[e.key]);
      movedByKeyRef.current = true;
      setFocusDay(next > today ? today : next);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      movedByKeyRef.current = true;
      shiftMonth(e.key === 'PageUp' ? -1 : 1);
    }
  };

  const dots = daysWithMeetings[viewKey];

  return (
    <div
      ref={popRef}
      className={styles.datePicker}
      role="dialog"
      aria-label={tx('dash.goToDate', 'Go to date')}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={styles.datePickerHead}>
        <span className={styles.datePickerTitle} aria-live="polite">{monthTitle}</span>
        <button
          type="button"
          className={styles.datePickerNav}
          onClick={() => shiftMonth(-1)}
          aria-label={tx('dash.prevMonth', 'Previous month')}
          title={tx('dash.prevMonth', 'Previous month')}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.datePickerNav}
          onClick={() => shiftMonth(1)}
          disabled={!canGoNext}
          aria-label={tx('dash.nextMonth', 'Next month')}
          title={tx('dash.nextMonth', 'Next month')}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.datePickerWeekdays} aria-hidden="true">
        {weekdays.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>

      <div ref={gridRef} className={styles.datePickerGrid} role="group" onKeyDown={onGridKeyDown}>
        {cells.map((day) => {
          const d = fromYmd(day);
          const outside = monthKey(d) !== viewKey;
          const future = day > today;
          const selected = day === value;
          const hasMeetings = !outside && !!dots?.has(day);
          const cls = [
            styles.datePickerDay,
            outside ? styles.datePickerDayOutside : '',
            day === today ? styles.datePickerDayToday : '',
            selected ? styles.datePickerDaySelected : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={day}
              type="button"
              data-day={day}
              className={cls}
              disabled={future}
              tabIndex={day === focusDay ? 0 : -1}
              aria-pressed={selected}
              aria-current={day === today ? 'date' : undefined}
              aria-label={fullDate.format(d)}
              onClick={() => onSelect(day)}
              onFocus={() => {
                if (day !== focusDay && !future) setFocusDay(day);
              }}
            >
              {d.getDate()}
              {hasMeetings && <span className={styles.datePickerDot} aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <div className={styles.datePickerFoot}>
        <button type="button" className={styles.datePickerToday} onClick={onToday}>
          {tx('dash.backToToday', 'Today')}
        </button>
      </div>
    </div>
  );
}
