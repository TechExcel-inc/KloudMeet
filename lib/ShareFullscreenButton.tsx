'use client';

import * as React from 'react';
import { useI18n } from './i18n';
import styles from '../styles/ShareFullscreenButton.module.css';

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };

function fullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function unlockOrientation() {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // not supported
  }
}

async function enterFullscreen() {
  const root = document.documentElement as FullscreenElement;
  try {
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else await root.webkitRequestFullscreen?.();
  } catch {
    return;
  }
  // Android turns to landscape this way even with auto-rotate off; elsewhere it stays as held
  try {
    await (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape');
  } catch {
    // not supported
  }
}

async function leaveFullscreen() {
  unlockOrientation();
  if (!fullscreenElement()) return;
  const doc = document as FullscreenDocument;
  try {
    if (doc.exitFullscreen) await doc.exitFullscreen();
    else await doc.webkitExitFullscreen?.();
  } catch {
    // already left
  }
}

/**
 * Phone, watching someone's screen: full screen and turned on its side, so the shared screen is
 * as large as the phone allows. Only where the browser lets a page go full screen (Android; an
 * iPhone browser doesn't, so there the phone is simply turned). Leaving the share leaves full screen.
 */
export function ShareFullscreenButton({ hidden }: { hidden: boolean }) {
  const { t } = useI18n();
  const [supported, setSupported] = React.useState(false);
  const [active, setActive] = React.useState(false);

  React.useEffect(() => {
    const doc = document as FullscreenDocument;
    setSupported(!!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled));
    const update = () => {
      const on = !!fullscreenElement();
      setActive(on);
      if (!on) unlockOrientation();
    };
    update();
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
      void leaveFullscreen();
    };
  }, []);

  if (!supported) return null;
  const label = active ? t('meeting.exitFullScreen') : t('meeting.fullScreen');
  return (
    <button
      type="button"
      className={`${styles.button} ${hidden ? styles.hidden : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        void (active ? leaveFullscreen() : enterFullscreen());
      }}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path
          d={
            active
              ? 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z'
              : 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'
          }
        />
      </svg>
    </button>
  );
}
