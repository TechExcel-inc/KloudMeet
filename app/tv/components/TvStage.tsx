'use client';

import React from 'react';
import styles from '@/styles/Tv.module.css';

const W = 1920;
const H = 1080;

/**
 * A 1920×1080 canvas scaled to the screen. TV browsers report anything from 960×540 to
 * 3840×2160 CSS pixels; designing once at 1080p keeps text sizes and the title-safe margins
 * right on all of them (letterboxed on odd aspect ratios).
 *
 * `layer`: a click-through overlay above everything (toasts, voice, dialogs).
 */
export function TvStage({ children, layer = false }: { children: React.ReactNode; layer?: boolean }) {
  const [scale, setScale] = React.useState(1);
  React.useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <div
      className={layer ? styles.stageLayer : styles.stageViewport}
      // The canvas never scrolls (focus or a stray scrollIntoView must not slide it away)
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0;
        e.currentTarget.scrollLeft = 0;
      }}
    >
      <div
        className={styles.stage}
        data-tv-canvas
        style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
