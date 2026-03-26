'use client';

import React from 'react';
import { buildLiveDocIframeSrc, createOrUpdateInstantAccount } from '@/lib/livedoc/client';
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
  const [userToken, setUserToken] = React.useState<string | null>(null);
  const [tokenError, setTokenError] = React.useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = React.useState(true);

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

  if (isHost && hostInitError) {
    return (
      <div className={styles.container}>
        <div className={styles.message}>
          <p className={styles.messageTitle}>无法创建文档会话</p>
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
              ? '正在创建文档会话…'
              : isHost
                ? '正在准备文档会话…'
                : '等待主持人开启文档…'}
          </p>
          <p className={styles.messageDetail}>会议室：{meetingRoomName}</p>
        </div>
      </div>
    );
  }

  if (tokenLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.message}>
          <p className={styles.messageTitle}>正在获取访问令牌…</p>
        </div>
      </div>
    );
  }

  if (tokenError || !userToken) {
    return (
      <div className={styles.container}>
        <div className={styles.message}>
          <p className={styles.messageTitle}>无法加载 LiveDoc</p>
          <p className={styles.messageDetail}>{tokenError ?? '缺少访问令牌'}</p>
        </div>
      </div>
    );
  }

  const src = buildLiveDocIframeSrc(livedocInstanceId, userToken);

  return (
    <div className={styles.container}>
      <iframe
        key={livedocInstanceId}
        title="LiveDoc"
        src={src}
        className={styles.iframe}
        allow="clipboard-read; clipboard-write;fullscreen *; autoplay *"
        sandbox="allow-scripts allow-forms allow-popups allow-pointer-lock allow-same-origin allow-modals"
      />
    </div>
  );
}
