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
import {
  DESIGN_STROKE_COLORS,
  designPageKey,
  isSameSiteHref,
  parseDesignPageMessage,
  toDocPoint,
  type DesignPageState,
} from '@/lib/designSync';
import type { DesignSync } from '@/lib/useDesignSync';
import styles from '@/styles/DesignStage.module.css';

const ZOOM_STEP = 0.1;
/** How long to wait for the page's sync script before treating it as "link only" */
const SYNC_DETECT_MS = 4000;
/** Scroll events this close to where we sent the page are ours, not the viewer's */
const SCROLL_MATCH_PX = 4;

type Tool = 'interact' | 'pen' | 'laser';

interface DesignStageProps {
  link: DesignLink;
  /** Who opened the link (shown as "Following …") */
  presenterName?: string;
  /** This participant drives what everyone sees (size, zoom, page, scroll) */
  isDriver: boolean;
  /** May change or stop the link, draw and use the laser (host, co-host, presenter) */
  canControl: boolean;
  sync: DesignSync;
  onChangeLink?: () => void;
  onStop?: () => void;
}

/**
 * Shows the meeting's Design-mode link. Everyone loads the link themselves.
 * Pages with the Kloud sync script (hosted designs) follow the presenter's page and scroll and
 * take annotations and the laser; other pages share only the link, frame size and zoom.
 */
