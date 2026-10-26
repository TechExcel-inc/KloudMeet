'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import { DESIGN_ALLOW_LOCAL_HTTP, parseDesignLink, type DesignLink, type DesignLinkError } from '@/lib/designLink';
import type { DesignEmbedCheck } from '@/lib/designEmbed';
import {
  forgetDesignLink,
  readRecentDesignLinks,
  type RecentDesignLink,
} from '@/lib/designLinkClient';
import { BlockedGlyph, CloseGlyph, FigmaGlyph, GlobeGlyph } from '@/lib/DesignStage';
import styles from '@/styles/DesignStage.module.css';

interface DesignLinkDialogProps {
  /** Link currently shown, when changing it */
  currentUrl?: string;
  /** Refused as "this meeting site" */
  appOrigin: string;
  /** `check`: what the embed check found for a web link, when it ran */
  onSubmit: (link: DesignLink, check?: DesignEmbedCheck) => Promise<void> | void;
  onClose: () => void;
  /** Asks whether a web link's site allows being shown in a frame (never rejects) */
  checkEmbed?: (url: string) => Promise<DesignEmbedCheck>;
}

/** Wait this long after typing stops before checking a site */
const CHECK_DEBOUNCE_MS = 400;
/** Sharing doesn't wait longer than this for a check */
const CHECK_WAIT_MS = 5000;

