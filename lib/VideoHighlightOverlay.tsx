'use client';

import React from 'react';
import styles from '../styles/VideoHighlightOverlay.module.css';

export type VideoHighlightRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type VideoHighlightOverlayProps = {
  highlights: VideoHighlightRect[];
  enabled: boolean;
  canEdit: boolean;
  excludeRightPx?: number;
  onAdd: (highlight: VideoHighlightRect) => void;
  onRemove: (id: string) => void;
};

type Point = { x: number; y: number };

type DraftRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_HIGHLIGHT_SIZE = 0.008;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function nextHighlightId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `highlight-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function VideoHighlightOverlay({
  highlights,
  enabled,
  canEdit,
  excludeRightPx = 0,
  onAdd,
  onRemove,
}: VideoHighlightOverlayProps) {
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const startPointRef = React.useRef<Point | null>(null);
  const [draftRect, setDraftRect] = React.useState<DraftRect | null>(null);

  const toNormalizedPoint = React.useCallback((event: MouseEvent | React.MouseEvent): Point | null => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    return { x, y };
  }, []);

  React.useEffect(() => {
    if (!enabled || !canEdit) {
      startPointRef.current = null;
      setDraftRect(null);
    }
  }, [enabled, canEdit]);

  React.useEffect(() => {
    if (!startPointRef.current) return;

    const handleMouseMove = (event: MouseEvent) => {
      const start = startPointRef.current;
      if (!start) return;
      const point = toNormalizedPoint(event);
      if (!point) return;

      const x = Math.min(start.x, point.x);
      const y = Math.min(start.y, point.y);
      const width = Math.abs(point.x - start.x);
      const height = Math.abs(point.y - start.y);

      setDraftRect({ x, y, width, height });
    };

    const handleMouseUp = (event: MouseEvent) => {
      const start = startPointRef.current;
      startPointRef.current = null;

      if (!start) return;
      const point = toNormalizedPoint(event);
      if (!point) {
        setDraftRect(null);
        return;
      }

      const x = Math.min(start.x, point.x);
      const y = Math.min(start.y, point.y);
      const width = Math.abs(point.x - start.x);
      const height = Math.abs(point.y - start.y);

      if (width >= MIN_HIGHLIGHT_SIZE && height >= MIN_HIGHLIGHT_SIZE) {
        onAdd({
          id: nextHighlightId(),
          x,
          y,
          width,
          height,
        });
      }
      setDraftRect(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [toNormalizedPoint, onAdd, enabled, canEdit]);

  const handleMouseDown = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!enabled || !canEdit) return;
      const target = event.target as HTMLElement;
      const existingId = target.closest('[data-highlight-id]')?.getAttribute('data-highlight-id');
      if (existingId) {
        onRemove(existingId);
        return;
      }
      const point = toNormalizedPoint(event);
      if (!point) return;
      startPointRef.current = point;
      setDraftRect({ x: point.x, y: point.y, width: 0, height: 0 });
    },
    [enabled, canEdit, onRemove, toNormalizedPoint],
  );

  return (
    <div
      ref={overlayRef}
      className={`${styles.overlay} ${enabled ? styles.enabled : ''}`}
      onMouseDown={handleMouseDown}
      aria-hidden={!enabled}
      style={{ right: `${Math.max(0, excludeRightPx)}px` }}
    >
      {highlights.map((item) => (
        <div
          key={item.id}
          data-highlight-id={item.id}
          className={styles.highlightRect}
          style={{
            left: `${item.x * 100}%`,
            top: `${item.y * 100}%`,
            width: `${item.width * 100}%`,
            height: `${item.height * 100}%`,
          }}
        />
      ))}
      {draftRect && (
        <div
          className={styles.draftRect}
          style={{
            left: `${draftRect.x * 100}%`,
            top: `${draftRect.y * 100}%`,
            width: `${draftRect.width * 100}%`,
            height: `${draftRect.height * 100}%`,
          }}
        />
      )}
    </div>
  );
}
