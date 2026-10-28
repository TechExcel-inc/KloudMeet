'use client';

/**
 * Captions settings: the host's switch for the whole meeting, then each person's own choices
 * (captions on my screen, the language I speak, the language I read captions in).
 * Every change applies at once; there is nothing to confirm.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../styles/CaptionSettingsDialog.module.css';
import { useI18n } from '../i18n';
import {
  CAPTION_LANGUAGES,
  CAPTION_SETTINGS_EVENT,
  captionLanguageFor,
  loadCaptionSettings,
  nativeLanguageName,
  saveCaptionSettings,
  type CaptionLanguage,
  type CaptionSettings,
} from './captionLanguage';

interface CaptionSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Host / co-host: show the switch for everyone. */
  canToggleCaptions?: boolean;
  /** Captions are running in this meeting. */
  captionsEnabled?: boolean;
  onToggleCaptions?: () => void;
  /** Reading languages in the meeting, mine included. */
  roomLanguages?: CaptionLanguage[];
}

/** How long the host switch waits for the meeting to confirm before showing the real state again. */
const TOGGLE_PENDING_MS = 6000;

type MenuId = 'speak' | 'read';

export function CaptionSettingsDialog({
  isOpen,
  onClose,
  canToggleCaptions = false,
  captionsEnabled = false,
  onToggleCaptions,
  roomLanguages = [],
}: CaptionSettingsDialogProps) {
  const { t, locale } = useI18n();
  const uiLanguage = captionLanguageFor(locale);
  const [settings, setSettings] = useState<CaptionSettings>(() => loadCaptionSettings(uiLanguage));
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [pendingOn, setPendingOn] = useState<boolean | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Fresh settings each time it opens, and follow changes made elsewhere (the caption bar's menu).
  useEffect(() => {
    if (!isOpen) return;
    const sync = () => setSettings(loadCaptionSettings(uiLanguage));
    sync();
    window.addEventListener(CAPTION_SETTINGS_EVENT, sync);
    return () => window.removeEventListener(CAPTION_SETTINGS_EVENT, sync);
  }, [isOpen, uiLanguage]);

  // Focus moves into the dialog and back to where it was; the page behind doesn't scroll.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setOpenMenu(null);
  }, [isOpen]);

  // The meeting confirmed the host's switch (or it's time to stop waiting).
  useEffect(() => {
    setPendingOn(null);
  }, [captionsEnabled]);
  useEffect(() => {
    if (pendingOn === null) return;
    const timer = setTimeout(() => setPendingOn(null), TOGGLE_PENDING_MS);
    return () => clearTimeout(timer);
  }, [pendingOn]);

  const change = useCallback((patch: Partial<CaptionSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    saveCaptionSettings(patch);
  }, []);

  if (!isOpen) return null;

  const meetingOn = pendingOn ?? captionsEnabled;
  const toggleMeeting = () => {
    if (pendingOn !== null || !onToggleCaptions) return;
    setPendingOn(!captionsEnabled);
    onToggleCaptions();
  };
  const readInMeeting =
    roomLanguages.length > 0
      ? `${t('captions.inMeeting')}: ${roomLanguages.map((l) => nativeLanguageName(l)).join(' · ')}`
      : '';

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="caption-settings-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.stopPropagation();
          if (openMenu) setOpenMenu(null);
          else onClose();
        }}
      >
        <div className={styles.handle} aria-hidden="true" />
        <div className={styles.header}>
          <h2 id="caption-settings-title" className={styles.title}>
            {t('captions.settings.title')}
          </h2>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t('captions.settings.close')}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {canToggleCaptions ? (
          <section className={styles.section} aria-labelledby="caption-settings-meeting">
            <h3 id="caption-settings-meeting" className={styles.sectionLabel}>
              {t('captions.settings.thisMeeting')}
            </h3>
            <div className={styles.meetingCard}>
              <div className={styles.meetingRow}>
                <svg className={styles.meetingIcon} viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2.5" y="5" width="19" height="14" rx="3" />
                  <path d="M10.5 10.2a2.4 2.4 0 1 0 0 3.6M17 10.2a2.4 2.4 0 1 0 0 3.6" />
                </svg>
                <div className={styles.rowText}>
                  <span id="caption-settings-everyone" className={styles.rowTitle}>
                    {t('captions.settings.forEveryone')}
                  </span>
                  <span className={styles.rowHint}>{t('captions.settings.forEveryoneHint')}</span>
                </div>
                <Switch
                  checked={meetingOn}
                  labelledBy="caption-settings-everyone"
                  disabled={pendingOn !== null || !onToggleCaptions}
                  onChange={toggleMeeting}
                />
              </div>
              {captionsEnabled && (
                <div className={styles.meetingStatus} role="status">
                  <span className={styles.liveDot} aria-hidden="true" />
                  <span className={styles.statusStrong}>{t('captions.settings.on')}</span>
                  {readInMeeting && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{readInMeeting}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>
        ) : (
          captionsEnabled && (
            <div className={styles.section}>
              <div className={styles.notice} role="status">
                <span className={styles.liveDot} aria-hidden="true" />
                <span>{t('captions.settings.attendeeNotice')}</span>
              </div>
            </div>
          )
        )}

        <section className={`${styles.section} ${styles.personalList}`} aria-labelledby="caption-settings-mine">
          <h3 id="caption-settings-mine" className={styles.sectionLabel}>
            {t('captions.settings.justForMe')}
          </h3>

          <div className={styles.row}>
            <div className={styles.rowText}>
              <span id="caption-settings-visible" className={styles.rowTitle}>
                {t('captions.settings.showOnScreen')}
              </span>
              <span className={styles.rowHint}>{t('captions.settings.showOnScreenHint')}</span>
            </div>
            <Switch
              checked={settings.subtitleVisible}
              labelledBy="caption-settings-visible"
              onChange={() => change({ subtitleVisible: !settings.subtitleVisible })}
            />
          </div>

          <div className={`${styles.row} ${styles.stackOnPhone}`}>
            <div className={styles.rowText}>
              <span id="caption-settings-speak" className={styles.rowTitle}>
                {t('captions.settings.speak')}
              </span>
              <span className={styles.rowHint}>{t('captions.settings.speakHint')}</span>
            </div>
            <LanguageSelect
              labelId="caption-settings-speak"
              value={settings.speakLanguage}
              open={openMenu === 'speak'}
              onOpenChange={(open) => setOpenMenu(open ? 'speak' : null)}
              onChange={(lang) => change({ speakLanguage: lang })}
            />
          </div>

          <div className={`${styles.row} ${styles.stackOnPhone}`}>
            <div className={styles.rowText}>
              <span id="caption-settings-read" className={styles.rowTitle}>
                {t('captions.langMenuTitle')}
              </span>
              <span className={styles.rowHint}>{t('captions.settings.readHint')}</span>
            </div>
            <LanguageSelect
              labelId="caption-settings-read"
              value={settings.readLanguage}
              open={openMenu === 'read'}
              onOpenChange={(open) => setOpenMenu(open ? 'read' : null)}
              onChange={(lang) => change({ readLanguage: lang })}
              note={readInMeeting}
              openUp
            />
          </div>
        </section>

        <div className={styles.footer}>
          <button type="button" className={styles.done} onClick={onClose}>
            {t('captions.settings.done')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Switch({
  checked,
  labelledBy,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  labelledBy: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      className={styles.switch}
      disabled={disabled}
      onClick={onChange}
    >
      <span className={styles.track}>
        <span className={styles.thumb} />
      </span>
    </button>
  );
}

function LanguageSelect({
  labelId,
  value,
  open,
  onOpenChange,
  onChange,
  note,
  openUp = false,
}: {
  labelId: string;
  value: CaptionLanguage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (lang: CaptionLanguage) => void;
  /** A line under the options. */
  note?: string;
  /** Open above the button (the last row, so the menu doesn't cover the footer). */
  openUp?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = `${labelId}-menu`;

  // Opening puts focus on the chosen language; a click anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    optionRefs.current[CAPTION_LANGUAGES.indexOf(value)]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // Only when it opens: moving between options must not jump back to the chosen one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    onOpenChange(false);
    buttonRef.current?.focus();
  };

  const onOptionKey = (e: React.KeyboardEvent, index: number) => {
    const last = CAPTION_LANGUAGES.length - 1;
    const focusAt = (i: number) => optionRefs.current[i]?.focus();
    if (e.key === 'ArrowDown') focusAt(index === last ? 0 : index + 1);
    else if (e.key === 'ArrowUp') focusAt(index === 0 ? last : index - 1);
    else if (e.key === 'Home') focusAt(0);
    else if (e.key === 'End') focusAt(last);
    else if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') onOpenChange(false);
    else return;
    if (e.key !== 'Tab') e.preventDefault();
  };

  return (
    <div ref={rootRef} className={styles.select}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.selectButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-labelledby={`${labelId} ${labelId}-value`}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            onOpenChange(true);
          }
        }}
      >
        <span id={`${labelId}-value`}>{nativeLanguageName(value)}</span>
        <svg className={styles.chevron} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div id={menuId} className={`${styles.menu} ${openUp ? styles.menuUp : ''}`} role="listbox" aria-labelledby={labelId}>
          {CAPTION_LANGUAGES.map((lang, index) => (
            <button
              key={lang}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              type="button"
              role="option"
              aria-selected={lang === value}
              className={styles.option}
              onClick={() => {
                if (lang !== value) onChange(lang);
                close();
              }}
              onKeyDown={(e) => onOptionKey(e, index)}
            >
              <span className={styles.check} aria-hidden="true">
                {lang === value && (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </span>
              <span lang={lang}>{nativeLanguageName(lang)}</span>
            </button>
          ))}
          {note && <div className={styles.menuNote}>{note}</div>}
        </div>
      )}
    </div>
  );
}
