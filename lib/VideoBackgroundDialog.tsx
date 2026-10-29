'use client';

/**
 * Camera background picker: your live preview, then the effects (none, slight blur, blur) and the
 * scenes, led by "Add image" and the person's own images. A pick applies at once — the preview
 * shows what everyone sees — and Done just closes. Used in the meeting (dark stage) and on the
 * pre-join page (follows the page theme).
 */

import React from 'react';
import type { LocalVideoTrack } from 'livekit-client';
import styles from '../styles/VideoBackgroundDialog.module.css';
import { useI18n } from './i18n';
import {
  BACKGROUND_SCENES,
  VIDEO_BACKGROUND_EFFECTS,
  isBackgroundScene,
  sceneThumbUrl,
  type VideoBackground,
  type VideoBackgroundStatus,
} from './videoBackground';
import {
  AddBackgroundError,
  MAX_CUSTOM_BACKGROUNDS,
  addCustomBackground,
  isCustomBackgroundId,
  removeCustomBackground,
  useCustomBackgrounds,
  type AddBackgroundProblem,
  type CustomBackgroundId,
} from './customBackgrounds';

interface VideoBackgroundDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** 'stage' in the meeting (always dark), 'page' on the pre-join page (light or dark theme). */
  tone: 'stage' | 'page';
  background: VideoBackground;
  onChange: (next: VideoBackground) => void;
  status: VideoBackgroundStatus;
  supported: boolean;
  onRetry: () => void;
  /** The camera as others see it; undefined while it's off. */
  track?: LocalVideoTrack;
  /** Your own camera reads like a mirror, as on your tile. */
  mirror?: boolean;
  /** Offer "Turn on camera" when it's off (left out when the host has turned it off). */
  onTurnOnCamera?: () => void;
  /** Under the preview: when others see the change. */
  hint: string;
}

export function backgroundLabel(t: (key: string) => string, background: VideoBackground): string {
  if (background === 'none') return t('background.none');
  if (background === 'blur-light') return t('background.blurLight');
  if (background === 'blur') return t('background.blur');
  if (isCustomBackgroundId(background)) return t('background.custom');
  return t(`background.scene.${background}`);
}

const ADD_PROBLEM_KEY: Record<AddBackgroundProblem, string> = {
  full: 'background.addFull',
  size: 'background.addTooBig',
  type: 'background.addFailed',
  unreadable: 'background.addFailed',
  storage: 'background.addFailed',
};

