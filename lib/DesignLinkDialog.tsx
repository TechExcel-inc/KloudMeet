'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import { DESIGN_ALLOW_LOCAL_HTTP, parseDesignLink, type DesignLink, type DesignLinkError } from '@/lib/designLink';
import {
  forgetDesignLink,
  readRecentDesignLinks,
  type RecentDesignLink,
} from '@/lib/designLinkClient';
import { CloseGlyph, FigmaGlyph, GlobeGlyph } from '@/lib/DesignStage';
import styles from '@/styles/DesignStage.module.css';

interface DesignLinkDialogProps {
  /** Link currently shown, when changing it */
  currentUrl?: string;
  /** Refused as "this meeting site" */
  appOrigin: string;
  onSubmit: (link: DesignLink) => Promise<void> | void;
  onClose: () => void;
}

/** "Show a link": paste a Figma or web link that everyone in the meeting will view. */
export function DesignLinkDialog({ currentUrl, appOrigin, onSubmit, onClose }: DesignLinkDialogProps) {
  const { t } = useI18n();
  const tf = (key: string, fallback: string, params?: Record<string, string | number>) => {
    const value = t(key, params);
    if (value !== key) return value;
    return Object.entries(params ?? {}).reduce((text, [k, v]) => text.split(`{${k}}`).join(String(v)), fallback);
  };

  const [value, setValue] = React.useState(currentUrl ?? '');
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
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
    setBusy(true);
    setSubmitError('');
    try {
      await onSubmit(result.link);
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
    <p className={`${styles.status} ${styles.statusOk}`}>
      <span className={styles.kindTag}>{kindText(parsed.link)}</span>
      <span>{parsed.link.kind === 'figma' ? parsed.link.label : parsed.link.host}</span>
    </p>
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
                    <button type="button" className={styles.recentShow} onClick={() => void show(item.url)} disabled={busy}>
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
          <button type="button" className={styles.btnPrimary} onClick={() => void show(value)} disabled={!parsed.ok || busy}>
            {busy ? tf('design.showing', 'Showing…') : tf('design.showToEveryone', 'Show to everyone')}
          </button>
        </div>
      </div>
    </div>
  );
}
