'use client';

import React from 'react';
import styles from '@/styles/DesktopAppLaunchModal.module.css';
import { useI18n } from '@/lib/i18n';

type LaunchEntry = 'inMeeting' | 'outsideMeeting' | 'prejoin';
type LaunchStep = 'prelaunch' | 'launching' | 'fallback' | 'download';

interface LaunchState {
  entry: LaunchEntry;
  step: LaunchStep;
  deepLink: string;
}

const FALLBACK_DELAY_MS = 2400;

function buildDeepLinkFromLocation(): string {
  if (typeof window === 'undefined') return 'kloudmeet://open';
  const url = new URL(window.location.href);
  const match = url.pathname.match(/\/rooms\/([^/]+)/);
  if (!match?.[1]) return 'kloudmeet://open';
  return `kloudmeet://join/${encodeURIComponent(match[1])}${url.search}`;
}

function getEntrySubtitleKey(entry: LaunchEntry): string {
  if (entry === 'inMeeting') return 'toolbar.openDesktop.subtitleInMeeting';
  if (entry === 'prejoin') return 'toolbar.openDesktop.subtitlePrejoin';
  return 'toolbar.openDesktop.subtitleOutsideMeeting';
}

function getDownloadUrls() {
  return {
    mac: process.env.NEXT_PUBLIC_KLOUDMEET_DESKTOP_DOWNLOAD_MAC || '',
    windows: process.env.NEXT_PUBLIC_KLOUDMEET_DESKTOP_DOWNLOAD_WINDOWS || '',
  };
}

export function useDesktopAppLaunch() {
  const { t } = useI18n();
  const [state, setState] = React.useState<LaunchState | null>(null);
  const fallbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupRef = React.useRef<(() => void) | null>(null);

  const clearLaunchWatchers = React.useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
  }, []);

  React.useEffect(() => () => clearLaunchWatchers(), [clearLaunchWatchers]);

  const closeModal = React.useCallback(() => {
    clearLaunchWatchers();
    setState(null);
  }, [clearLaunchWatchers]);

  const openDesktopEntry = React.useCallback((entry: LaunchEntry, deepLink?: string) => {
    setState({
      entry,
      step: 'prelaunch',
      deepLink: deepLink || buildDeepLinkFromLocation(),
    });
  }, []);

  const attemptLaunch = React.useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      return { ...prev, step: 'launching' };
    });

    clearLaunchWatchers();
    let resolved = false;

    const markOpened = () => {
      if (resolved) return;
      resolved = true;
      clearLaunchWatchers();
      setState(null);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        markOpened();
      }
    };
    const onBlur = () => markOpened();
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    cleanupRef.current = () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };

    fallbackTimerRef.current = setTimeout(() => {
      if (resolved) return;
      cleanupRef.current?.();
      cleanupRef.current = null;
      setState((prev) => (prev ? { ...prev, step: 'fallback' } : prev));
    }, FALLBACK_DELAY_MS);

    const deepLink = state?.deepLink || buildDeepLinkFromLocation();
    try {
      window.location.href = deepLink;
    } catch {
      setState((prev) => (prev ? { ...prev, step: 'fallback' } : prev));
    }
  }, [clearLaunchWatchers, state?.deepLink]);

  const openDownloadStep = React.useCallback(() => {
    clearLaunchWatchers();
    setState((prev) => (prev ? { ...prev, step: 'download' } : prev));
  }, [clearLaunchWatchers]);

  const goBack = React.useCallback(() => {
    clearLaunchWatchers();
    setState((prev) => (prev ? { ...prev, step: 'prelaunch' } : prev));
  }, [clearLaunchWatchers]);

  const download = React.useCallback((platform: 'mac' | 'windows') => {
    const { mac, windows } = getDownloadUrls();
    const target = platform === 'mac' ? mac : windows;
    if (!target) return;
    window.open(target, '_blank', 'noopener,noreferrer');
  }, []);

  const modal = !state ? null : (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('toolbar.openDesktop.title')}>
      <div className={styles.modal}>
        {state.step === 'prelaunch' && (
          <>
            <h3 className={styles.title}>{t('toolbar.openDesktop.title')}</h3>
            <p className={styles.subtitle}>{t(getEntrySubtitleKey(state.entry))}</p>
            <div className={styles.actions}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={attemptLaunch}>
                {t('toolbar.openDesktop.openButton')}
              </button>
              <button type="button" className={styles.btn} onClick={openDownloadStep}>
                {t('toolbar.openDesktop.downloadButton')}
              </button>
              <button type="button" className={`${styles.btn} ${styles.close}`} onClick={closeModal}>
                {t('common.cancel')}
              </button>
            </div>
          </>
        )}

        {state.step === 'launching' && (
          <>
            <h3 className={styles.title}>{t('toolbar.openDesktop.launchingTitle')}</h3>
            <p className={styles.subtitle}>
              {t('toolbar.openDesktop.launchingSubtitle')}
            </p>
            <div className={styles.statusBox}>{t('toolbar.openDesktop.launchingStatus')}</div>
            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={openDownloadStep}>
                {t('toolbar.openDesktop.downloadButton')}
              </button>
              <button type="button" className={`${styles.btn} ${styles.close}`} onClick={closeModal}>
                {t('common.close')}
              </button>
            </div>
          </>
        )}

        {state.step === 'fallback' && (
          <>
            <h3 className={styles.title}>{t('toolbar.openDesktop.fallbackTitle')}</h3>
            <p className={styles.subtitle}>
              {t('toolbar.openDesktop.fallbackSubtitle')}
            </p>
            <div className={styles.actions}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={attemptLaunch}>
                {t('toolbar.openDesktop.tryAgain')}
              </button>
              <button type="button" className={styles.btn} onClick={openDownloadStep}>
                {t('toolbar.openDesktop.downloadButton')}
              </button>
              <button type="button" className={`${styles.btn} ${styles.close}`} onClick={closeModal}>
                {t('common.close')}
              </button>
            </div>
          </>
        )}

        {state.step === 'download' && (
          <>
            <h3 className={styles.title}>{t('toolbar.openDesktop.downloadTitle')}</h3>
            <p className={styles.subtitle}>
              {t('toolbar.openDesktop.downloadSubtitle')}
            </p>
            <div className={styles.actions}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => download('mac')}>
                {t('toolbar.openDesktop.downloadMac')}
              </button>
              <button type="button" className={styles.btn} onClick={() => download('windows')}>
                {t('toolbar.openDesktop.downloadWindows')}
              </button>
              <button type="button" className={styles.btn} onClick={goBack}>
                {t('common.back')}
              </button>
              <button type="button" className={`${styles.btn} ${styles.close} ${styles.btnDanger}`} onClick={closeModal}>
                {t('common.close')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return { openDesktopEntry, desktopLaunchModal: modal };
}
