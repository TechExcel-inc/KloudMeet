'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import {
  DESIGN_ZOOM_MAX,
  DESIGN_ZOOM_MIN,
  clampDesignZoom,
  designFrameLayout,
  type DesignLink,
  type DesignViewport,
} from '@/lib/designLink';
import styles from '@/styles/DesignStage.module.css';

const ZOOM_STEP = 0.1;

interface DesignStageProps {
  link: DesignLink;
  /** Who opened the link (shown as "Following …") */
  presenterName?: string;
  /** This participant drives zoom/size for everyone */
  isDriver: boolean;
  /** May change or stop the link (host, co-host, presenter) */
  canControl: boolean;
  /** Latest viewport from the driver (followers only) */
  remoteViewport: DesignViewport | null;
  /** Driver: called when its viewport changes */
  onViewportChange?: (viewport: DesignViewport) => void;
  onChangeLink?: () => void;
  onStop?: () => void;
}

/** Shows the meeting's Design-mode link. Everyone loads the link themselves; only the link,
 *  the frame size and the zoom are shared (scrolling and clicks inside stay on each screen). */
export function DesignStage({
  link,
  presenterName,
  isDriver,
  canControl,
  remoteViewport,
  onViewportChange,
  onChangeLink,
  onStop,
}: DesignStageProps) {
  const { t } = useI18n();
  const tf = (key: string, fallback: string, params?: Record<string, string | number>) => {
    const value = t(key, params);
    if (value !== key) return value;
    return Object.entries(params ?? {}).reduce((text, [k, v]) => text.split(`{${k}}`).join(String(v)), fallback);
  };

  const canvasRef = React.useRef<HTMLDivElement>(null);
  const [stage, setStage] = React.useState({ width: 0, height: 0 });
  const [localZoom, setLocalZoom] = React.useState(1);
  const [following, setFollowing] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  const [noticeOpen, setNoticeOpen] = React.useState(true);

  // A new link loads fresh, follows the presenter again and shows the notice once more.
  React.useEffect(() => {
    setLoaded(false);
    setFollowing(true);
    setLocalZoom(1);
    setNoticeOpen(true);
    const timer = window.setTimeout(() => setNoticeOpen(false), 8000);
    return () => window.clearTimeout(timer);
  }, [link.embedUrl]);

  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const style = window.getComputedStyle(el);
      const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      setStage({ width: Math.max(0, Math.round(width)), height: Math.max(0, Math.round(height)) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ownViewport: DesignViewport | null =
    stage.width >= 200 && stage.height >= 150
      ? { zoom: localZoom, baseWidth: stage.width, baseHeight: stage.height }
      : null;
  const followingRemote = !isDriver && following && !!remoteViewport;
  const viewport = followingRemote ? remoteViewport : ownViewport;
  // Figma has its own pan and zoom inside the embed, so ours stays at 100%.
  const showZoom = link.kind === 'web';

  // The driver tells everyone its frame size and zoom (the parent throttles and repeats it).
  const reportRef = React.useRef(onViewportChange);
  reportRef.current = onViewportChange;
  React.useEffect(() => {
    if (!isDriver || !ownViewport) return;
    reportRef.current?.(ownViewport);
  }, [isDriver, ownViewport?.zoom, ownViewport?.baseWidth, ownViewport?.baseHeight]);

  const currentZoom = viewport?.zoom ?? 1;
  const setZoom = (next: number) => {
    const zoom = clampDesignZoom(next);
    // Followers zooming on their own stop following until they come back.
    if (!isDriver) setFollowing(false);
    setLocalZoom(zoom);
  };
  const backToPresenter = () => {
    setFollowing(true);
    setLocalZoom(1);
  };

  const layout = viewport ? designFrameLayout(viewport, stage.width, stage.height) : null;
  const presenter = presenterName || tf('design.presenter', 'the presenter');
  const sourceLabel = link.kind === 'figma' ? link.label : link.host;
  const sourceHost = link.kind === 'figma' ? 'Figma' : '';

  return (
    <div className={styles.stage}>
      <div ref={canvasRef} className={styles.canvas}>
        {layout && (
          <div className={styles.box} style={{ width: layout.boxWidth, height: layout.boxHeight }}>
            <iframe
              key={link.embedUrl}
              src={link.embedUrl}
              title={sourceLabel}
              className={styles.frame}
              style={{
                width: layout.frameWidth,
                height: layout.frameHeight,
                transform: `scale(${layout.scale})`,
              }}
              // The page gets its own origin (never this app's: same-site links are refused),
              // can't navigate the meeting away, and opens its own links in new tabs.
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-storage-access-by-user-activation"
              allow="fullscreen; clipboard-write"
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => setLoaded(true)}
            />
            {!loaded && (
              <div className={styles.loading}>
                <span className={styles.spinner} aria-hidden="true" />
                {tf('design.loading', 'Loading {name}…', { name: sourceLabel })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={`${styles.bar}${!isDriver && !following ? ` ${styles.barFree}` : ''}`}>
        <span className={styles.source} title={link.url}>
          <span className={styles.sourceIcon} aria-hidden="true">
            {link.kind === 'figma' ? <FigmaGlyph /> : <GlobeGlyph />}
          </span>
          <span className={styles.sourceText}>
            {sourceLabel}
            {sourceHost && <span className={styles.sourceHost}> · {sourceHost}</span>}
          </span>
        </span>
        <span
          className={`${styles.chip} ${styles.hideNarrow}`}
          title={tf('design.linkOnlyHint', 'Everyone sees this link. Scrolling and clicks inside stay on each screen.')}
        >
          <LinkGlyph />
          {tf('design.linkOnly', 'Link only')}
        </span>
        {!isDriver && showZoom && (
          following ? (
            <span className={`${styles.follow} ${styles.hideNarrow}`}>
              <span className={styles.followDot} aria-hidden="true" />
              {tf('design.following', 'Following {name}', { name: presenter })}
            </span>
          ) : (
            <button type="button" className={styles.btnPrimary} onClick={backToPresenter}>
              {tf('design.backToPresenter', 'Back to {name}', { name: presenter })}
            </button>
          )
        )}
        <span className={styles.sep} aria-hidden="true" />
        <a
          className={styles.iconBtn}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={tf('design.openInNewTab', 'Open in a new tab')}
          title={tf('design.openInNewTab', 'Open in a new tab')}
        >
          <ExternalGlyph />
        </a>
        {canControl && onChangeLink && (
          <button type="button" className={`${styles.btn} ${styles.hideNarrow}`} onClick={onChangeLink}>
            {tf('design.changeLink', 'Change link')}
          </button>
        )}
        {canControl && onStop && (
          <button type="button" className={styles.btnDanger} onClick={onStop}>
            {tf('design.stop', 'Stop')}
          </button>
        )}
      </div>

      {showZoom && (
        <div className={styles.zoom} role="group" aria-label={tf('design.zoom', 'Zoom')}>
          <button
            type="button"
            className={styles.zoomBtn}
            onClick={() => setZoom(currentZoom - ZOOM_STEP)}
            disabled={currentZoom <= DESIGN_ZOOM_MIN}
            aria-label={tf('design.zoomOut', 'Zoom out')}
          >
            −
          </button>
          <button
            type="button"
            className={styles.zoomBtn}
            onClick={() => setZoom(1)}
            title={tf('design.zoomReset', 'Reset to 100%')}
          >
            {Math.round(currentZoom * 100)}%
          </button>
          <button
            type="button"
            className={styles.zoomBtn}
            onClick={() => setZoom(currentZoom + ZOOM_STEP)}
            disabled={currentZoom >= DESIGN_ZOOM_MAX}
            aria-label={tf('design.zoomIn', 'Zoom in')}
          >
            +
          </button>
        </div>
      )}

      {noticeOpen && (
        <div className={styles.notice} role="status">
          <InfoGlyph />
          <span>
            {tf(
              'design.linkOnlyNotice',
              'This page syncs the link only — scrolling and clicks inside stay on each person’s screen.',
            )}
          </span>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => setNoticeOpen(false)}
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <CloseGlyph />
          </button>
        </div>
      )}
    </div>
  );
}

export function FigmaGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.5} viewBox="0 0 38 57" aria-hidden="true">
      <path fill="#1abcfe" d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" />
      <path fill="#0acf83" d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z" />
      <path fill="#ff7262" d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z" />
      <path fill="#f24e1e" d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z" />
      <path fill="#a259ff" d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z" />
    </svg>
  );
}

export function GlobeGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 014 9 14 14 0 01-4 9 14 14 0 01-4-9 14 14 0 014-9z" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
    </svg>
  );
}

function ExternalGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
    </svg>
  );
}

function InfoGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

export function CloseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
