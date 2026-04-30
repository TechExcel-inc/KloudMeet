'use client';

import React from 'react';
import { buildLiveDocIframeSrc, createOrUpdateInstantAccount } from '@/lib/livedoc/client';
import { useI18n } from '@/lib/i18n';
import styles from '../styles/LiveDocView.module.css';

interface LiveDocViewProps {
  meetingRoomName: string;
  participantName?: string;
  livedocInstanceId: string | null;
  hostInitError: string | null;
  hostInitInProgress: boolean;
  isHost: boolean;
}

export function LiveDocView({
  meetingRoomName,
  participantName,
  livedocInstanceId,
  hostInitError,
  hostInitInProgress,
  isHost,
}: LiveDocViewProps) {
  const { t, locale } = useI18n();
  const [userToken, setUserToken] = React.useState<string | null>(null);
  const [tokenError, setTokenError] = React.useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = React.useState(true);
  const [pluginLoaded, setPluginLoaded] = React.useState(false);

  React.useEffect(() => {
    const name = participantName?.trim() || 'Guest';
    let cancelled = false;
    setTokenLoading(true);
    setTokenError(null);
    createOrUpdateInstantAccount(name)
      .then((t) => {
        if (!cancelled) {
          setUserToken(t);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setUserToken(null);
          setTokenError((e as Error).message ?? String(e));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTokenLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [participantName]);

  React.useEffect(() => {
    setPluginLoaded(false);
  }, [livedocInstanceId]);

  React.useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data as { type?: unknown } | null;
      if (data && typeof data === 'object' && data.type === 'onkloudloaded') {
        setPluginLoaded(true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  if (isHost && hostInitError) {
    return (
      <div className={styles.container}>
        <div className={styles.message}>
          <p className={styles.messageTitle}>{t('livedoc.errorTitle')}</p>
          <p className={styles.messageDetail}>{hostInitError}</p>
        </div>
      </div>
    );
  }

  if (!livedocInstanceId) {
    return (
      <div className={styles.container}>
        <div className={styles.message}>
          <p className={styles.messageTitle}>
            {isHost && hostInitInProgress
              ? t('livedoc.creating')
              : isHost
                ? t('livedoc.preparing')
                : t('livedoc.waitingHost')}
          </p>
          <p className={styles.messageDetail}>{t('livedoc.room', { room: meetingRoomName })}</p>
        </div>
      </div>
    );
  }

  if (tokenLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.message}>
          <p className={styles.messageTitle}>{t('livedoc.fetchingToken')}</p>
        </div>
      </div>
    );
  }

  if (tokenError || !userToken) {
    return (
      <div className={styles.container}>
        <div className={styles.message}>
          <p className={styles.messageTitle}>{t('livedoc.loadFailed')}</p>
          <p className={styles.messageDetail}>{tokenError ?? t('livedoc.missingToken')}</p>
        </div>
      </div>
    );
  }

  const languageId = locale === 'zh' ? 0 : 1;
  const src = buildLiveDocIframeSrc(livedocInstanceId, userToken, languageId);

  return (
    <div className={styles.container}>
      <iframe
        key={livedocInstanceId}
        id="sharedIframePlayer"
        title="LiveDoc"
        src={src}
        className={styles.iframe}
        allow="clipboard-read; clipboard-write;fullscreen *; autoplay *"
        sandbox="allow-scripts allow-forms allow-popups allow-pointer-lock allow-same-origin allow-modals"
      />
      {!pluginLoaded && (
        <div className={styles.loadingOverlay}>
          <div className={styles.message}>
            <p className={styles.messageTitle}>{t('livedoc.loading')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