export function VideoBackgroundDialog({
  isOpen,
  onClose,
  tone,
  background,
  onChange,
  status,
  supported,
  onRetry,
  track,
  mirror = true,
  onTurnOnCamera,
  hint,
}: VideoBackgroundDialogProps) {
  const { t } = useI18n();
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const addRef = React.useRef<HTMLButtonElement | null>(null);
  const choiceRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const customImages = useCustomBackgrounds(isOpen && supported);
  const [adding, setAdding] = React.useState(false);
  const [addProblem, setAddProblem] = React.useState<AddBackgroundProblem | null>(null);
  const full = customImages.length >= MAX_CUSTOM_BACKGROUNDS;
  const allChoices: readonly VideoBackground[] = [
    ...VIDEO_BACKGROUND_EFFECTS,
    ...customImages.map((image) => image.id),
    ...BACKGROUND_SCENES,
  ];

  React.useEffect(() => {
    if (!isOpen) setAddProblem(null);
  }, [isOpen]);

  // Focus moves into the dialog and back to where it was; the page behind doesn't scroll.
  React.useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const selected = choiceRefs.current[allChoices.indexOf(background)];
    (selected && !selected.disabled ? selected : dialogRef.current)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
    // Only on open: later picks keep focus where the person is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // The preview is the camera track itself, so it shows the background exactly as it goes out.
  React.useEffect(() => {
    const el = videoRef.current;
    if (!isOpen || !track || !el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [isOpen, track]);

  if (!isOpen) return null;

  const pick = (next: VideoBackground) => {
    if (!supported || next === background) return;
    onChange(next);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAdding(true);
    setAddProblem(null);
    try {
      const id = await addCustomBackground(file);
      onChange(id);
    } catch (error) {
      setAddProblem(error instanceof AddBackgroundError ? error.problem : 'unreadable');
    } finally {
      setAdding(false);
    }
  };

  // Removing the image you're using switches to blur, so the room stays hidden. Focus goes to
  // "Add image", which stays put while the tile it was on disappears.
  const removeImage = async (id: CustomBackgroundId) => {
    if (id === background) onChange('blur');
    addRef.current?.focus();
    await removeCustomBackground(id).catch(() => undefined);
    setAddProblem(null);
  };

  // Arrow keys move through every choice, like one radio group.
  const onChoiceKey = (e: React.KeyboardEvent, index: number) => {
    const last = allChoices.length - 1;
    let to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = index === 0 ? last : index - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = last;
    if (to < 0) return;
    e.preventDefault();
    choiceRefs.current[to]?.focus();
    pick(allChoices[to]);
  };

  const renderChoice = (choice: VideoBackground) => {
    const index = allChoices.indexOf(choice);
    const checked = choice === background;
    const custom = isCustomBackgroundId(choice) ? customImages.find((image) => image.id === choice) : undefined;
    const label = custom
      ? `${t('background.custom')} ${customImages.indexOf(custom) + 1}`
      : backgroundLabel(t, choice);
    const isScene = choice !== 'none' && choice !== 'blur-light' && choice !== 'blur';
    const thumb = custom ? custom.thumbUrl : isBackgroundScene(choice) ? sceneThumbUrl(choice) : '';
    const radio = (
      <button
        key={choice}
        ref={(el) => {
          choiceRefs.current[index] = el;
        }}
        type="button"
        role="radio"
        aria-checked={checked}
        aria-label={label}
        title={isScene ? label : undefined}
        tabIndex={checked ? 0 : -1}
        disabled={!supported}
        className={`${styles.choice} ${isScene ? styles.sceneChoice : styles.effectChoice}`}
        onClick={() => pick(choice)}
        onKeyDown={(e) => onChoiceKey(e, index)}
      >
        {isScene ? (
          <img className={styles.thumb} src={thumb} alt="" draggable={false} />
        ) : (
          <>
            <EffectIcon effect={choice} />
            <span className={styles.effectLabel}>{label}</span>
          </>
        )}
        {checked && status === 'starting' && (
          <span className={styles.choiceBusy} aria-hidden="true">
            <span className={styles.spinner} />
          </span>
        )}
        {checked && background !== 'none' && status !== 'starting' && (
          <span className={styles.checkBadge} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        )}
      </button>
    );
    if (!custom) return radio;
    return (
      <div key={choice} className={styles.customTile}>
        {radio}
        <button
          type="button"
          className={styles.removeButton}
          aria-label={`${t('background.remove')}: ${label}`}
          title={t('background.remove')}
          disabled={!supported}
          onClick={() => void removeImage(custom.id)}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M7 7l10 10M17 7L7 17" />
          </svg>
        </button>
      </div>
    );
  };

  const addTile = (
    <button
      key="add"
      ref={addRef}
      type="button"
      className={`${styles.choice} ${styles.effectChoice} ${styles.addChoice}`}
      disabled={!supported || adding || full}
      title={full ? t('background.addFull') : undefined}
      onClick={() => fileRef.current?.click()}
    >
      {adding ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : (
        <svg className={styles.effectIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
          <path d="M12 9v6M9 12h6" />
        </svg>
      )}
      <span className={styles.effectLabel}>{t('background.add')}</span>
    </button>
  );

  return (
    <div
      className={styles.overlay}
      data-tone={tone}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-background-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.stopPropagation();
          onClose();
        }}
      >
        <div className={styles.handle} aria-hidden="true" />
        <div className={styles.header}>
          <h2 id="video-background-title" className={styles.title}>
            {t('background.title')}
          </h2>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t('background.close')}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.previewColumn}>
            <div className={styles.preview}>
              {track ? (
                <video
                  ref={videoRef}
                  className={styles.video}
                  data-mirror={mirror || undefined}
                  autoPlay
                  muted
                  playsInline
                />
              ) : (
                <div className={styles.cameraOff}>
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M16 16v1a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 1L22 7v10" />
                    <path d="M2 2l20 20" />
                  </svg>
                  <span className={styles.cameraOffTitle}>{t('background.cameraOff')}</span>
                  <span className={styles.cameraOffHint}>{t('background.cameraOffHint')}</span>
                  {onTurnOnCamera && (
                    <button type="button" className={styles.secondaryButton} onClick={onTurnOnCamera}>
                      {t('background.turnOnCamera')}
                    </button>
                  )}
                </div>
              )}
              {track && status === 'starting' && (
                <span className={styles.applying} role="status">
                  <span className={styles.spinner} aria-hidden="true" />
                  {t('background.applying')}
                </span>
              )}
            </div>

            {!supported ? (
              <p className={styles.notice} role="note">
                {t('background.unsupported')}
              </p>
            ) : status === 'failed' ? (
              <div className={styles.alert} role="alert">
                <span>{t('background.failed')}</span>
                <button type="button" className={styles.textButton} onClick={onRetry}>
                  {t('background.retry')}
                </button>
              </div>
            ) : (
              <p className={styles.hint}>
                {track && isCustomBackgroundId(background) ? t('background.mirrorNote') : hint}
              </p>
            )}
          </div>

          <div className={styles.choices} role="radiogroup" aria-labelledby="video-background-title">
            <div role="group" aria-labelledby="video-background-effects">
              <h3 id="video-background-effects" className={styles.groupLabel}>
                {t('background.effects')}
              </h3>
              <div className={styles.grid}>{VIDEO_BACKGROUND_EFFECTS.map(renderChoice)}</div>
            </div>
            <div role="group" aria-labelledby="video-background-scenes">
              <h3 id="video-background-scenes" className={styles.groupLabel}>
                {t('background.scenes')}
              </h3>
              <div className={styles.grid}>
                {addTile}
                {customImages.map((image) => renderChoice(image.id))}
                {BACKGROUND_SCENES.map(renderChoice)}
              </div>
              {(addProblem || full) && (
                <p className={addProblem ? styles.addProblem : styles.addNote} role={addProblem ? 'alert' : undefined}>
                  {t(ADD_PROBLEM_KEY[addProblem ?? 'full'])}
                </p>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => void onFile(e)}
              />
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.done} onClick={onClose}>
            {t('background.done')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** None = a crossed circle; blur = a person with soft dots around them (fewer for "slight"). */
function EffectIcon({ effect }: { effect: 'none' | 'blur-light' | 'blur' }) {
  if (effect === 'none') {
    return (
      <svg className={styles.effectIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M6 6l12 12" />
      </svg>
    );
  }
  const dots =
    effect === 'blur'
      ? [
          [3.5, 6], [3.5, 11], [3.5, 16], [6.5, 3.5], [20.5, 6], [20.5, 11], [20.5, 16], [17.5, 3.5],
          [6, 8.5], [18, 8.5], [6, 13.5], [18, 13.5],
        ]
      : [
          [4, 7.5], [4, 13.5], [20, 7.5], [20, 13.5], [7, 4], [17, 4],
        ];
  return (
    <svg className={styles.effectIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="9" r="3.2" />
      <path d="M6.5 20c.7-3.3 2.9-5.2 5.5-5.2s4.8 1.9 5.5 5.2" />
      {dots.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={effect === 'blur' ? 0.95 : 1.05} fill="currentColor" stroke="none" />
      ))}
    </svg>
  );
}