/** "Show a link": paste a Figma or web link that everyone in the meeting will view. */
export function DesignLinkDialog({ currentUrl, appOrigin, onSubmit, onClose, checkEmbed }: DesignLinkDialogProps) {
  const { t } = useI18n();
  const tf = (key: string, fallback: string, params?: Record<string, string | number>) => {
    const value = t(key, params);
    if (value !== key) return value;
    return Object.entries(params ?? {}).reduce((text, [k, v]) => text.split(`{${k}}`).join(String(v)), fallback);
  };

  const [value, setValue] = React.useState(currentUrl ?? '');
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState<false | 'checking' | 'showing'>(false);
  const [submitError, setSubmitError] = React.useState('');
  const [recent, setRecent] = React.useState<RecentDesignLink[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setRecent(readRecentDesignLinks());
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parsed = parseDesignLink(value, { appOrigin, allowLocalHttp: DESIGN_ALLOW_LOCAL_HTTP });

  /* ── Can the site be shown in a frame? Checked as soon as a web link is pasted ── */
  const [checks, setChecks] = React.useState<Record<string, DesignEmbedCheck | 'checking'>>({});
  const inflight = React.useRef(new Map<string, Promise<DesignEmbedCheck>>());
  const runCheck = React.useCallback(
    (url: string): Promise<DesignEmbedCheck> => {
      const running = inflight.current.get(url);
      if (running) return running;
      const promise = (checkEmbed ? checkEmbed(url) : Promise.resolve<DesignEmbedCheck>({ embed: 'unknown' })).catch(
        (): DesignEmbedCheck => ({ embed: 'unknown' }),
      );
      inflight.current.set(url, promise);
      setChecks((prev) => ({ ...prev, [url]: 'checking' }));
      void promise.then((result) => setChecks((prev) => ({ ...prev, [url]: result })));
      return promise;
    },
    [checkEmbed],
  );
  const checkUrl = parsed.ok && parsed.link.kind === 'web' && checkEmbed ? parsed.link.url : null;
  React.useEffect(() => {
    if (!checkUrl || inflight.current.has(checkUrl)) return;
    const timer = window.setTimeout(() => void runCheck(checkUrl), CHECK_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [checkUrl, runCheck]);
  const check = checkUrl ? checks[checkUrl] : undefined;
  const blockedShown = check !== undefined && check !== 'checking' && check.embed === 'blocked' ? checkUrl : null;
  /** Sharing a blocked site takes a second click, after the warning has been seen */
  const blockedShownRef = React.useRef<string | null>(null);
  blockedShownRef.current = blockedShown;
  const errorText = (error: DesignLinkError): string => {
    switch (error) {
      case 'empty':
        return '';
      case 'notHttps':
        return tf('design.errorNotHttps', 'Use an https:// link.');
      case 'sameSite':
        return tf('design.errorSameSite', 'Links to this meeting site can’t be shown here.');
      case 'privateHost':
        return tf('design.errorPrivate', 'This address only works on your own network, so others can’t open it.');
      case 'tooLong':
        return tf('design.errorTooLong', 'This link is too long.');
      default:
        return tf('design.errorInvalid', 'This doesn’t look like a web link.');
    }
  };

  const show = async (input: string) => {
    const result = parseDesignLink(input, { appOrigin, allowLocalHttp: DESIGN_ALLOW_LOCAL_HTTP });
    setTouched(true);
    if (!result.ok || busy) return;
    setSubmitError('');
    let found: DesignEmbedCheck | undefined;
    if (result.link.kind === 'web' && checkEmbed) {
      setBusy('checking');
      found = await Promise.race([
        runCheck(result.link.url),
        new Promise<DesignEmbedCheck>((resolve) => window.setTimeout(() => resolve({ embed: 'unknown' }), CHECK_WAIT_MS)),
      ]);
      if (found.embed === 'blocked' && blockedShownRef.current !== result.link.url) {
        // Show the warning first (a recent link may not be in the box yet)
        setValue(input);
        setBusy(false);
        return;
      }
    }
    setBusy('showing');
    try {
      await onSubmit(result.link, found);
    } catch {
      setSubmitError(tf('design.errorSave', 'Couldn’t show this link. Check your connection and try again.'));
      setBusy(false);
    }
  };

  const kindText = (link: DesignLink) =>
    link.kind === 'figma'
      ? link.figmaType === 'proto'
        ? tf('design.kindFigmaProto', 'Figma prototype')
        : link.figmaType === 'board'
          ? tf('design.kindFigmaBoard', 'FigJam board')
          : link.figmaType === 'slides' || link.figmaType === 'deck'
            ? tf('design.kindFigmaSlides', 'Figma slides')
            : tf('design.kindFigmaDesign', 'Figma design')
      : tf('design.kindWeb', 'Web page');

  const status = parsed.ok ? (
    blockedShown ? (
      <div className={styles.warn} role="alert">
        <BlockedGlyph size={18} />
        <span className={styles.warnText}>
          <strong>{tf('design.blockedWarnTitle', '{host} doesn’t allow embedding', { host: parsed.link.host })}</strong>
          <span>
            {tf(
              'design.blockedWarnBody',
              'The site can’t appear on the stage. Everyone will see a card with “Open in new tab” instead.',
            )}
          </span>
        </span>
      </div>
    ) : (
      <p className={`${styles.status} ${styles.statusOk}`}>
        <span className={styles.kindTag}>{kindText(parsed.link)}</span>
        <span className={styles.statusHost}>{parsed.link.kind === 'figma' ? parsed.link.label : parsed.link.host}</span>
        {check === 'checking' && (
          <span className={styles.checking}>
            <span className={styles.spinnerSm} aria-hidden="true" />
            {tf('design.checking', 'Checking the site…')}
          </span>
        )}
      </p>
    )
  ) : (
    <p className={`${styles.status}${touched || value.trim() ? ` ${styles.statusError}` : ''}`} role={touched ? 'alert' : undefined}>
      {touched || value.trim() ? errorText(parsed.error) : ''}
    </p>
  );

  return (
    <div className={styles.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="km-design-dialog-title">
        <div className={styles.dialogHead}>
          <h2 id="km-design-dialog-title" className={styles.dialogTitle}>
            {currentUrl ? tf('design.changeTitle', 'Show a different link') : tf('design.openTitle', 'Show a link')}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('common.close')} title={t('common.close')}>
            <CloseGlyph />
          </button>
        </div>

        <form
          className={styles.dialogBody}
          onSubmit={(e) => {
            e.preventDefault();
            void show(value);
          }}
        >
          <div className={styles.inputRow}>
            <input
              ref={inputRef}
              type="url"
              inputMode="url"
              className={`${styles.input}${touched && !parsed.ok ? ` ${styles.inputError}` : ''}`}
              placeholder={tf('design.placeholder', 'Paste a Figma or web link (https://…)')}
              aria-label={tf('design.openTitle', 'Show a link')}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setSubmitError('');
              }}
              onBlur={() => value.trim() && setTouched(true)}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          {submitError ? <p className={`${styles.status} ${styles.statusError}`} role="alert">{submitError}</p> : status}

          <p className={styles.tip}>
            <FigmaGlyph size={11} />
            <span>
              {tf(
                'design.figmaTip',
                'Figma: share the file as “Anyone with the link can view” so guests can see it without a Figma account.',
              )}
            </span>
          </p>
          <p className={styles.tip}>
            <GlobeGlyph size={13} />
            <span>
              {tf(
                'design.linkOnlyTip',
                'Everyone opens this link on their own device. Only the link and zoom are shared — scrolling and clicks inside stay on each screen. Some sites don’t allow being shown inside other pages.',
              )}
            </span>
          </p>

          {recent.length > 0 && (
            <>
              <p className={styles.label}>{tf('design.recent', 'Recent')}</p>
              <div className={styles.recent}>
                {recent.map((item) => (
                  <div key={item.url} className={styles.recentItem}>
                    <span aria-hidden="true">{item.kind === 'figma' ? <FigmaGlyph size={11} /> : <GlobeGlyph size={14} />}</span>
                    <span className={styles.recentText}>
                      <span className={styles.recentLabel}>{item.label}</span>
                      <span className={styles.recentUrl}>{item.url}</span>
                    </span>
                    <button type="button" className={styles.recentShow} onClick={() => void show(item.url)} disabled={!!busy}>
                      {tf('design.show', 'Show')}
                    </button>
                    <button
                      type="button"
                      className={styles.recentRemove}
                      onClick={() => setRecent(forgetDesignLink(item.url))}
                      aria-label={tf('design.removeRecent', 'Remove from recent')}
                      title={tf('design.removeRecent', 'Remove from recent')}
                    >
                      <CloseGlyph />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </form>

        <div className={styles.dialogFoot}>
          <span className={styles.status}>{tf('design.everyoneSees', 'Everyone in the meeting will see it.')}</span>
          <span className={styles.footSpacer} />
          <button type="button" className={styles.btn} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className={styles.btnPrimary} onClick={() => void show(value)} disabled={!parsed.ok || !!busy}>
            {busy === 'checking'
              ? tf('design.checkingShort', 'Checking…')
              : busy
                ? tf('design.showing', 'Showing…')
                : blockedShown
                  ? tf('design.shareAnyway', 'Share link anyway')
                  : tf('design.showToEveryone', 'Show to everyone')}
          </button>
        </div>
      </div>
    </div>
  );
}