export function DesignStage({ link, presenterName, isDriver, canControl, sync, onChangeLink, onStop }: DesignStageProps) {
  const { t } = useI18n();
  const tf = (key: string, fallback: string, params?: Record<string, string | number>) => {
    const value = t(key, params);
    if (value !== key) return value;
    return Object.entries(params ?? {}).reduce((text, [k, v]) => text.split(`{${k}}`).join(String(v)), fallback);
  };

  const canvasRef = React.useRef<HTMLDivElement>(null);
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const [stage, setStage] = React.useState({ width: 0, height: 0 });
  const [localZoom, setLocalZoom] = React.useState(1);
  const [following, setFollowing] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  const [noticeOpen, setNoticeOpen] = React.useState(false);
  /** The page the frame shows (changes when following the presenter to another page) */
  const [frameSrc, setFrameSrc] = React.useState(link.embedUrl);
  /** Reported by the page's sync script; null until it says hello */
  const [page, setPage] = React.useState<DesignPageState | null>(null);
  const [tool, setTool] = React.useState<Tool>('interact');
  const [color, setColor] = React.useState<string>(DESIGN_STROKE_COLORS[0]);

  const synced = page !== null;
  const frameOrigin = React.useMemo(() => {
    try {
      return new URL(link.embedUrl).origin;
    } catch {
      return '';
    }
  }, [link.embedUrl]);

  // A new link loads fresh and follows the presenter again.
  React.useEffect(() => {
    setFrameSrc(link.embedUrl);
    setPage(null);
    setLoaded(false);
    setFollowing(true);
    setLocalZoom(1);
    setTool('interact');
    setNoticeOpen(false);
    // Heavy pages (Figma) fire load late and some never do; after a moment let the page show
    // its own progress instead of covering it.
    const loadTimer = window.setTimeout(() => setLoaded(true), 6000);
    return () => window.clearTimeout(loadTimer);
  }, [link.embedUrl]);

  // Pages without the sync script: say once that only the link is shared.
  React.useEffect(() => {
    if (synced) {
      setNoticeOpen(false);
      return;
    }
    const open = window.setTimeout(() => setNoticeOpen(true), SYNC_DETECT_MS);
    const close = window.setTimeout(() => setNoticeOpen(false), SYNC_DETECT_MS + 8000);
    return () => {
      window.clearTimeout(open);
      window.clearTimeout(close);
    };
  }, [synced, link.embedUrl]);

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

  /* ── Talking to the page's sync script ── */
  const postToPage = React.useCallback(
    (msg: Record<string, unknown>) => {
      const win = frameRef.current?.contentWindow;
      if (win && frameOrigin) win.postMessage({ source: 'kloud-meet', ...msg }, frameOrigin);
    },
    [frameOrigin],
  );

  // Ask the page to introduce itself until it does: the script may load after our first ping,
  // and a tab in the background may miss it. Pages without the script just never answer.
  React.useEffect(() => {
    if (synced || link.kind !== 'web') return;
    let tries = 0;
    const ping = () => postToPage({ type: 'ping' });
    const timer = window.setInterval(() => {
      tries += 1;
      ping();
      if (tries === 10) {
        window.clearInterval(timer);
        slow = window.setInterval(ping, 3000);
      }
    }, 700);
    let slow: number | null = null;
    const onVisible = () => {
      if (document.visibilityState === 'visible') ping();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      if (slow !== null) window.clearInterval(slow);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [synced, link.kind, frameSrc, postToPage]);

  /** Where we last sent the page; scroll events that match are ours */
  const expectedScroll = React.useRef<{ href: string; x: number; y: number; until: number } | null>(null);
  const followingRef = React.useRef(following);
  followingRef.current = following;
  const isDriverRef = React.useRef(isDriver);
  isDriverRef.current = isDriver;
  const syncRef = React.useRef(sync);
  syncRef.current = sync;

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow || event.origin !== frameOrigin) return;
      const msg = parseDesignPageMessage(event.data);
      if (!msg || !isSameSiteHref(msg.href, link.url)) return;
      setPage((prev) =>
        msg.type === 'scroll'
          ? prev
            ? { ...prev, href: msg.href, scrollX: msg.scrollX, scrollY: msg.scrollY }
            : prev
          : { ...msg },
      );
      if (isDriverRef.current) {
        syncRef.current.reportScroll({ href: msg.href, x: msg.scrollX, y: msg.scrollY });
        return;
      }
      // A follower who scrolls or opens another page on their own stops following.
      const expected = expectedScroll.current;
      const ours =
        expected &&
        Date.now() < expected.until &&
        designPageKey(expected.href) === designPageKey(msg.href) &&
        Math.abs(expected.x - msg.scrollX) <= SCROLL_MATCH_PX &&
        Math.abs(expected.y - msg.scrollY) <= SCROLL_MATCH_PX;
      const firstLook = msg.type === 'hello' && expected && designPageKey(expected.href) === designPageKey(msg.href);
      if (!ours && !firstLook && msg.type !== 'size' && followingRef.current && expected) {
        setFollowing(false);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameOrigin, link.url]);

  /* ── Zoom / frame size ── */
  const ownViewport: DesignViewport | null =
    stage.width >= 200 && stage.height >= 150
      ? { zoom: localZoom, baseWidth: stage.width, baseHeight: stage.height }
      : null;
  const followingRemote = !isDriver && following && !!sync.remoteViewport;
  const viewport = followingRemote ? sync.remoteViewport : ownViewport;
  // Figma has its own pan and zoom inside the embed, so ours stays at 100%.
  const showZoom = link.kind === 'web';

  const reportViewport = sync.reportViewport;
  React.useEffect(() => {
    if (!isDriver || !ownViewport) return;
    reportViewport(ownViewport);
  }, [isDriver, ownViewport?.zoom, ownViewport?.baseWidth, ownViewport?.baseHeight, reportViewport]);

  /* ── Follow the presenter's page and scroll ── */
  const remoteScroll = sync.remoteScroll;
  React.useEffect(() => {
    if (isDriver || !following || !remoteScroll || !isSameSiteHref(remoteScroll.href, link.url)) return;
    expectedScroll.current = { href: remoteScroll.href, x: remoteScroll.x, y: remoteScroll.y, until: Date.now() + 1500 };
    if (page && designPageKey(page.href) !== designPageKey(remoteScroll.href)) {
      if (designPageKey(frameSrc) !== designPageKey(remoteScroll.href)) {
        setPage(null);
        setFrameSrc(remoteScroll.href);
      }
      return;
    }
    if (page) postToPage({ type: 'scrollTo', x: remoteScroll.x, y: remoteScroll.y });
  }, [isDriver, following, remoteScroll, page?.href, synced, link.url, frameSrc, postToPage]);
  // (page?.href and synced re-run this once the followed page has loaded and said hello)

  const currentZoom = viewport?.zoom ?? 1;
  const setZoom = (next: number) => {
    const zoom = clampDesignZoom(next);
    // Followers zooming on their own stop following until they come back.
    if (!isDriver) setFollowing(false);
    setLocalZoom(zoom);
  };
  const backToPresenter = () => {
    expectedScroll.current = null;
    setLocalZoom(1);
    setFollowing(true);
  };

  const layout = viewport ? designFrameLayout(viewport, stage.width, stage.height) : null;
  const presenter = presenterName || tf('design.presenter', 'the presenter');
  const sourceLabel = link.kind === 'figma' ? link.label : page?.title || link.host;
  const sourceHost = link.kind === 'figma' ? 'Figma' : page?.title ? link.host : '';

  /* ── Annotations and laser (synced pages only) ── */
  const pageKey = page ? designPageKey(page.href) : '';
  const canDraw = synced && canControl;
  const drawing = canDraw && tool !== 'interact';
  const activeStroke = React.useRef<string | null>(null);

  const docPoint = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const scale = layout?.scale ?? 1;
    return toDocPoint(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      { x: page?.scrollX ?? 0, y: page?.scrollY ?? 0 },
      scale,
    );
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing || !page) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = docPoint(e);
    if (tool === 'pen') activeStroke.current = sync.beginStroke(pageKey, color, p.x, p.y);
    else sync.moveLaser(pageKey, p.x, p.y);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing || !page) return;
    const p = docPoint(e);
    if (tool === 'pen' && activeStroke.current) sync.extendStroke(activeStroke.current, p.x, p.y);
    else if (tool === 'laser') sync.moveLaser(pageKey, p.x, p.y);
  };
  const onPointerUp = () => {
    if (activeStroke.current) {
      sync.endStroke(activeStroke.current);
      activeStroke.current = null;
    }
  };
  const onPointerLeave = () => {
    if (tool === 'laser') sync.hideLaser();
  };
  // While drawing, the wheel still scrolls the page underneath.
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!drawing) return;
    postToPage({ type: 'scrollBy', dx: e.deltaX / (layout?.scale ?? 1), dy: e.deltaY / (layout?.scale ?? 1) });
  };

  const pageStrokes = sync.strokes.filter((s) => s.page === pageKey);
  const pageLasers = Object.entries(sync.lasers).filter(([, l]) => l.page === pageKey);
  const scale = layout?.scale ?? 1;
  const scrollX = page?.scrollX ?? 0;
  const scrollY = page?.scrollY ?? 0;

  return (
    <div className={styles.stage}>
      <div ref={canvasRef} className={styles.canvas}>
        {layout && (
          <div className={styles.box} style={{ width: layout.boxWidth, height: layout.boxHeight }}>
            <iframe
              ref={frameRef}
              key={frameSrc}
              src={frameSrc}
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
            {synced && (pageStrokes.length > 0 || pageLasers.length > 0 || drawing) && (
              <div
                className={`${styles.ink}${drawing ? ` ${styles.inkActive}` : ''}${tool === 'laser' ? ` ${styles.inkLaser}` : ''}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={onPointerLeave}
                onWheel={onWheel}
              >
                <svg className={styles.inkSvg} width={layout.boxWidth} height={layout.boxHeight} aria-hidden="true">
                  <g transform={`scale(${scale}) translate(${-scrollX} ${-scrollY})`}>
                    {pageStrokes.map((s) => (
                      <polyline
                        key={s.id}
                        points={s.points.join(' ')}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={3 / scale}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                  </g>
                </svg>
                {pageLasers.map(([id, l]) => (
                  <span
                    key={id}
                    className={styles.laser}
                    style={{ left: (l.x - scrollX) * scale, top: (l.y - scrollY) * scale }}
                  >
                    {l.name && <span className={styles.laserName}>{l.name}</span>}
                  </span>
                ))}
              </div>
            )}
            {!loaded && (
              <div className={styles.loading}>
                <span className={styles.spinner} aria-hidden="true" />
                {tf('design.loading', 'Loading {name}…', { name: sourceLabel })}
              </div>
            )}
          </div>
        )}
      </div>

      {canDraw && (
        <div className={`${styles.rail} ${styles.hideNarrow}`} role="toolbar" aria-label={tf('design.tools', 'Annotation tools')}>
          {(
            [
              ['interact', tf('design.toolInteract', 'Interact with the page'), <CursorGlyph key="i" />],
              ['pen', tf('design.toolPen', 'Draw'), <PenGlyph key="p" />],
              ['laser', tf('design.toolLaser', 'Laser pointer'), <LaserGlyph key="l" />],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              className={tool === value ? styles.railBtnOn : styles.railBtn}
              aria-pressed={tool === value}
              aria-label={label}
              title={label}
              onClick={() => {
                if (tool === 'laser' && value !== 'laser') sync.hideLaser();
                setTool(value);
              }}
            >
              {icon}
            </button>
          ))}
          {tool === 'pen' &&
            DESIGN_STROKE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={styles.railSwatch}
                style={{ background: c, boxShadow: color === c ? `0 0 0 2px var(--km-panel), 0 0 0 4px ${c}` : undefined }}
                aria-pressed={color === c}
                aria-label={tf('design.color', 'Colour')}
                onClick={() => setColor(c)}
              />
            ))}
          <span className={styles.railSep} aria-hidden="true" />
          <button
            type="button"
            className={styles.railBtn}
            onClick={() => sync.clearPage(pageKey)}
            disabled={pageStrokes.length === 0}
            aria-label={tf('design.clear', 'Clear drawings on this page')}
            title={tf('design.clear', 'Clear drawings on this page')}
          >
            <EraserGlyph />
          </button>
        </div>
      )}

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
        {synced ? (
          <span
            className={`${styles.chip} ${styles.chipSynced} ${styles.hideNarrow}`}
            title={tf('design.syncedHint', 'Page, scrolling, drawings and the laser follow the presenter.')}
          >
            <SyncGlyph />
            {tf('design.synced', 'Synced')}
          </span>
        ) : (
          <span
            className={`${styles.chip} ${styles.hideNarrow}`}
            title={tf('design.linkOnlyHint', 'Everyone sees this link. Scrolling and clicks inside stay on each screen.')}
          >
            <LinkGlyph />
            {tf('design.linkOnly', 'Link only')}
          </span>
        )}
        {!isDriver && (synced || showZoom) && (
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
          href={page?.href || link.url}
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

function SyncGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8 8 0 00-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0014.3 4.9L20 16M20 20v-4h-4" />
    </svg>
  );
}

function CursorGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 3l14 7-6 2-2 6z" />
    </svg>
  );
}

function PenGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20l4-1 11-11-3-3L5 16z" />
    </svg>
  );
}

function LaserGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  );
}

function EraserGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 20h12M5 15l8-8 5 5-8 8H8z" />
    </svg>
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
